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
const path = require('path');
const glob = require('glob');
const fse = require('fs-extra');
const utils = require('./utils');

const SRC_PAT = `src${path.sep}`;
const CGI_PAT = `cgi-bin${path.sep}`;

/**
 * The template resolver is used to map requests to template script. On init, it reads the
 * `*.info.json` files to create a map for all scripts.
 */
class TemplateResolver {
  constructor() {
    this._scripts = null;
    this._cwd = process.cwd();
  }

  withDirectory(dir) {
    this._cwd = dir;
    return this;
  }

  async init() {
    const infos = [...glob.sync(`${this._cwd}/**/*.info.json`)];
    const scriptInfos = await Promise.all(infos.map((info) => fse.readJSON(info)));
    this._scripts = {};
    scriptInfos.forEach((info, i) => {
      let { name } = info;
      if (!name) {
        // fallback to legacy info where the action name was not included during build time
        let cgi = false;
        let relPath = path.relative(this._cwd, infos[i]);
        if (relPath.startsWith(SRC_PAT)) {
          relPath = relPath.substring(4);
        } else if (relPath.startsWith(CGI_PAT)) {
          relPath = relPath.substring(8);
          cgi = true;
        }
        const basename = path.basename(relPath, '.info.json');
        if (cgi) {
          name = `cgi-bin-${basename}`;
        } else {
          name = basename;
        }
        // eslint-disable-next-line no-param-reassign
        info.name = name;
        // eslint-disable-next-line no-param-reassign
        info.main = path.resolve(this._cwd, info.main);
      }
      this._scripts[name] = info;
    });
  }

  /**
   * Resolves the location of the template based on the metadata
   * @param {RequestContext} ctx Context
   * @return {Promise} A promise that resolves to the request context.
   */
  async resolve(ctx) {
    // test for cgi
    let templateName;
    if (ctx.path.startsWith('/cgi-bin/')) {
      templateName = `cgi-bin-${path.basename(ctx.path, '.js')}`;
    } else {
      templateName = ctx.selector ? `${ctx.selector}_` : '';
      templateName += `${ctx.extension || 'html'}`;
    }
    ctx.logger.debug(`resolved ${ctx.path} -> ${templateName}`);

    if (!this._scripts[templateName]) {
      ctx.logger.info(`no script for ${templateName}`);
      return false;
    }
    const templatePath = this._scripts[templateName].main;
    try {
      const isFile = await utils.isFile(templatePath);

      if (isFile) {
        ctx.templatePath = templatePath;
        ctx.templateName = templateName;
        return true;
      }
    } catch (error) {
      // isFile fires an error when no file found
      ctx.logger.info(`script file not found: ${templatePath}`);
    }
    return false;
  }
}

module.exports = TemplateResolver;
