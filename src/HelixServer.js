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
const { Module } = require('module');
const express = require('express');
const NodeESI = require('nodesi');
const rp = require('request-promise-native');
const { Logger } = require('@adobe/helix-shared');
const querystring = require('querystring');
const utils = require('./utils.js');

const RequestContext = require('./RequestContext.js');
const { TemplateResolver, Plugins: TemplateResolverPlugins } = require('../src/template_resolver');

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
 * Executes the template and resolves with the content.
 * @param {RequestContext} ctx Context
 * @return {Promise} A promise that resolves to generated output.
 */
function executeTemplate(ctx) {
  // the compiled script does not bundle the modules that are required for execution, since it
  // expects them to be provided by the runtime. We tweak the module loader here in order to
  // inject the project module paths.

  /* eslint-disable no-underscore-dangle */
  const nodeModulePathsFn = Module._nodeModulePaths;
  Module._nodeModulePaths = function nodeModulePaths(from) {
    let paths = nodeModulePathsFn.call(this, from);

    // only tweak module path for scripts in build dir
    if (from === ctx.config.buildDir) {
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

  return Promise.resolve(mod.main({
    __ow_headers: owHeaders,
    __ow_method: ctx.method.toLowerCase(),
    __ow_logger: ctx.logger,
    owner: ctx.strain.content.owner,
    repo: ctx.strain.content.repo,
    ref: ctx.strain.content.ref || 'master',
    path: `${ctx.resourcePath}.md`,
    selector: ctx._selector,
    extension: ctx._extension,
    rootPath: ctx._mount,
    content: ctx._content,
    params: querystring.stringify(ctx._params),
    REPO_RAW_ROOT: `${ctx.strain.content.rawRoot}/`, // the pipeline needs the final slash here
    REPO_API_ROOT: `${ctx.strain.content.apiRoot}/`,
  }));
  /* eslint-enable no-underscore-dangle */
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

    // todo: make configurable
    this._templateResolver = new TemplateResolver().with(TemplateResolverPlugins.simple);
  }

  async init() {
    /* eslint-disable no-underscore-dangle */
    this._logger = this._project._logger || Logger.getLogger('hlx');
  }

  async setupApp() {
    const log = this._logger;

    // setup ESI as express middleware
    this._app.use(NodeESI.middleware({
      baseUrl: `http://localhost:${this._port}`,
      allowedHosts: [/^http.*/],
      cache: false,
      httpClient: rp.defaults({
        resolveWithFullResponse: true,
      }),
    }));

    // read JSON request body
    this._app.use(express.json());

    const handler = async (req, res) => {
      const ctx = new RequestContext(req, this._project);
      ctx.logger = log;

      log.debug(`current strain: ${ctx.strain.name}: ${JSON.stringify(ctx.strain.toJSON({ minimal: true, keepFormat: true }), null, 2)}`);

      // handle proxy requests if needed
      if (ctx.strain.isProxy()) {
        try {
          await utils.proxyRequest(ctx, req, res);
        } catch (err) {
          this._logger.error(`Error during proxy: ${err.stack || err}`);
          res.status(500).send();
        }
        return;
      }

      // start git server if needed and adjust content and static url
      if (ctx.strain.content.isLocal) {
        await ctx.config.startGitServer();
        ctx.strain.content = ctx.config.gitUrl;
      }
      if (ctx.strain.static.url.isLocal) {
        await ctx.config.startGitServer();
        ctx.strain.static.url = ctx.config.gitUrl;
      }

      this.emit('request', req, res, ctx);
      if (!ctx.valid) {
        res.status(404).send();
        return;
      }

      const isResolved = await this._templateResolver.resolve(ctx);
      if (isResolved) {
        // md files to be transformed
        Promise.resolve(ctx)
          .then(executeTemplate)
          .then((result) => {
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
            let body = result.body || '';
            const headers = result.headers || {};
            const status = result.statusCode || 200;
            const contentType = headers['Content-Type'] || 'text/html';
            if (/.*\/json/.test(contentType)) {
              body = JSON.stringify(body, safeCycles());
            } else if (/.*\/octet-stream/.test(contentType) || /image\/.*/.test(contentType)) {
              body = Buffer.from(body, 'base64');
            }
            res.set(headers).status(status).send(body);
          })
          .catch((err) => {
            this._logger.error(`Error while delivering resource ${ctx.path} - ${err.stack || err}`);
            res.status(500).send();
          });
      } else {
        // all the other files (css, images...)
        // for now, fetch from dist or content.
        Promise.resolve(ctx)
          .then(utils.fetchStatic)
          .then((result) => {
            res.type(ctx.extension);
            res.send(result.content);
          }).catch((err) => {
            if (err.code === 404) {
              this._logger.error(`Resource not found: ${ctx.path}`);
            } else {
              this._logger.error(`Error while delivering resource ${ctx.path} - ${err.stack || err}`);
            }
            res.status(err.code || 500).send();
          });
      }
    };
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
    if (this._port !== 0) {
      const inUse = await utils.checkPortInUse(this._port);
      if (inUse) {
        throw new Error(`Port ${this._port} already in use by another process.`);
      }
    }
    this._logger.info('starting project');
    await new Promise((resolve, reject) => {
      this._server = this._app.listen(this._port, (err) => {
        if (err) {
          reject(new Error(`Error while starting http server: ${err}`));
        }
        this._port = this._server.address().port;
        this._logger.info(`Local Helix Dev server up and running: http://localhost:${this._port}/`);
        resolve();
      });
    });
    await this.setupApp();
  }

  async stop() {
    if (!this._server) {
      throw new Error('not started.');
    }
    return new Promise((resolve, reject) => {
      this._server.close((err) => {
        if (err) {
          reject(new Error(`Error while stopping http server: ${err}`));
        }
        this._logger.info('Local Helix Dev server stopped.');
        this._server = null;
        resolve();
      });
    });
  }
}

module.exports = HelixServer;
