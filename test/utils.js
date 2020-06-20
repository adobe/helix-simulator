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
const { v4: uuidv4 } = require('uuid');
const shell = require('shelljs');

const _isFunction = (fn) => !!(fn && fn.constructor && fn.call && fn.apply);

async function wait(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

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
            const dat = Buffer.concat(data);
            if (spec) {
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
                assert.equal(dat.toString('utf-8').trim(), expected.trim());
              }
            }
            resolve(dat.toString('utf-8'));
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

module.exports = {
  assertHttp,
  setupProject,
  createTestRoot,
  wait,
};
