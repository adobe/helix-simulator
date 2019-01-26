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

/* global describe, before, after, it */
/* eslint-disable no-underscore-dangle */

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const shell = require('shelljs'); // eslint-disable-line import/no-extraneous-dependencies
const HelixProject = require('../src/HelixProject.js');

if (!shell.which('git')) {
  shell.echo('Sorry, this tests requires git');
  shell.exit(1);
}

// throw a Javascript error when any shell.js command encounters an error
shell.config.fatal = true;

const SPEC_ROOT = path.resolve(__dirname, 'specs');

const SPECS_WITH_GIT = [
  path.join(SPEC_ROOT, 'local'),
];

const SPECS_WITH_FAKE_GIT = [
  path.join(SPEC_ROOT, 'invalid_no_src'),
  path.join(SPEC_ROOT, 'invalid_no_content'),
  path.join(SPEC_ROOT, 'local'),
  path.join(SPEC_ROOT, 'remote'),
  path.join(SPEC_ROOT, 'which_index'),
  path.join(SPEC_ROOT, 'index_is_readme'),
];

function initRepository(dir) {
  const pwd = shell.pwd();
  shell.cd(dir);
  shell.exec('git init');
  shell.exec('git add -A');
  shell.exec('git commit -m"initial commit."');
  shell.cd(pwd);
}

function initFakeRepository(dir) {
  fs.ensureDirSync(path.resolve(dir, '.git'));
}

function removeRepository(dir) {
  shell.rm('-rf', path.resolve(dir, '.git'));
}

describe('Helix Project', () => {
  before(() => {
    // create git repos
    SPECS_WITH_GIT.forEach(initRepository);
    // create fake git repos
    SPECS_WITH_FAKE_GIT.forEach(initFakeRepository);
  });

  after(() => {
    // create fake git repos
    SPECS_WITH_GIT.forEach(removeRepository);
  });

  it('throws error with no repository', async () => {
    try {
      const p = await new HelixProject()
        .withCwd(path.join(SPEC_ROOT, 'invalid_no_git'))
        .init();
      await p.startGitServer();
      assert.fail('expected to fail.');
    } catch (e) {
      assert.equal(e.toString(), 'Error: Local README.md or index.md must be inside a valid git repository.');
    }
  });

  it('throws error with no src directory', async () => {
    try {
      await new HelixProject()
        .withCwd(path.join(SPEC_ROOT, 'invalid_no_src'))
        .init();
      assert.fail('expected to fail.');
    } catch (e) {
      assert.equal(e.toString(), 'Error: Invalid config. No "src" directory.');
    }
  });

  it('throws error with no README.md', async () => {
    try {
      const p = await new HelixProject()
        .withCwd(path.join(SPEC_ROOT, 'invalid_no_content'))
        .init();
      await p.startGitServer();
      assert.fail('expected to fail.');
    } catch (e) {
      assert.equal(e.toString(), 'Error: Invalid config. No "content" location specified and no "README.md" or "index.md" found.');
    }
  });

  it('Logs to custom logger', async () => {
    let count = 0;
    const counter = () => {
      count += 1;
    };

    const logger = {
      info: counter,
      debug: counter,
      getLogger: () => logger,
    };

    const cwd = path.join(SPEC_ROOT, 'local');
    await new HelixProject()
      .withLogger(logger)
      .withCwd(cwd)
      .init();
    assert.ok(count > 0, 'custom logger should have been invoked.');
  });

  it('can set relative build dir', async () => {
    const cwd = path.join(SPEC_ROOT, 'remote');
    const project = await new HelixProject()
      .withCwd(cwd)
      .withBuildDir('tmp/mybuild')
      .init();
    assert.equal(project.buildDir, path.resolve(cwd, 'tmp/mybuild'));
  });

  it('can set absolute build dir', async () => {
    const cwd = path.join(SPEC_ROOT, 'remote');
    const project = await new HelixProject()
      .withCwd(cwd)
      .withBuildDir('/tmp/helix-build')
      .init();
    assert.equal(project.buildDir, path.resolve('/tmp/helix-build'));
  });

  it('can set port', async () => {
    const cwd = path.join(SPEC_ROOT, 'remote');
    const project = await new HelixProject()
      .withCwd(cwd)
      .withHttpPort(0)
      .init();

    await project.start();
    assert.equal(true, project.started);
    assert.notEqual(project.server.port, 0);
    assert.notEqual(project.server.port, 3000);
    await project.stop();
    assert.equal(false, project.started);
  });

  it('can start and stop local project', async () => {
    const cwd = path.join(SPEC_ROOT, 'local');
    const project = await new HelixProject()
      .withCwd(cwd)
      .withHttpPort(0)
      .init();

    await project.start();
    assert.equal(true, project.started);
    await project.stop();
    assert.equal(false, project.started);
  });
});
