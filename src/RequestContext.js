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
    const req = Object.assign({}, request, cfg.requestOverride);
    if (cfg.requestOverride && cfg.requestOverride.headers) {
      req.headers = Object.assign({}, request.headers, cfg.requestOverride.headers);
    }

    const { url } = req;
    this._cfg = cfg || {};
    this._url = url;
    this._path = parse(url).pathname || '/'; // get the path name without query string
    this._selector = '';
    this._extension = '';
    this._headers = req.headers || {};
    this._method = req.method || 'GET';
    this._params = req.query || {};
    this._wskActivationId = utils.randomChars(32, true);
    this._requestId = utils.randomChars(32);
    this._cdnRequestId = utils.uuid();
    this._strain = cfg.selectStrain(Object.assign({}, req, {
      path: this._path,
    }));
    if (this._strain.urls.length > 0) {
      this._mount = parse(this._strain.urls[0]).pathname.replace(/\/+$/, '');
    } else {
      this._mount = '';
    }

    const lastSlash = this._path.lastIndexOf('/');
    let lastDot = this._path.lastIndexOf('.');
    if (lastDot <= lastSlash) {
      // no extension means a folder request
      const index = this._strain.directoryIndex || 'index.html';
      this._path = `${this._path}/${index}`;
      // remove multiple slashes
      this._path = this._path.replace(/\/+/g, '/');
      lastDot = this._path.lastIndexOf('.');
    }

    // remove mount root if needed
    let relPath = this._path.substring(0, lastDot);

    const queryParamIndex = this._path.lastIndexOf('?');
    this._extension = this._path.substring(
      lastDot + 1,
      (queryParamIndex !== -1 ? queryParamIndex : this._path.length),
    );
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

    this._resourcePath = relPath;

    // generate headers
    this._wskHeaders = Object.assign({
      'X-Openwhisk-Activation-Id': this._wskActivationId,
      'X-Request-Id': this._requestId,
      'X-Backend-Name': 'localhost--F_Petridish',
      'X-CDN-Request-ID': this._cdnRequestId,
      'X-Strain': this._strain.name,
    }, this._headers);
  }

  get url() {
    return this._url;
  }

  // eslint-disable-next-line class-methods-use-this
  get valid() {
    return true;
  }

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

  get resourcePath() {
    return this._resourcePath;
  }

  get extension() {
    return this._extension;
  }

  get selector() {
    return this._selector;
  }

  get headers() {
    return this._headers;
  }

  get wskHeaders() {
    return this._wskHeaders;
  }

  get method() {
    return this._method;
  }

  get params() {
    return this._params;
  }

  get strain() {
    return this._strain;
  }

  get mount() {
    return this._mount;
  }

  get relPath() {
    return this._relPath;
  }

  get json() {
    const o = {
      url: this.url,
      resourcePath: this.resourcePath,
      path: this.path,
      selector: this.selector,
      extension: this.extension,
      method: this.method,
      headers: this.headers,
      params: this.params,
    };
    return o;
  }
};
