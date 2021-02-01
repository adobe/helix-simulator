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
process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const os = require('os');
const assert = require('assert');
const fse = require('fs-extra');
const path = require('path');
const shell = require('shelljs');
const WebSocket = require('faye-websocket');
const HelixProject = require('../src/HelixProject.js');
const {
  createTestRoot, setupProject, wait, assertHttp,
} = require('./utils.js');
const { fetchContext } = require('../src/utils.js');

if (!shell.which('git')) {
  shell.echo('Sorry, this tests requires git');
  shell.exit(1);
}

// throw a Javascript error when any shell.js command encounters an error
shell.config.fatal = true;

const SPEC_ROOT = path.resolve(__dirname, 'specs');

describe('Helix Server with Livereload', () => {
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

  it('deliver livereload script', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/__internal__/livereload.js`, 200, require.resolve('livereload-js/dist/livereload.js'));
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('deliver rendered resource with live reload injected in head', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index_w_lr.html');
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('deliver rendered resource with live reload injected in body', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.nohead.html`, 200, 'expected_index_w_lr_nohead.html');
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('deliver rendered resource with live reload injected in html', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.nobody.html`, 200, 'expected_index_w_lr_nobody.html');
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('deliver rendered resource with live reload no injected with no html', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.nohtml.html`, 200, 'expected_index_w_lr_nohtml.html');
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('livereload informs clients when file is modified', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);

    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index_w_lr.html');

      const ws = new WebSocket.Client(`ws://localhost:${project.server.port}/`);
      let wsReloadData = null;
      let wsHelloData = null;
      const wsOpenPromise = new Promise((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            command: 'hello',
          }));
          ws.send(JSON.stringify({
            command: 'info',
            plugins: [],
            url: `http://localhost:${project.server.port}/index.html`,
          }));
          resolve();
        });
        ws.on('error', reject);
        ws.on('close', resolve);
      });
      const wsPromise = new Promise((resolve, reject) => {
        ws.on('message', (event) => {
          const data = JSON.parse(event.data);
          // console.log(data);
          if (data.command === 'hello') {
            wsHelloData = data;
          } else if (data.command === 'reload') {
            wsReloadData = data;
          } else {
            reject(new Error(`unexpected message: ${event.data}`));
          }
        });
        ws.on('error', reject);
        ws.on('close', resolve);
      });

      await assertHttp(`http://localhost:${project.server.port}/dist/styles.css`, 200, 'expected_styles.css');
      await fse.copy(path.resolve(cwd, 'htdocs/dist/styles1.css'), path.resolve(cwd, 'htdocs/dist/styles.css'));
      await wait(500);
      await wsOpenPromise;
      ws.close();
      // ensure socket properly closes
      await wsPromise;

      // assert no error
      assert.deepEqual(wsHelloData, {
        command: 'hello',
        protocols: [
          'http://livereload.com/protocols/official-7',
        ],
        serverName: 'helix-simulator',
      });
      assert.deepEqual(wsReloadData, {
        command: 'reload',
        liveCSS: true,
        liveImg: true,
        path: '/dist/styles.css',
        reloadMissingCSS: true,
      });
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('livereload informs clients via alert', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.html`, 200, 'expected_index_w_lr.html');

      const ws = new WebSocket.Client(`ws://localhost:${project.server.port}/`);
      let wsAlertData = null;
      let wsHelloData = null;
      const wsOpenPromise = new Promise((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            command: 'hello',
          }));
          ws.send(JSON.stringify({
            command: 'info',
            plugins: [],
            url: `http://localhost:${project.server.port}/index.html`,
          }));
          resolve();
        });
        ws.on('error', reject);
        ws.on('close', resolve);
      });
      const wsPromise = new Promise((resolve, reject) => {
        ws.on('message', (event) => {
          const data = JSON.parse(event.data);
          // console.log(data);
          if (data.command === 'hello') {
            wsHelloData = data;
          } else if (data.command === 'alert') {
            wsAlertData = data;
          } else {
            reject(new Error(`unexpected message: ${event.data}`));
          }
        });
        ws.on('error', reject);
        ws.on('close', resolve);
      });

      await wsOpenPromise;
      project._liveReload.alert('hello alert');
      await wait(500);
      ws.close();
      // ensure socket properly closes
      await wsPromise;

      // assert no error
      assert.deepEqual(wsHelloData, {
        command: 'hello',
        protocols: [
          'http://livereload.com/protocols/official-7',
        ],
        serverName: 'helix-simulator',
      });
      assert.deepEqual(wsAlertData, {
        command: 'alert',
        message: 'hello alert',
      });
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });

  it('deliver rendered resource with deep esi with livereload', async () => {
    const cwd = await setupProject(path.join(SPEC_ROOT, 'local'), testRoot);
    const project = new HelixProject()
      .withCwd(cwd)
      .withBuildDir('./build')
      .withHttpPort(0)
      .withLiveReload(true)
      .withLogsDir(path.resolve(cwd, 'logs'));
    await project.init();
    try {
      await project.start();
      await assertHttp(`http://localhost:${project.server.port}/index.esi1.html`, 200, 'expected_recesi_w_lr.html');
    } finally {
      await fetchContext.reset();
      await project.stop();
    }
  });
});
