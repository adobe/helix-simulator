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
const request = require('request-promise');

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
   * Fetches content from the given uri.
   * @param {String} uri Either filesystem path (starting with '/') or URL
   * @returns {*} The requested content
   */
  async fetch(uri) {
    if (uri.charAt(0) === '/') {
      return fs.readFile(uri);
    }
    try {
      const response = await request({
        method: 'GET',
        uri,
        resolveWithFullResponse: true,
        encoding: null,
      });
      return response.body;
    } catch (e) {
      throw new Error(`resource at ${uri} does not exist. got ${e.response.statusCode} from server`);
    }
  },

  /**
   * Fetches static resources and stores it in the context.
   * @param {RequestContext} ctx Context
   * @return {Promise} A promise that resolves to the request context.
   */
  async fetchStatic(ctx) {
    const uri = ctx.config.contentRepo.raw + ctx.path;
    const data = await utils.fetch(uri);
    ctx.content = Buffer.from(data, 'utf8');
    return ctx;
  },

};

module.exports = Object.freeze(utils);
