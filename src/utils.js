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
const path = require('path');
const request = require('request-promise-native');
const requestNative = require('request');
const crypto = require('crypto');
const { Socket } = require('net');
const { MountConfig } = require('@adobe/helix-shared');

const utils = {

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
   * @param {Logger} logger the logger
   * @param {object} auth authentication object ({@see https://github.com/request/request#http-authentication})
   * @returns {*} The requested content or NULL if not exists.
   */
  async fetch(uri, logger, auth) {
    try {
      const response = await request({
        method: 'GET',
        uri,
        resolveWithFullResponse: true,
        encoding: null,
        auth,
      });
      return response.body;
    } catch (e) {
      if (e.response && e.response.statusCode) {
        if (e.response.statusCode !== 404) {
          logger.error(`resource at ${uri} does not exist. got ${e.response.statusCode} from server`);
        }
        return null;
      }
      logger.error(`resource at ${uri} does not exist. ${e.message}`);
      return null;
    }
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
      ctx.logger.debug(`fetching static resource from ${uri}`);
      let auth = null;
      if (ctx.actionParams.GITHUB_TOKEN && (uri.startsWith('https://raw.github.com/') || uri.startsWith('https://raw.githubusercontent.com/'))) {
        auth = {
          bearer: ctx.actionParams.GITHUB_TOKEN,
        };
      }

      // eslint-disable-next-line no-await-in-loop
      const data = await utils.fetch(uri, ctx.logger, auth);
      if (data != null) {
        ctx.content = Buffer.from(data, 'utf8');
        return ctx;
      }
    }
    const error = new Error('Resource not found.');
    error.code = 404;
    throw error;
  },

  /**
   * Fetches the content from the proxy of the proxy-strain and streams it back to the response.
   * @param {RequestContext} ctx Context
   * @param {Request} req The original express request
   * @param {Response} res The express response
   * @return {Promise} A promise that resolves when the stream is done.
   */
  async proxyRequest(ctx, req, res) {
    const { origin } = ctx.strain;
    if (!origin) {
      throw Error(`No proxy strain: ${ctx.strain.name}`);
    }
    let proxyPath = path.posix.relative(ctx.mount, req.path);
    if (proxyPath.startsWith('/../')) {
      proxyPath = req.path;
    }
    proxyPath = path.posix.join('/', origin.path, proxyPath);
    const url = `${origin.useSSL ? 'https' : 'http'}://${origin.hostname}:${origin.port}${proxyPath}`;
    ctx.logger.info(`Proxy ${req.method} request to ${url}`);
    return new Promise((resolve, reject) => {
      req.pipe(requestNative(url)
        .on('error', reject)
        .on('end', resolve)).pipe(res);
    });
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
    ctx.logger.info(`content proxy: try loading from github first: ${githubUrl}`);
    try {
      let auth = null;
      if (req.headers['x-github-token']) {
        auth = {
          bearer: req.headers['x-github-token'],
        };
      }
      const response = await request({
        method: 'GET',
        uri: githubUrl,
        resolveWithFullResponse: true,
        encoding: null,
        auth,
      });
      ctx.logger.info(`content proxy: try loading from github first: ${githubUrl}: ${response.statusCode}`);
      res.type(ext);
      res.send(response.body);
      return true;
    } catch (e) {
      const status = (e.response && e.response.statusCode) || 500;
      ctx.logger[status === 404 ? 'info' : 'error'](`content proxy: ${githubUrl} does not exist. ${status} ${e.error}`);
      if (status !== 404) {
        res.status(status).send();
        return true;
      }
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
    const url = new URL('https://adobeioruntime.net/api/v1/web/helix/helix-services/content-proxy@v1');

    const { originalContent } = ctx.strain;
    Object.entries(req.query).forEach(([key, value]) => {
      if (key === 'REPO_RAW_ROOT') {
        // todo: potentially specify different root
      } else if (key === 'repo' && originalContent) {
        url.searchParams.append(key, originalContent.repo);
      } else if (key === 'owner' && originalContent) {
        url.searchParams.append(key, originalContent.owner);
      } else {
        url.searchParams.append(key, value);
      }
    });
    // make content-proxy to ignore github
    url.searchParams.append('ignore', 'github');
    ctx.logger.info(`content proxy: proxy to ${url}`);

    return new Promise((resolve, reject) => {
      req.pipe(requestNative(url.toString())
        .on('error', reject)
        .on('end', resolve)).pipe(res);
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
};

module.exports = Object.freeze(utils);
