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

const GitUrl = require('./GitUrl.js');

/**
 * Static content handling
 * @property {GitUrl} url
 * @property {boolean} magic
 * @property {String[]} allow
 * @property {String[]} deny
 */
class Static {
  constructor(cfg, defaults) {
    this._url = new GitUrl(cfg, defaults);
    this._magic = cfg.magic || false;
    this._allow = cfg.allow || [];
    this._deny = cfg.deny || [];
  }

  get url() {
    return this._url;
  }

  get magic() {
    return this._magic;
  }

  get allow() {
    return this._allow;
  }

  get deny() {
    return this._deny;
  }

  toPlainObject() {
    return Object.assign({}, this.url.toPlainObject(), {
      magic: this.magic,
      allow: this.allow,
      deny: this.deny,
    });
  }
}

/**
 * Strain
 * @property {String} name
 * @property {String} code
 * @property {GitUrl} content
 * @property {Static} staticContent
 * @property {String} condition
 * @property {String} directoryIndex
 */
class Strain {
  constructor(name, cfg, defaults) {
    this._name = name;
    this._content = new GitUrl(cfg.content || {}, defaults.content);
    this._code = cfg.code || '';
    const staticDefaults = Object.assign({}, defaults.code.toPlainObject(), {
      root: defaults.staticRoot,
    });
    this._static = new Static(cfg.static || {}, staticDefaults);
    this._condition = cfg.condition || '';
    this._directoryIndex = cfg.directoryIndex || defaults.directoryIndex;
  }

  get name() {
    return this._name;
  }

  get content() {
    return this._content;
  }

  get code() {
    return this._code;
  }

  get static() {
    return this._static;
  }

  get condition() {
    return this._condition;
  }

  get directoryIndex() {
    return this._directoryIndex;
  }

  toPlainObject() {
    return {
      name: this.name,
      code: this.code, // .toPlainObject(),
      content: this.content.toPlainObject(),
      static: this.static.toPlainObject(),
      condition: this.condition,
      directoryIndex: this.directoryIndex,
    };
  }
}

module.exports = Strain;
