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

const GitUrlParse = require('git-url-parse');

const RAW_TYPE = 'raw';
const API_TYPE = 'api';
const DEFAULT_BRANCH = 'master';
const MATCH_IP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;

const constructUrl = (urlParse, type) => {
  if (MATCH_IP.test(urlParse.resource)) {
    return `${urlParse.protocols[0]}://${urlParse.resource}${urlParse.port ? `:${urlParse.port}` : ''}/${type}`;
  }
  return `${urlParse.protocols[0]}://${type}.${urlParse.resource}${urlParse.port ? `:${urlParse.port}` : ''}`;
};


/**
 * Represents a GIT url.
 */
class GitUrl {
  /**
   * Creates a new GitUrl either from a String URL or from a serialized object.
   * @param {String|GitUrl~JSON} url URL or object defining the new git url.
   * @param {GitUrl~JSON} defaults Defaults for missing properties in the `url` param.
   */
  constructor(url, defaults) {
    if (defaults) {
      this._urlParse = {
        protocols: ['https'],
        resource: url.host || defaults.host || 'github.com',
        port: url.port || defaults.port || '',
        owner: url.owner || defaults.owner,
        name: url.repo || defaults.repo,
        ref: url.ref || defaults.ref,
        filepath: url.path || defaults.path || '',
        toString() {
          return `${this.protocols[0]}://${this.resource}/${this.owner}/${this.name}/${this.ref}${this.path}`;
        },
      };
      return;
    }
    this._urlParse = GitUrlParse(url);
  }

  /**
   * The raw github url in the form 'https://raw.github.com/owner/repo/ref`. In case the
   * {@link #host} is an IP, the returned url is of the form 'https://xxx.xxx.xxx.xxx/raw/owner/repo/ref`.
   * @type String
   */
  get raw() {
    let url = constructUrl(this._urlParse, RAW_TYPE);
    url += `/${this.owner}/${this.repo}/${this.ref}`;
    return url;
  }

  /**
   * Root of the raw github url in the form 'https://raw.github.com`. In case the
   * {@link #host} is an IP, the returned url is of the form 'https://xxx.xxx.xxx.xxx/raw`.
   * @type String
   */
  get rawRoot() {
    return constructUrl(this._urlParse, RAW_TYPE);
  }

  /**
   * Root of the github api in the form 'https://api.github.com`. In case the
   * {@link #host} is an IP, the returned url is of the form 'https://xxx.xxx.xxx.xxx/api`.
   * @type String
   */
  get apiRoot() {
    return constructUrl(this._urlParse, API_TYPE);
  }

  /**
   * Hostname of the repository provider. eg `github.com`
   * @type String
   */
  get host() {
    return this._urlParse.resource;
  }

  /**
   * Port of the repository provider.
   * @type String
   */
  get port() {
    return this._urlParse.port;
  }

  /**
   * Repository owner.
   * @type String
   */
  get owner() {
    return this._urlParse.owner;
  }

  /**
   * Repository name.
   * @type String
   */
  get repo() {
    return this._urlParse.name;
  }

  /**
   * Repository ref, such as `master`.
   * @type String
   */
  get ref() {
    return this._urlParse.ref || DEFAULT_BRANCH;
  }

  /**
   * Resource path. eg `/README.md`
   * @type String
   */
  get path() {
    return this._urlParse.filepath;
  }

  /**
   * String representation of the git url.
   * @returns {String} url.
   */
  toString() {
    return `${this._urlParse}`;
  }

  /**
   * JSON Serialization of GitUrl
   * @typedef {Object} GitUrl~JSON
   * @property {String} host Repository provider host name
   * @property {String} port Repository provider port
   * @property {String} owner Repository owner
   * @property {String} repo Repository name
   * @property {String} ref Repository reference, such as `master`
   * @property {String} path Relative path to the resource
   */

  /**
   * Returns a plain object representation.
   * @returns {GitUrl~JSON} A plain object suitable for serialization.
   */
  toJSON() {
    return {
      host: this.host,
      port: this.port,
      owner: this.owner,
      repo: this.repo,
      ref: this.ref,
      path: this.path,
    };
  }
}

module.exports = GitUrl;
