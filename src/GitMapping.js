/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
class GitMapping {
  /**
   * Creates a new git mapping.
   * @param {string} repoPath local directory
   * @param {GitUrl} gitUrl the mapped git url
   * @param {string} key the url this server will emulate
   */
  constructor(repoPath, gitUrl, key) {
    this._key = key;
    this._gitUrl = gitUrl;
    this._repoPath = repoPath;
    this._localUrl = null;
  }

  get key() {
    return this._key;
  }

  get gitUrl() {
    return this._gitUrl;
  }

  get repoPath() {
    return this._repoPath;
  }

  get localUrl() {
    return this._localUrl;
  }
}

module.exports = GitMapping;
