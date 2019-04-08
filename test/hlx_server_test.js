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

/* eslint-env mocha */
/* eslint-disable no-underscore-dangle */

const assert = require('assert');
const fse = require('fs-extra');
const http = require('http');
const path = require('path');
const uuidv4 = require('uuid/v4');
const shell = require('shelljs');
const { GitUrl } = require('@adobe/helix-shared');
const HelixProject = require('../src/HelixProject.js');

if (!shell.which('git')) {
  shell.echo('Sorry, this tests requires git');
  shell.exit(1);
}

// throw a Javascript error when any shell.js command encounters an error
shell.config.fatal = true;

const _isFunction = fn => !!(fn && fn.constructor && fn.call && fn.apply);

const SPEC_ROOT = path.resolve(__dirname, 'specs');

async function createTestRoot() {
  const dir = path.resolve(__dirname, 'tmp', uuidv4());
  await fse.ensureDir(dir);
  return dir;
}

async function setupProject(srcDir, root, initGit = true) {
  const dir = path.resolve(root, path.basename(srcDir));
  await fse.copy(srcDir, dir);
  if (initGit) {
    const pwd = shell.pwd();
    shell.cd(dir);
    shell.exec('git init');
    shell.exec('git add -A');
    shell.exec('git commit -m"initial commit."');
    shell.cd(pwd);
  }
  return dir;
}

async function assertHttp(url, status, spec, subst) {
  return new Promise((resolve, reject) => {
    const data = [];
    http.get(url, (res) => {
      try {
        assert.equal(res.statusCode, status);
      } catch (e) {
        res.resume();
        reject(e);
      }

      res
        .on('data', (chunk) => {
          data.push(chunk);
        })
        .on('end', () => {
          try {
            if (spec) {
              const dat = Buffer.concat(data);
              let expected = fse.readFileSync(path.resolve(__dirname, 'specs', spec)).toString();
              const repl = (_isFunction(subst) ? subst() : subst) || {};
              Object.keys(repl).forEach((k) => {
                const reg = new RegExp(k, 'g');
                expected = expected.replace(reg, repl[k]);
              });
              if (/\/json/.test(res.headers['content-type'])) {
                assert.equal(JSON.parse(dat).params, JSON.parse(expected).params);
              } else if (/octet-stream/.test(res.headers['content-type'])) {
                expected = JSON.parse(expected).data;
                const actual = dat.toString('hex');
                assert.equal(actual, expected);
              } else {
                assert.equal(data.toString().trim(), expected.trim());
              }
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

describe('Helix Server', () => {
  let testRoot;

  beforeEach(async () => {
    testRoot = await createTestRoot();
  });

  afterEach(async () => {
    await fse.remove(testRoot);
  });

  it('deliver rendered resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver modified helper', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index.html');
      await fse.copy(path.resolve(cwd, 'build/helper2.js'), path.resolve(cwd, 'build/helper.js'));
      project.invalidateCache();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index2.html');
    } finally {
      await project.stop();
    }
  });

  it('does not start on occupied port', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();

      const project2 = new HelixProject()
        .withCwd(cwd)
        .withBuildDir('./build')
        .withHttpPort(project.server.port);
      await project2.init();
      try {
        await project.start();
        assert.fail('server should detect port in use.');
      } catch (e) {
        assert.equal(e.message, `Port ${project.server.port} already in use by another process.`);
      }
    } finally {
      await project.stop();
    }
  });

  it('deliver resource at /', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      // hack in correct port for hostname matching
      project.config.strains.get('default').urls = [`http://127.0.0.1:${project.server.port}`];
      await assertHttp(`http://127.0.0.1:${project.server.port}/`, 200, 'expected_index_dev.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with long URL', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html?xxxxxxxxx=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&xxxxxxxxxxxx=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&xxxxxx=xxxxxxxx|xxxxxxx|xxxxxxxx&xxxxxxxxxxxxx=xxxxx%xxxx|xxxxx%xxxxxxxxx%xxxxxxxxxxxx|xxxxx-xx-xxxxxxxxx-xxxx`, 200, 'expected_index.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with esi', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esi.html`, 200, 'expected_esi.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with deep esi', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esi1.html`, 200, 'expected_recesi.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered json resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.json`, 200, 'expected_index.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered json resource from alternate strain', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      // hack in correct port for hostname matching
      project.config.strains.get('dev').urls = [`http://127.0.0.1:${project.server.port}`];
      await assertHttp(`http://127.0.0.1:${project.server.port}/index.json`, 200, 'expected_index_dev.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver content resource from secondary mapped git repo', async function test() {
    this.timeout(4000);
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const apiRepo = await setupProject(path.join(SPEC_ROOT, 'api_repo'), testRoot);
    const apiUrl = new GitUrl('http://github.com/adobe/helix-api.git');
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    project.registerGitRepository(apiRepo, apiUrl);
    try {
      await project.start();
      // hack in correct port for hostname matching
      project.config.strains.get('default').urls = [`http://127.0.0.1:${project.server.port}`];
      project.config.strains.get('api').urls = [`http://127.0.0.1:${project.server.port}/api`];
      await assertHttp(`http://127.0.0.1:${project.server.port}/index.html`, 200, 'expected_index.html');
      await assertHttp(`http://127.0.0.1:${project.server.port}/api/welcome.txt`, 200, 'expected_api_welcome.txt');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered json resource from alternate strain with request override', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: '127.0.0.1',
        },
      });
    await project.init();
    try {
      await project.start();
      // hack in correct port for hostname matching
      await assertHttp(`http://localhost:${project.server.port}/index.json`, 200, 'expected_index_dev.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered json resource from alternate strain with request override and path', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: '127.0.0.1',
        },
      });
    await project.init();
    try {
      await project.start();
      // hack in correct port for hostname matching
      await assertHttp(`http://localhost:${project.server.port}/docs/api/index.json`, 200, 'expected_index_docs.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver resource from proxy strain', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await project.init();

    const proxyDir = await setupProject(path.join(SPEC_ROOT, 'proxy'), testRoot, false);
    const proxyProject = new HelixProject()
      .withCwd(proxyDir)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await proxyProject.init();

    try {
      await project.start();
      await proxyProject.start();
      proxyProject.config.strains.get('proxy').origin._port = project.server.port;
      await assertHttp(`http://localhost:${proxyProject.server.port}/docs/api/index.json`, 200, 'expected_proxy_docs.json');
    } finally {
      try {
        await project.stop();
      } catch (e) {
        // ignore
      }
      try {
        await proxyProject.stop();
      } catch (e) {
        // ignore
      }
    }
  });

  it('deliver resource from proxy strain can fail', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await project.init();

    const proxyDir = await setupProject(path.join(SPEC_ROOT, 'proxy'), testRoot, false);
    const proxyProject = new HelixProject()
      .withCwd(proxyDir)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await proxyProject.init();

    try {
      await project.start();
      await project.stop();
      await proxyProject.start();
      proxyProject.config.strains.get('proxy').origin._port = project.server.port;
      await assertHttp(`http://localhost:${proxyProject.server.port}/docs/api/index.json`, 500);
    } finally {
      try {
        await project.stop();
      } catch (e) {
        // ignore
      }
      try {
        await proxyProject.stop();
      } catch (e) {
        // ignore
      }
    }
  });

  it('deliver request headers', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      let reqCtx = null;
      project.server.on('request', (req, res, ctx) => {
        reqCtx = ctx;
      });
      await assertHttp(`http://localhost:${project.server.port}/index.dump.html`, 200, 'expected_dump.json', () => ({
        SERVER_PORT: project.server.port,
        GIT_PORT: project.gitState.httpPort,
        X_WSK_ACTIVATION_ID: reqCtx._wskActivationId,
        X_REQUEST_ID: reqCtx._requestId,
        X_CDN_REQUEST_ID: reqCtx._cdnRequestId,
      }));
    } finally {
      await project.stop();
    }
  });

  it('deliver request parameters', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.dump.html?foo=bar&test=me`, 200, 'expected_dump_params.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver binary data', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.binary.html`, 200, 'expected_binary.json');
    } finally {
      await project.stop();
    }
  });

  it('deliver static content resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/welcome.txt`, 200, 'expected_welcome.txt');
    } finally {
      await project.stop();
    }
  });

  it('deliver static content resource from different branch', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const pwd = shell.pwd();
    shell.cd(cwd);
    shell.exec('git checkout -b foo/bar');
    shell.cd(pwd);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/welcome.txt`, 200, 'expected_welcome.txt');
    } finally {
      await project.stop();
    }
  });

  it('deliver static content resource (and webroot)', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/welcome.txt`, 200, 'expected_welcome.txt');
    } finally {
      await project.stop();
    }
  });

  it('deliver static content resource from git', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    await fse.remove(path.resolve(cwd, 'htdocs', 'dist', 'welcome.txt'));
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/dist/styles.css`, 200, 'expected_styles.css');
    } finally {
      await project.stop();
    }
  });

  it('deliver static dist resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/dist/styles.css`, 200, 'expected_styles.css');
    } finally {
      await project.stop();
    }
  });

  it('deliver 404 for static dist non existing', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/dist/notfound.css`, 404);
    } finally {
      await project.stop();
    }
  });

  it('deliver 404 for static content non existing', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/notfound.css`, 404);
    } finally {
      await project.stop();
    }
  });
});
