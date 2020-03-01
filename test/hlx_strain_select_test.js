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
const path = require('path');
const { HelixConfig } = require('@adobe/helix-shared');
const HelixProject = require('../src/HelixProject.js');

describe('Helix Project - Strain Select', () => {
  it('selects default strain ', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({}).strain.name, 'default');
  });

  it('selects local strain ', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      headers: {
        host: 'localhost:3000',
      },
    }).strain.name, 'local');
  });

  it('selects local docs strain ', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      path: '/docs',
      headers: {
        host: 'localhost:3000',
      },
    }).strain.name, 'localdocs');
  });

  it('selects local docs api strain ', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      path: '/docs/api',
      headers: {
        host: 'localhost:3000',
      },
    }).strain.name, 'localdocs-api');
  });

  it('selects local docs api strain with slash', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      path: '/docs/api',
      headers: {
        host: 'localhost:3000',
      },
    }).strain.name, 'localdocs-api');
  });

  it('selects local docs api strain for deep', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      path: '/docs/api/index.html',
      headers: {
        host: 'localhost:3000',
      },
    }).strain.name, 'localdocs-api');
  });

  it('selects website strain ', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      headers: {
        host: 'project-helix.io',
      },
    }).strain.name, 'website');
  });

  it('selects strain from cookie', async () => {
    const cfg = await new HelixConfig()
      .withConfigPath(path.resolve(__dirname, 'specs', 'strain-select-test.yaml'))
      .init();
    const project = new HelixProject()
      .withHelixConfig(cfg);

    assert.equal(project.selectStrain({
      cookies: {
        foo: 'bar',
      },
    }).strain.name, 'default', 'returns default strain if no X-Strain cookie found');

    assert.equal(project.selectStrain({
      cookies: {
        'X-Strain': 'foo',
      },
    }).strain.name, 'default', 'returns default strain if X-Strain cookie invalid');

    assert.equal(project.selectStrain({
      headers: {
        host: 'project-helix.io',
      },
      cookies: {
        'X-Strain': 'foo',
      },
    }).strain.name, 'website', 'returns host based strain if X-Strain cookie invalid');

    assert.equal(project.selectStrain({
      headers: {
        host: 'project-helix.io',
      },
      cookies: {
        'X-Strain': 'localdocs',
      },
    }).strain.name, 'localdocs', 'returns X-Strain cookie instead of host based strain');
  });
});
