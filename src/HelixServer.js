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

const EventEmitter = require('events');
const path = require('path').posix;
const { Module } = require('module');
const express = require('express');
const cookieParser = require('cookie-parser');
const NodeESI = require('nodesi');
const { SimpleInterface } = require('@adobe/helix-log');
const querystring = require('querystring');
const utils = require('./utils.js');
const packageJson = require('../package.json');

const RequestContext = require('./RequestContext.js');

const HELIX_BLOB_REGEXP = /^\/hlx_([0-9a-f]{40}).(jpg|jpeg|png|webp|gif)$/;
const HELIX_FONTS_REGEXP = /^\/hlx_fonts\/(.+)$/;
const HELIX_QUERY_REGEXP = /^\/_query\/(.+)\/(.+)$/;

const DEFAULT_PORT = 3000;

function safeCycles() {
  const seen = [];
  function guardCycles(_, v) {
    if (!v || typeof (v) !== 'object') {
      return (v);
    }
    if (seen.indexOf(v) !== -1) {
      return ('[Circular]');
    }
    seen.push(v);
    return (v);
  }
  return guardCycles;
}

/**
 * Wraps the route middleware so it can catch potential promise rejections
 * during the async invocation.
 *
 * @param {ExpressMiddleware} fn an extended express middleware function
 * @returns {ExpressMiddleware} an express middleware function.
 */
function asyncHandler(fn) {
  return (req, res, next) => (Promise.resolve(fn(req, res, next)).catch(next));
}

class HelixServer extends EventEmitter {
  /**
   * Creates a new HelixServer for the given project.
   * @param {HelixProject} project
   */
  constructor(project) {
    super();
    this._project = project;
    this._app = express();
    this._port = DEFAULT_PORT;
    this._server = null;
    this._logger = new SimpleInterface({
      defaultFields: {
        category: 'hlx',
      },
    });
  }

  /**
   * Initializes the server
   */
  async init() {
    this._logger = this._project.log || this.log;
  }

  /**
   * Returns the logger.
   * @returns {Logger} the logger.
   */
  get log() {
    return this._logger;
  }

  /**
   * Executes the template and resolves with the content.
   * @param {RequestContext} ctx Context
   * @return {Promise} A promise that resolves to generated output.
   */
  async executeTemplate(ctx) {
    // the compiled script does not bundle the modules that are required for execution, since it
    // expects them to be provided by the runtime. We tweak the module loader here in order to
    // inject the project module paths.

    /* eslint-disable no-underscore-dangle */
    const nodeModulePathsFn = Module._nodeModulePaths;
    Module._nodeModulePaths = function nodeModulePaths(from) {
      let paths = nodeModulePathsFn.call(this, from);

      // only tweak module path for scripts in build or src dir
      if (ctx.config.isModulePath(from)) {
        // the runtime paths take precedence. see #147
        paths = ctx.config.runtimeModulePaths.concat(paths);
      }
      return paths;
    };

    // eslint-disable-next-line import/no-dynamic-require,global-require
    const mod = require(ctx.templatePath);

    // openwhisk uses lowercase header names
    const owHeaders = {};
    Object.keys(ctx.wskHeaders).forEach((k) => {
      owHeaders[k.toLowerCase()] = ctx.wskHeaders[k];
    });

    Module._nodeModulePaths = nodeModulePathsFn;

    const actionParams = {
      __ow_headers: owHeaders,
      __ow_method: ctx.method.toLowerCase(),
      __ow_logger: ctx.log,
    };

    Object.assign(actionParams, ctx.actionParams, ctx.body);
    if (ctx.url.match(/^\/cgi-bin\//)) {
      Object.assign(actionParams, {
        __hlx_owner: ctx.strain.content.owner,
        __hlx_repo: ctx.strain.content.repo,
        __hlx_ref: ctx.strain.content.ref || 'master',
      }, ctx._params);
    } else {
      Object.assign(actionParams, {
        owner: ctx.strain.content.owner,
        repo: ctx.strain.content.repo,
        ref: ctx.strain.content.ref || 'master',
        path: `${ctx.resourcePath}.md`,
        selector: ctx._selector,
        extension: ctx._extension,
        rootPath: ctx._mount,
        params: querystring.stringify(ctx._params),
        REPO_RAW_ROOT: `${ctx.strain.content.rawRoot}/`, // the pipeline needs the final slash here
        REPO_API_ROOT: `${ctx.strain.content.apiRoot}/`,
        CONTENT_PROXY_URL: `http://localhost:${this._port}/__internal__/content-proxy/${ctx.strain.name}`,
      });
    }
    return Promise.resolve(mod.main(actionParams));
    /* eslint-enable no-underscore-dangle */
  }

  /**
   * Handles a dynamic request by resolving the template and then executing it.
   * The processing is rejected, if the template returns a 404 status code.
   * @param {RequestContext} ctx the request context
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   * @returns {@code true} if the request is processed, {@code false} otherwise.
   */
  async handleDynamic(ctx, req, res) {
    const isResolved = await this._project.templateResolver.resolve(ctx);
    if (!isResolved) {
      return false;
    }
    const result = await this.executeTemplate(ctx);
    if (!result) {
      throw new Error('Response is empty, don\'t know what to do');
    }
    if (result instanceof Error) {
      // full response is an error: engine error
      throw result;
    }
    if (result.error && result.error instanceof Error) {
      throw result.error;
    }

    const status = result.statusCode || 200;
    if (status === 404) {
      return false;
    }

    let body = result.body || '';
    const headers = result.headers || {};
    const contentType = headers['Content-Type'] || 'text/html';
    if (/.*\/json/.test(contentType)) {
      body = JSON.stringify(body, safeCycles());
    } else if (/.*\/octet-stream/.test(contentType) || /image\/.*/.test(contentType)) {
      body = Buffer.from(body, 'base64');
    } else if (ctx.config.liveReload && contentType === 'text/html' && !req.headers['x-esi']) {
      // inject live reload script
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
        body = `${body.substring(0, index)}<script src="/__internal__/livereload.js"></script>${body.substring(index)}`;
      }
    }
    res.set(headers).status(status).send(body);
    return true;
  }

  /**
   * Handles the request to remote origin if the respective strains is a proxy strain.
   * @param {RequestContext} ctx the request context
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   * @returns {@code true} if the request is processed, {@code false} otherwise.
   */
  async handleProxy(ctx, req, res) {
    if (!ctx.strain.isProxy()) {
      return false;
    }
    const { log } = this;
    const { origin } = ctx.strain;
    if (!origin) {
      log.error(`No proxy strain: ${ctx.strain.name}`);
      res.status(500).send();
      return true;
    }
    let proxyPath = path.relative(ctx.mount, ctx.path);
    if (proxyPath.startsWith('/../')) {
      proxyPath = req.path;
    }
    proxyPath = path.resolve('/', origin.path, proxyPath);
    const url = `${origin.useSSL ? 'https' : 'http'}://${origin.hostname}:${origin.port}${proxyPath}`;
    try {
      await utils.proxyRequest(ctx, url, req, res);
    } catch (err) {
      log.error(`Error during proxy: ${err.stack || err}`);
      res.status(500).send();
    }
    return true;
  }

  /**
   * Handles the request the content proxy.
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   */
  async handleContentProxy(req, res) {
    try {
      const ctx = new RequestContext(req, this._project);
      await utils.proxyToContentProxy(ctx, req, res);
    } catch (err) {
      this.log.error(`Error during proxy: ${err.stack || err}`);
      res.status(500).send();
    }
  }

  /**
   * Default route handler
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   */
  async handleRequest(req, res) {
    const ctx = new RequestContext(req, this._project);
    const { log } = this;
    log.debug(`current strain: ${ctx.strain.name}: ${JSON.stringify(ctx.strain.toJSON({ minimal: true, keepFormat: true }), null, 2)}`);
    if (await this.handleProxy(ctx, req, res)) {
      return;
    }

    // check for special hlx paths
    if (HELIX_BLOB_REGEXP.test(ctx.path)
      || HELIX_FONTS_REGEXP.test(ctx.path)
      || HELIX_QUERY_REGEXP.test(ctx.path)) {
      const content = ctx.strain.originalContent || ctx.strain.content;
      const url = `https://${content.ref}--${content.repo}--${content.owner}.hlx.page${ctx.url}`;
      log.debug(`helix url, proxying to ${url}`);
      // proxy to inner CDN
      try {
        await utils.proxyRequest(ctx, url, req, res);
      } catch (err) {
        log.error(`Failed to proxy helix request ${ctx.path}: ${err.message}`);
        res.status(502).send(`Failed to proxy helix request: ${err.message}`);
      }
      return;
    }

    // start git server if needed and adjust content and static url
    await ctx.config.emulateGit(ctx.strain);

    // check for .json or .md for content proxy
    if (ctx.extension === 'json' || ctx.extension === 'md') {
      // use fake repo/owner/ref - they will be replaced later with the strain content values.
      req.query = {
        ...req.query || {},
        repo: 'repo',
        owner: 'owner',
        ref: 'ref',
        path: ctx.path,
      };
      req.params.strain = ctx.strain.name;
      await this.handleContentProxy(req, res);
      return;
    }

    this.emit('request', req, res, ctx);

    // ensure that esi uses correct base url
    req.esiOptions = {
      baseUrl: `http://localhost:${this._port}${req.url}`,
    };

    const { liveReload } = ctx.config;
    if (liveReload) {
      liveReload.startRequest(ctx.requestId, ctx.path);
    }
    try {
      if (await this.handleDynamic(ctx, req, res)) {
        if (liveReload) {
          liveReload.endRequest(ctx.requestId);
        }
        return;
      }
    } catch (e) {
      log.error('error rendering dynamic script: ', e);
      res.status(500).send();
      if (liveReload) {
        liveReload.endRequest(ctx.requestId);
      }
      return;
    }

    try {
      const result = await utils.fetchStatic(ctx);
      res.type(ctx.extension);
      res.send(result.content);
    } catch (err) {
      if (err.code === 404) {
        log.error(`Resource not found: ${ctx.path}`);
      } else {
        log.error(`Error while delivering resource ${ctx.path} - ${err.stack || err}`);
      }
      res.status(err.code || 500).send();
    }
    if (liveReload) {
      liveReload.endRequest(ctx.requestId);
    }
  }

  async setupApp() {
    // setup ESI as express middleware
    const baseUrl = `http://localhost:${this._port}`;
    this._app.use(NodeESI.middleware({
      baseUrl,
      allowedHosts: [/^http.*/],
      cache: false,
      dataProvider: utils.createNodeESIDataProvider({
        baseUrl,
      }),
    }));

    this._app.use(cookieParser());

    // use json body parser
    this._app.use(express.json());

    const handler = asyncHandler(this.handleRequest.bind(this));
    this._app.get('/__internal__/content-proxy/:strain', asyncHandler(this.handleContentProxy.bind(this)));
    this._app.get('*', handler);
    this._app.post('*', handler);
  }

  withPort(port) {
    this._port = port;
    return this;
  }

  isStarted() {
    return this._server !== null;
  }

  get port() {
    return this._port;
  }

  async start() {
    const { log } = this;
    if (this._port !== 0) {
      const inUse = await utils.checkPortInUse(this._port);
      if (inUse) {
        throw new Error(`Port ${this._port} already in use by another process.`);
      }
    }
    log.info(`Starting helix-simulator v${packageJson.version}`);
    await new Promise((resolve, reject) => {
      this._server = this._app.listen(this._port, (err) => {
        if (err) {
          reject(new Error(`Error while starting http server: ${err}`));
        }
        this._port = this._server.address().port;
        log.info(`Local Helix Dev server up and running: http://localhost:${this._port}/`);
        resolve();
      });
      this._project.initLiveReload(this._app, this._server);
    });
    await this.setupApp();
  }

  async stop() {
    const { log } = this;
    if (!this._server) {
      log.warn('server not started.');
      return true;
    }
    return new Promise((resolve, reject) => {
      this._server.close((err) => {
        if (err) {
          reject(new Error(`Error while stopping http server: ${err}`));
        }
        log.info('Local Helix Dev server stopped.');
        this._server = null;
        resolve();
      });
    });
  }
}

module.exports = HelixServer;
