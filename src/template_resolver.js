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
const utils = require('./utils');

/**
 * Resolves the template based on the request context.
 * This simple resolver just uses selector and extension to find the template.
 *
 * @param {RequestContext} ctx
 * @return {String} the resolved template name
 */
const simple = (ctx) => {
  // TODO: be more sophisticated and also check what templates are available for sensitive fallbacks
  let template = ctx.selector ? `${ctx.selector}_` : '';
  template += `${ctx.extension || 'html'}`;
  ctx.logger.debug(`resolved ${ctx.path} -> ${template}`);
  return template;
};

class TemplateResolver {
  constructor() {
    this._plugins = [];
  }

  with(plugin) {
    this._plugins.push(plugin);
    return this;
  }

  /**
   * Resolves the location of the template based on the metadata
   * @param {RequestContext} ctx Context
   * @return {Promise} A promise that resolves to the request context.
   */
  async resolve(ctx) {
    let templateName;

    for (let i = 0; !templateName && i < this._plugins.length; i += 1) {
      templateName = this._plugins[i](ctx);
    }
    templateName = templateName || 'default.html';

    const templatePath = path.resolve(ctx.config.buildDir, `${templateName}.js`);
    try {
      const isFile = await utils.isFile(templatePath);

      if (isFile) {
        ctx.templatePath = templatePath;
        ctx.templateName = templateName;
        return true;
      }
    } catch (error) {
      // isFile fires an error when no file found
      return false;
    }
    return false;
  }
}

module.exports = {
  TemplateResolver,
  Plugins: {
    simple,
  },
};
