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

const os = require('os');
const assert = require('assert');
const fse = require('fs-extra');
const http = require('http');
const path = require('path');
const uuidv4 = require('uuid/v4');
const shell = require('shelljs');
const nock = require('nock');
const { GitUrl } = require('@adobe/helix-shared');
const HelixProject = require('../src/HelixProject.js');

if (!shell.which('git')) {
  shell.echo('Sorry, this tests requires git');
  shell.exit(1);
}

// throw a Javascript error when any shell.js command encounters an error
shell.config.fatal = true;

const _isFunction = (fn) => !!(fn && fn.constructor && fn.call && fn.apply);

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

// todo: use replay ?

async function assertHttp(config, status, spec, subst) {
  return new Promise((resolve, reject) => {
    const data = [];
    const requestHandler = (res) => {
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
    };
    const errorHandler = (e) => {
      reject(e);
    };
    if (typeof config === 'string') {
      // use as URL and do GET
      http.get(config, requestHandler).on('error', errorHandler);
    } else {
      // do POST
      const postStr = config.postData ? JSON.stringify(config.postData) : '';
      const { options } = config;
      options.method = 'POST';
      options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postStr),
      };
      const req = http.request(options, requestHandler);
      req.on('error', errorHandler);
      req.write(postStr);
      req.end();
    }
  });
}

describe('Helix Server', () => {
  let testRoot;

  beforeEach(async () => {
    testRoot = await createTestRoot();
  });

  afterEach(async () => {
    if (os.platform() === 'win32') {
      // Note: the async variant of remove hangs on windows, probably due to open filehandle to
      // logs/request.log
      fse.removeSync(testRoot);
    } else {
      await fse.remove(testRoot);
    }
  });

  it('deliver rendered resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver index for directory requests', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/docs/`, 200, 'expected_docs_index.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver redirect for directory requests', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/docs`, 302);
    } finally {
      await project.stop();
    }
  });

  it('deliver modified helper', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index.html');
      await fse.copy(path.resolve(cwd, 'build/helper2.js'), path.resolve(cwd, 'build/helper.js'));
      await project.invalidateCache();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index2.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver modified module', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index.html');
      await fse.copy(path.resolve(cwd, 'src/module2.js'), path.resolve(cwd, 'src/module.js'));
      await project.invalidateCache();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index3.html');
    } finally {
      await project.stop();
    }
  });

  it('does not start on occupied port', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esi.html`, 200, 'expected_esi.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with esi typo', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esitypo.html`, 200, 'expected_esitypo.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with malformed esi tag', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.malformedesi.html`, 200, 'expected_malformedesi.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with relative esi', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      // todo: verify behaviour on edge
      await assertHttp(`http://localhost:${project.server.port}/docs/api/index.esirel.html`, 200, 'expected_esirel.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with deep esi', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esi1.html`, 200, 'expected_recesi.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource with esi and with no esi:remove', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esiremove1.html`, 200, 'expected_esiremove1.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered resource without esi:remove', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esiremove2.html`, 200, 'expected_esiremove2.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver rendered json resource', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
    this.timeout(10000);
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const apiRepo = await setupProject(path.join(SPEC_ROOT, 'api_repo'), testRoot);
    const apiUrl = new GitUrl('http://github.com/adobe/helix-api.git');
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    project.registerGitRepository(apiRepo, apiUrl);
    try {
      await project.start();
      // hack in correct port for hostname matching
      project.config.strains.get('default').urls = [`http://127.0.0.1:${project.server.port}`];
      project.config.strains.get('api').urls = [`http://127.0.0.1:${project.server.port}/api`];
      await assertHttp(`http://127.0.0.1:${project.server.port}/api/introduction.html`, 200, 'expected_api_introduction.html');
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
      .withLogsDir(path.resolve(cwd, 'logs'))
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
      .withLogsDir(path.resolve(cwd, 'logs'))
      .withRequestOverride({
        headers: {
          host: '127.0.0.1',
        },
      });
    await project.init();
    try {
      await project.start();
      // hack in correct port for hostname matching
      await assertHttp(`http://localhost:${project.server.port}/docs/general/index.json`, 200, 'expected_index_docs.json');
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
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();

    const proxyDir = await setupProject(path.join(SPEC_ROOT, 'proxy'), testRoot, false);
    const proxyProject = new HelixProject()
      .withCwd(proxyDir)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(proxyDir, 'logs'))
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

  it('deliver resource from proxy strain with chroot', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();

    const proxyDir = await setupProject(path.join(SPEC_ROOT, 'proxy'), testRoot, false);
    const proxyProject = new HelixProject()
      .withCwd(proxyDir)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(proxyDir, 'logs'))
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await proxyProject.init();

    try {
      await project.start();
      await proxyProject.start();
      proxyProject.config.strains.get('proxy_help').origin._port = project.server.port;
      await assertHttp(`http://localhost:${proxyProject.server.port}/help/docs/api/index.json`, 200, 'expected_proxy_docs_chroot.json');
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

  it('deliver resource from proxy strain with chroot on directory index', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();

    const proxyDir = await setupProject(path.join(SPEC_ROOT, 'proxy'), testRoot, false);
    const proxyProject = new HelixProject()
      .withCwd(proxyDir)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(proxyDir, 'logs'))
      .withRequestOverride({
        headers: {
          host: 'proxy.local',
        },
      });
    await proxyProject.init();

    try {
      await project.start();
      await proxyProject.start();
      proxyProject.config.strains.get('proxy_help').origin._port = project.server.port;
      await assertHttp(`http://localhost:${proxyProject.server.port}/help/docs/api`, 200, 'expected_proxy_docs_chroot.html');
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
      .withLogsDir(path.resolve(cwd, 'logs'))
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
      .withLogsDir(path.resolve(proxyDir, 'logs'))
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/dist/styles.css`, 200, 'expected_styles.css');
    } finally {
      await project.stop();
    }
  });

  it('deliver static html from htdocs', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/404.html`, 200, 'expected_404.html');
    } finally {
      await project.stop();
    }
  });

  it('deliver 404 for static dist non existing', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
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
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/notfound.css`, 404);
    } finally {
      await project.stop();
    }
  });

  it('serve post request', async () => {
    const cwd = path.join(SPEC_ROOT, 'local');
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp({
        options: {
          hostname: 'localhost',
          port: project.server.port,
          path: '/index.html',
        },
        postData: {},
      }, 200, 'expected_index.html');
    } finally {
      await project.stop();
    }
  });

  it('user provided action parameters get passed to Server', async () => {
    const cwd = path.join(SPEC_ROOT, 'local');
    const fakeParams = { HTTP_TIMEOUT: 2000, FAKE_SECRET: 'shhhh keep it secret' };
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'))
      .withActionParams(fakeParams);

    await project.init();
    try {
      await project.start();
      assert.equal(project._server._project.actionParams, fakeParams);
    } finally {
      await project.stop();
      assert.equal(false, project.started);
    }
  });

  it('read developer default action parameters and form http response', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const fakeParams = { MY_TEST: 50 };

    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'))
      .withActionParams(fakeParams);
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.param.json`, 200, 'expected_params.json');
    } finally {
      await project.stop();
    }
  });

  it('serve post with custom content.body', async () => {
    const cwd = path.join(SPEC_ROOT, 'local');

    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp({
        options: {
          hostname: 'localhost',
          port: project.server.port,
          path: '/index.post.html',
        },
        postData: {
          content: {
            body: 'Hello, universe',
          },
        },
      }, 200, 'expected_index_post.html');
    } finally {
      await project.stop();
    }
  });

  it('executes cgi-bin', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/cgi-bin/post.js`, 200, 'expected_cgi.txt');
    } finally {
      await project.stop();
    }
  });
});

describe('Private Repo Tests', () => {
  let testRoot;

  beforeEach(async () => {
    testRoot = await createTestRoot();
  });

  afterEach(async () => {
    if (os.platform() === 'win32') {
      // Note: the async variant of remove hangs on windows, probably due to open filehandle to
      // logs/request.log
      fse.removeSync(testRoot);
    } else {
      await fse.remove(testRoot);
    }
    nock.cleanAll();
  });

  it('deliver static resource from private repository', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'remote'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withActionParams({
        GITHUB_TOKEN: '1234',
      })
      .withHttpPort(0)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();

    function handler() {
      if (this.req.headers.authorization === 'Bearer 1234') {
        return [
          200,
          'This is a static resource.',
          { 'content-type': 'text/plain' },
        ];
      }
      return [401, '', { }];
    }

    nock('https://raw.github.com')
      .get('/Adobe-Marketing-Cloud/reactor-user-docs/master/welcome.txt')
      .reply(handler);
    nock('https://raw.githubusercontent.com')
      .get('/Adobe-Marketing-Cloud/reactor-user-docs/master/welcome.txt')
      .reply(handler);
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/welcome.txt`, 200, 'expected_welcome.txt');
    } finally {
      await project.stop();
    }
  });
});
