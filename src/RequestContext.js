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

const { parse } = require('url');
const utils = require('./utils.js');

/**
 * Context that is used during request handling.
 *
 * @type {module.RequestContext}
 */
module.exports = class RequestContext {
  constructor(request, cfg) {
    // todo: consider using lodash.defaultsDeep
    const req = { ...request, ...cfg.requestOverride };
    if (cfg.requestOverride && cfg.requestOverride.headers) {
      req.headers = { ...request.headers, ...cfg.requestOverride.headers };
    }

    const { url } = req;
    this._cfg = cfg || {};
    this._url = url;
    const purl = parse(url);
    this._path = purl.pathname || '/';
    this._queryString = purl.search || '';
    this._selector = '';
    this._extension = '';
    this._headers = req.headers || {};
    this._method = req.method || 'GET';
    this._params = req.query || {};
    this._wskActivationId = utils.randomChars(32, true);
    this._requestId = utils.randomChars(32);
    this._cdnRequestId = utils.uuid();

    ({
      strain: this._strain,
      mount: this._mount,
    } = cfg.selectStrain({ ...req, path: this._path }));

    if (!this._mount) {
      if (this._strain.urls.length > 0) {
        this._mount = parse(this._strain.urls[0]).pathname.replace(/\/+$/, '');
      } else {
        this._mount = '';
      }
    }

    if (req.body && Object.entries(req.body).length > 0) {
      this._body = req.body;
    }
    const lastSlash = this._path.lastIndexOf('/');
    if (lastSlash === this._path.length - 1) {
      // directory request
      const index = this._strain.directoryIndex || 'index.html';
      // append index and remove multiple slashes
      this._path = `${this._path}${index}`.replace(/\/+/g, '/');
    }
    const lastDot = this._path.lastIndexOf('.');
    let relPath = lastDot >= 0 ? this._path.substring(0, lastDot) : this._path;

    if (lastDot > lastSlash) {
      this._extension = this._path.substring(lastDot + 1);
    }
    // check for selector
    const selDot = relPath.lastIndexOf('.');
    if (selDot > lastSlash) {
      this._selector = relPath.substring(selDot + 1);
      relPath = relPath.substring(0, selDot);
    }
    this._relPath = this._path;

    // remove mount root if needed
    if (this._mount && this.mount !== '/') {
      // strain selection should only select strains that match the url. but better check again
      if (`${relPath}/`.startsWith(`${this._mount}/`)) {
        relPath = relPath.substring(this._mount.length);
        this._relPath = this._relPath.substring(this._mount.length);
      }
    }

    // prepend any content repository path
    const repoPath = this._strain.content ? this._strain.content.path : '';
    if (repoPath && repoPath !== '/') {
      relPath = repoPath + relPath;
    }

    this._resourcePath = relPath;

    // generate headers
    this._wskHeaders = {
      'X-Openwhisk-Activation-Id': this._wskActivationId,
      'X-Request-Id': this._requestId,
      'X-Backend-Name': 'localhost--F_Petridish',
      'X-CDN-Request-ID': this._cdnRequestId,
      'X-CDN-URL': `${request.protocol}://${request.get('host')}${request.originalUrl}`,
      'X-Strain': this._strain.name,
      'X-Old-Url': this._url,
      'X-Repo-Root-Path': repoPath,
      ...this._headers,
    };
  }

  /**
   * the original request url
   */
  get url() {
    return this._url;
  }

  /**
   * the request path, including any directoryIndex mapping.
   * @returns {*|string}
   */
  get path() {
    return this._path;
  }

  /**
   * The helix project configuration.
   * @returns {HelixProject}
   */
  get config() {
    return this._cfg;
  }

  /**
   * The request body.
   * @returns {Object}
   */
  get body() {
    return this._body;
  }

  /**
   * The path to the resource in the repository.
   * @returns {string}
   */
  get resourcePath() {
    return this._resourcePath;
  }

  /**
   * The file extension of the request path.
   * @returns {string|*}
   */
  get extension() {
    return this._extension;
  }

  /**
   * the selector of the request path.
   * @returns {string|string}
   */
  get selector() {
    return this._selector;
  }

  /**
   * The client request headers.
   * @returns {any | {}}
   */
  get headers() {
    return this._headers;
  }

  /**
   * extra headers that openwhisk / fastly would set.
   * @returns {any | {}}
   */
  get wskHeaders() {
    return this._wskHeaders;
  }

  /**
   * The request method
   * @returns {*|string}
   */
  get method() {
    return this._method;
  }

  /**
   * The request params (query)
   * @returns {any | {}}
   */
  get params() {
    return this._params;
  }

  /**
   * Developer default request params.
   * @returns {any | {}}
   */

  get actionParams() {
    return this._cfg.actionParams;
  }

  /**
   * The currently selected strain.
   * @returns {Strain}
   */
  get strain() {
    return this._strain;
  }

  /**
   * The mount point of the strain.
   * @returns {string}
   */
  get mount() {
    return this._mount;
  }

  /**
   * The relative path. i.e. the request path without the mount path.
   * @returns {*}
   */
  get relPath() {
    return this._relPath;
  }

  /**
   * Returns the queryString of the url (including the ?)
   * @returns {string}
   */
  get queryString() {
    return this._queryString;
  }

  get json() {
    const o = {
      url: this.url,
      queryString: this.queryString,
      resourcePath: this.resourcePath,
      path: this.path,
      selector: this.selector,
      extension: this.extension,
      method: this.method,
      headers: this.headers,
      params: this.params,
    };
    if (this.body) {
      o.body = this.body;
    }
    return o;
  }
};
