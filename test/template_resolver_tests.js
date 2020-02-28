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

/* global describe, it */

const assert = require('assert');
const path = require('path');
const { Strain } = require('@adobe/helix-shared');
const TemplateResolver = require('../src/TemplateResolver.js');
const RequestContext = require('../src/RequestContext.js');

const BUILD_DIR = path.resolve(__dirname, 'specs', 'builddir');

const mockConfig = {
  selectStrain() {
    return {
      strain: new Strain({
        name: 'default',
        code: 'https://localhost/helix/local.git',
        content: 'https://localhost/helix/local.git',
        static: 'https://localhost/helix/local.git',
      }),
    };
  },
};

describe('Template Resolver', () => {
  describe('Simple', () => {
    const TESTS = [
      {
        url: '/', template: 'html', script: 'html.js',
      },
      {
        url: '/index.html', template: 'html', script: 'html.js',
      },
      {
        url: '/index.print.html', template: 'print_html', script: 'print_html.js',
      },
      {
        url: '/homepage.txt', template: 'txt', script: 'txt.js',
      },
    ];

    TESTS.forEach((t) => {
      it(`resolves template script for ${t.url} correctly`, async () => {
        const mockReq = {
          url: t.url,
        };
        const ctx = new RequestContext(mockReq, ({ buildDir: BUILD_DIR, ...mockConfig }));
        ctx.logger = console;
        const res = new TemplateResolver().withDirectory(BUILD_DIR);
        await res.init();

        const templatePath = path.resolve(BUILD_DIR, t.script);
        assert.equal(true, await res.resolve(ctx), 'Template resolves for an existent file');
        assert.equal(ctx.templatePath, templatePath, 'resolved template path');
      });
    });

    it('fails for non existent script', async () => {
      const mockReq = {
        url: '/index.nonexistent.html',
      };
      const ctx = new RequestContext(mockReq, ({ buildDir: BUILD_DIR, ...mockConfig }));
      ctx.logger = console;
      const res = new TemplateResolver().withDirectory(BUILD_DIR);
      await res.init();
      assert.equal(false, await res.resolve(ctx), 'Template does not resolve for a non existent file');
    });

    it('fails for non existent file', async () => {
      const mockReq = {
        url: '/index.noscript.html',
      };
      const ctx = new RequestContext(mockReq, ({ buildDir: BUILD_DIR, ...mockConfig }));
      ctx.logger = console;
      const res = new TemplateResolver().withDirectory(BUILD_DIR);
      await res.init();
      assert.equal(false, await res.resolve(ctx), 'Template does not resolve for a non existent file');
    });

    it('fails for directory instead of file', async () => {
      const mockReq = {
        url: '/index.wrong.html',
      };
      const ctx = new RequestContext(mockReq, ({ buildDir: BUILD_DIR, ...mockConfig }));
      ctx.logger = console;
      const res = new TemplateResolver().withDirectory(BUILD_DIR);
      await res.init();
      assert.equal(false, await res.resolve(ctx), 'Template does not resolve for a directory');
    });
  });
});
