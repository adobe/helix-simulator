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
const net = require('net');
const { Strain } = require('@adobe/helix-shared');
const RequestContext = require('../src/RequestContext.js');
const utils = require('../src/utils.js');

const mockConfig = {
  selectStrain() {
    return new Strain({
      name: 'default',
      code: 'https://localhost/helix/local.git',
      content: 'https://localhost/helix/local.git',
      static: 'https://localhost/helix/local.git',
      url: 'http://www.foo.com/docs',
    });
  },
};

const mockConfigContentDir = {
  selectStrain() {
    return new Strain({
      name: 'default',
      code: 'https://localhost/helix/local.git',
      content: 'https://localhost/helix/local.git/api',
      static: 'https://localhost/helix/local.git',
      url: 'http://www.foo.com/docs',
    });
  },
};

describe('Utils Test', () => {
  describe('Request context', () => {
    const TESTS = [
      {
        url: '/', path: '/index.html', resourcePath: '/index', selector: '', extension: 'html',
      },
      {
        url: '/content', path: '/content/index.html', resourcePath: '/content/index', selector: '', extension: 'html',
      },
      {
        url: '/content/index.html', path: '/content/index.html', resourcePath: '/content/index', selector: '', extension: 'html',
      },
      {
        url: '/content/index.foo.html', path: '/content/index.foo.html', resourcePath: '/content/index', selector: 'foo', extension: 'html',
      },
      {
        url: '/docs/index.foo.html', path: '/docs/index.foo.html', resourcePath: '/index', selector: 'foo', extension: 'html', relPath: '/index.foo.html',
      },
      {
        url: '/docs/index.foo.html',
        path: '/docs/index.foo.html',
        resourcePath: '/api/index',
        selector: 'foo',
        extension: 'html',
        relPath: '/index.foo.html',
        config: mockConfigContentDir,
        wskHeaders: {
          'X-Backend-Name': 'localhost--F_Petridish',
          'X-Old-Url': '/docs/index.foo.html',
          'X-Repo-Root-Path': '/api',
          'X-Strain': 'default',
        },
      },
      {
        url: '/content/index.foo.html',
        path: '/content/index.foo.html',
        resourcePath: '/content/index',
        selector: 'foo',
        extension: 'html',
        query: {
          p1: '1',
          p2: true,
        },
        headers: {
          h1: '1',
        },
        expectedJson: {
          extension: 'html',
          headers: {
            h1: '1',
          },
          method: 'GET',
          params: {
            p1: '1',
            p2: true,
          },
          path: '/content/index.foo.html',
          resourcePath: '/content/index',
          selector: 'foo',
          url: '/content/index.foo.html',
        },
        wskHeaders: {
          'X-Backend-Name': 'localhost--F_Petridish',
          'X-Old-Url': '/content/index.foo.html',
          'X-Repo-Root-Path': '',
          'X-Strain': 'default',
          h1: '1',
        },
      },
      {
        url: '/content/index.post.html',
        valid: true,
        path: '/content/index.post.html',
        resourcePath: '/content/index',
        selector: 'post',
        extension: 'html',
        method: 'POST',
        body: {
          content: {
            body: 'Test',
          },
        },
        expectedJson: {
          extension: 'html',
          headers: {},
          params: {},
          method: 'POST',
          path: '/content/index.post.html',
          resourcePath: '/content/index',
          selector: 'post',
          url: '/content/index.post.html',
          body: {
            content: {
              body: 'Test',
            },
          },
        },
      },
    ];

    TESTS.forEach((t) => {
      it(`parses ${t.url} correctly`, () => {
        const mockReq = {
          url: t.url,
          query: t.query,
          headers: t.headers,
          body: t.body || undefined,
          method: t.method || undefined,
        };
        const p = new RequestContext(mockReq, t.config || mockConfig);
        assert.equal(p.url, t.url);
        assert.equal(p.path, t.path, 'path');
        assert.equal(p.resourcePath, t.resourcePath, 'resourcePath');
        assert.equal(p.selector, t.selector, 'selector');
        assert.equal(p.extension, t.extension, 'extension');
        assert.equal(p.mount, '/docs', 'mount');
        assert.equal(p.relPath, t.relPath || t.path, 'relPath');
        assert.deepEqual(p.params, t.query || {}, 'params');
        assert.deepEqual(p.headers, t.headers || {}, 'headers');

        if (t.expectedJson) {
          assert.deepEqual(p.json, t.expectedJson, 'json');
        }

        if (t.wskHeaders) {
          const { wskHeaders } = p;
          delete wskHeaders['X-CDN-Request-ID'];
          delete wskHeaders['X-Openwhisk-Activation-Id'];
          delete wskHeaders['X-Request-Id'];
          assert.deepEqual(wskHeaders, t.wskHeaders);
        }
      });
    });
  });

  describe('Random chars', () => {
    it('generates a random string of the desired length', () => {
      const generated = {};
      for (let i = 0; i < 32; i += 1) {
        const s = utils.randomChars(i);
        assert.equal(s.length, i);
        assert.ok(!generated[s]);
        generated[s] = true;
      }
    });

    it('generates a random hex string of the desired length', () => {
      const generated = {};
      for (let i = 0; i < 32; i += 1) {
        const s = utils.randomChars(i, true);
        if (i > 0) {
          assert.ok(/^[0-9a-f]+$/.test(s));
        }
        assert.equal(s.length, i);
        assert.ok(!generated[s]);
        generated[s] = true;
      }
    });
  });

  describe('Port Check', () => {
    it('detects an occupied port', (done) => {
      const srv = net.createServer().listen();
      srv.on('listening', async () => {
        const inUse = await utils.checkPortInUse(srv.address().port);
        assert.ok(inUse);
        srv.close();
      });
      srv.on('close', async () => {
        done();
      });
    });

    it('detects a free port', (done) => {
      const srv = net.createServer().listen();
      let port = -1;
      srv.on('listening', async () => {
        // eslint-disable-next-line
        port = srv.address().port;
        srv.close();
      });
      srv.on('close', async () => {
        const inUse = await utils.checkPortInUse(port);
        assert.ok(!inUse);
        done();
      });
    });

    it('gives an error for illegal port', async () => {
      try {
        await utils.checkPortInUse(-1);
      } catch (e) {
        // node 8 and node 10 have different errors ....
        assert.ok(e.toString().indexOf('should be >= 0 and < 65536') > 0 // node 8
          || e.toString().indexOf('should be > 0 and < 65536') > 0); // node 10
      }
    });

    it('gives an error for port not available', async () => {
      try {
        await utils.checkPortInUse(0);
      } catch (e) {
        assert.ok(e.toString().startsWith('Error: connect EADDRNOTAVAIL 127.0.0.1 - Local (0.0.0.0:'));
      }
    });
  });
});
