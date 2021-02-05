/*
 * Copyright 2018 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const fs = require('fs-extra');
const crypto = require('crypto');
const { Socket } = require('net');
const { PassThrough } = require('stream');
const { MountConfig } = require('@adobe/helix-shared');
const fetchAPI = require('@adobe/helix-fetch');

const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? fetchAPI.context({ alpnProtocols: [fetchAPI.ALPN_HTTP1_1] })
  : fetchAPI.context({});

const utils = {
  status2level(status) {
    if (status < 300) {
      return 'debug';
    }
    if (status < 400) {
      return 'info';
    }
    if (status < 500) {
      return 'warn';
    }
    return 'error';
  },

  /**
   * Checks if the file addressed by the given filename exists and is a regular file.
   * @param {String} filename Path to file
   * @returns {Promise} Returns promise that resolves with the filename or rejects if is not a file.
   */
  async isFile(filename) {
    const stats = await fs.stat(filename);
    if (!stats.isFile()) {
      throw Error(`no regular file: ${filename}`);
    }
    return filename;
  },

  /**
   * Fetches content from the given uri
   * @param {String} uri URL to fetch
   * @param {RequestContext} ctx the context
   * @param {object} auth authentication object ({@see https://github.com/request/request#http-authentication})
   * @returns {Buffer} The requested content or NULL if not exists.
   */
  async fetch(ctx, uri, auth) {
    const headers = {
      'X-Request-Id': ctx.requestId,
    };
    if (auth) {
      headers.authorization = `Bearer ${auth}`;
    }
    const res = await fetch(uri, {
      cache: 'no-store',
      headers,
    });
    const body = await res.buffer();
    if (!res.ok) {
      const level = utils.status2level(res.status);
      ctx.log[level](`resource at ${uri} does not exist. got ${res.status} from server`);
      return null;
    }
    return body;
  },

  /**
   * Fetches static resources and stores it in the context.
   * @param {RequestContext} ctx Context
   * @return {Promise} A promise that resolves to the request context.
   */
  async fetchStatic(ctx) {
    const staticUrl = ctx.strain.static.url;
    const uris = [
      `${ctx.strain.content.raw}${ctx.relPath}`,
      `${staticUrl.raw}${staticUrl.path}${ctx.relPath}`,
    ];
    for (let i = 0; i < uris.length; i += 1) {
      const uri = uris[i];
      ctx.log.debug(`fetching static resource from ${uri}`);
      let auth = null;
      if (ctx.actionParams.GITHUB_TOKEN && (uri.startsWith('https://raw.github.com/') || uri.startsWith('https://raw.githubusercontent.com/'))) {
        auth = ctx.actionParams.GITHUB_TOKEN;
      }

      // eslint-disable-next-line no-await-in-loop
      const data = await utils.fetch(ctx, uri, auth);
      if (data != null) {
        ctx.content = data;
        return ctx;
      }
    }
    const error = new Error('Resource not found.');
    error.code = 404;
    throw error;
  },

  /**
   * Injects the live-reload script
   * @param {string} body the html body
   * @returns {string} the modified body
   */
  injectLiveReloadScript(body) {
    let match = body.match(/<\/head>/i);
    if (!match) {
      match = body.match(/<\/body>/i);
    }
    if (!match) {
      match = body.match(/<\/html>/i);
    }
    // don't inject if no html found at all.
    if (match) {
      const { index } = match;
      // eslint-disable-next-line no-param-reassign
      body = `${body.substring(0, index)}<script src="/__internal__/livereload.js"></script>${body.substring(index)}`;
    }
    return body;
  },

  /**
   * Fetches the content from the url  and streams it back to the response.
   * @param {RequestContext} ctx Context
   * @param {string} url The url to fetch from
   * @param {Request} req The original express request
   * @param {Response} res The express response
   * @param {object} opts additional request options
   * @return {Promise} A promise that resolves when the stream is done.
   */
  async proxyRequest(ctx, url, req, res, opts = {}) {
    ctx.log.debug(`Proxy ${req.method} request to ${url}`);
    let body;
    // GET and HEAD requests can't have a body
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = new PassThrough();
      req.pipe(body);
    }
    const stream = new PassThrough();
    req.pipe(stream);
    const headers = {
      ...req.headers,
      ...(opts.headers || {}),
    };
    delete headers.cookie;
    delete headers.connection;
    delete headers.host;
    const ret = await fetch(url, {
      method: req.method,
      headers,
      cache: 'no-store',
      body,
    });
    const contentType = ret.headers.get('content-type') || 'text/plain';
    const level = utils.status2level(ret.status);
    ctx.log[level](`Proxy ${req.method} request to ${url}: ${ret.status} (${contentType})`);
    if (opts.injectLiveReload && ret.status === 200 && contentType.indexOf('text/html') === 0) {
      const respBody = utils.injectLiveReloadScript(await ret.text());
      res
        .status(ret.status)
        .set(ret.headers.plain())
        .send(respBody);
      return;
    }

    res
      .status(ret.status)
      .set(ret.headers.plain());
    ret.body.pipe(res);
  },

  /**
   * Fetches the content from the content proxy
   * @param {RequestContext} ctx Context
   * @param {Request} req The original express request
   * @param {Response} res The express response
   * @return {Promise} A promise that resolves when the stream is done.
   */
  async proxyToContentProxy(ctx, req, res) {
    let { path: resourcePath } = req.query;
    const idxLastSlash = resourcePath.lastIndexOf('/');
    const idx = resourcePath.indexOf('.', idxLastSlash + 1);
    const ext = resourcePath.substring(idx + 1);
    resourcePath = resourcePath.substring(0, idx);

    const contentUrl = ctx.strain.content;

    // try to fetch from github first
    const githubUrl = `${contentUrl.raw}${contentUrl.path}${req.query.path}`;
    ctx.log.info(`simulator proxy: try loading from github first: ${githubUrl}`);

    const headers = {};
    if (req.headers['x-github-token']) {
      headers.authorization = `Bearer ${req.headers['x-github-token']}`;
    }
    const requestId = req.headers['x-request-id'];
    if (requestId) {
      headers['x-request-id'] = requestId;
    }

    let ret = await fetch(githubUrl, {
      cache: 'no-store',
      headers,
    });
    const body = await ret.buffer();

    const { status } = ret;
    if (ret.ok) {
      ctx.log.info(`simulator proxy: loaded from github: ${githubUrl}: ${status}`);
      res.type(ext);
      res.send(body);
      return true;
    }
    ctx.log[status === 404 ? 'info' : 'error'](`simulator proxy: ${githubUrl} does not exist. ${status}`);

    if (status !== 404) {
      res.status(status).send();
      return true;
    }

    // ignore some well known files
    if (['/head.md', '/header.md', '/footer.md'].indexOf(req.query.path) >= 0) {
      res.status(404).send();
      return true;
    }

    // load fstab
    const mount = await new MountConfig()
      .withRepoURL(ctx.strain.content)
      .init();

    // mountpoint
    const mp = mount.match(resourcePath);
    if (!mp || !mp.type) {
      res.status(404).send();
      return true;
    }

    // todo: use correct namespace ??
    const url = new URL('https://adobeioruntime.net/api/v1/web/helix/helix-services/content-proxy@v2');

    const { originalContent } = ctx.strain;
    Object.entries(req.query).forEach(([key, value]) => {
      if (key === 'REPO_RAW_ROOT') {
        // todo: potentially specify different root
      } else if (key === 'repo' && originalContent) {
        url.searchParams.append(key, originalContent.repo);
      } else if (key === 'owner' && originalContent) {
        url.searchParams.append(key, originalContent.owner);
      } else if (key === 'ref' && originalContent) {
        url.searchParams.append(key, originalContent.ref);
      } else {
        url.searchParams.append(key, value);
      }
    });
    // make content-proxy to ignore github
    url.searchParams.append('ignore', 'github');
    ctx.log.info(`simulator proxy: fetch from content proxy ${url}`);

    ret = await fetch(url.toString(), {
      cache: 'no-store',
    });
    if (!ret.ok) {
      const msg = await ret.text();
      ctx.log.error(`simulator proxy: error fetching from content proxy ${url}: ${ret.status} ${msg}`);
      res.status(ret.status).send();
      return true;
    }
    ctx.log.info(`simulator proxy: fetch from content proxy ${url}: ${ret.status}`);
    res.headers = ret.headers.plain();
    res.status(ret.status);
    return new Promise((resolve, reject) => {
      ret.body.pipe(res)
        .on('error', reject)
        .on('end', resolve);
    });
  },

  /**
   * Generates a random string of the given `length` consisting of alpha numerical characters.
   * if `hex` is {@code true}, the string will only consist of hexadecimal digits.
   * @param {number}length length of the string.
   * @param {boolean} hex returns a hex string if {@code true}
   * @returns {String} a random string.
   */
  randomChars(length, hex = false) {
    if (length === 0) {
      return '';
    }
    if (hex) {
      return crypto.randomBytes(Math.round(length / 2)).toString('hex').substring(0, length);
    }
    const str = crypto.randomBytes(length).toString('base64');
    return str.substring(0, length);
  },

  /**
   * Generates a completely random uuid of the format:
   * `00000000-0000-0000-0000-000000000000`
   * @returns {string} A random uuid.
   */
  uuid() {
    return `${utils.randomChars(8, true)}-${utils.randomChars(4, true)}-${utils.randomChars(4, true)}-${utils.randomChars(4, true)}-${utils.randomChars(12, true)}`;
  },

  /**
   * Checks if the given port is already in use on any addr. This is used to prevent starting a
   * server on the same port with an existing socket bound to 0.0.0.0 and SO_REUSEADDR.
   * @param port
   * @return {Promise} that resolves `true` if the port is in use.
   */
  checkPortInUse(port) {
    return new Promise((resolve, reject) => {
      let socket;

      const cleanUp = () => {
        if (socket) {
          socket.removeAllListeners('connect');
          socket.removeAllListeners('error');
          socket.end();
          socket.destroy();
          socket.unref();
          socket = null;
        }
      };

      socket = new Socket();
      socket.once('error', (err) => {
        if (err.code !== 'ECONNREFUSED') {
          reject(err);
        } else {
          resolve(false);
        }
        cleanUp();
      });

      socket.connect(port, () => {
        resolve(true);
        cleanUp();
      });
    });
  },

  /**
   * Create a NodeESI data provider that uses helix-fetch to retrieve the content.
   * @param {object} config default config.
   * @returns {DataProvider} a data provider;
   */
  createNodeESIDataProvider(config = {}) {
    const defaultHeaders = {
      Accept: 'text/html, application/xhtml+xml, application/xml',
      'x-esi': 'true',
    };
    const { baseUrl = '' } = config;

    function toFullyQualifiedURL(urlOrPath, baseOptions) {
      if (urlOrPath.indexOf('http') === 0) {
        return urlOrPath;
      } else {
        const base = baseOptions ? baseOptions.baseUrl || baseUrl : baseUrl;
        return new URL(urlOrPath, base).toString();
      }
    }

    function extendRequestOptions(src, baseOptions) {
      return {
        url: toFullyQualifiedURL(src, baseOptions),
        headers: { ...defaultHeaders, ...baseOptions.headers },
      };
    }

    async function get(src, baseOptions) {
      const options = extendRequestOptions(src, baseOptions || {});
      const { url } = options;
      delete options.url;
      const ret = await fetch(url, {
        cache: 'no-store',
        ...options,
      });
      const body = await ret.text();
      if (!ret.ok) {
        throw new Error(ret.status);
      }
      return {
        body,
      };
    }
    return { toFullyQualifiedURL, get };
  },
};

module.exports = Object.freeze(utils);
