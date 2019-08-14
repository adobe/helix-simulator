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

const fs = require('fs-extra');
const { URL } = require('url');
const path = require('path');
const { Logger, HelixConfig } = require('@adobe/helix-shared');
const HelixServer = require('./HelixServer.js');
const GitManager = require('./GitManager.js');

const SRC_DIR = 'src';

const DEFAULT_BUILD_DIR = '.hlx/build';

const GIT_DIR = '.git';

async function isDirectory(dirPath) {
  return fs.stat(dirPath).then((stats) => stats.isDirectory()).catch(() => false);
}

class HelixProject {
  constructor() {
    this._cwd = process.cwd();
    this._srcDir = '';
    this._repoPath = '';
    this._cfg = null;
    this._buildDir = DEFAULT_BUILD_DIR;
    this._runtimePaths = module.paths;
    this._server = new HelixServer(this);
    this._logger = null;
    this._requestOverride = null;
    this._gitMgr = null;
  }

  withCwd(cwd) {
    this._cwd = cwd;
    return this;
  }

  withHttpPort(port) {
    this._server.withPort(port);
    return this;
  }

  withBuildDir(dir) {
    this._buildDir = dir;
    return this;
  }

  withHelixConfig(cfg) {
    this._cfg = cfg;
    return this.withLogger(cfg.log);
  }

  /**
   * @deprecated
   */
  withDisplayVersion(v) {
    this._displayVersion = v;
    return this;
  }

  withRuntimeModulePaths(paths) {
    this._runtimePaths = paths;
    return this;
  }

  withLogger(logger) {
    this._logger = logger;
    return this;
  }

  withRequestOverride(value) {
    this._requestOverride = value;
    return this;
  }

  withSourceDir(value) {
    this._srcDir = value;
    return this;
  }

  registerGitRepository(repoPath, gitUrl) {
    this._gitMgr.registerServer(repoPath, gitUrl);
    return this;
  }

  get log() {
    return this._logger;
  }

  get config() {
    return this._cfg;
  }

  get buildDir() {
    return this._buildDir;
  }

  get runtimeModulePaths() {
    return this._runtimePaths;
  }

  get started() {
    return this._server.isStarted();
  }

  get gitState() {
    return this._gitMgr ? this._gitMgr.state : null;
  }

  get requestOverride() {
    return this._requestOverride;
  }

  /**
   * Returns the helix server
   * @returns {HelixServer}
   */
  get server() {
    return this._server;
  }

  async checkPaths() {
    if (!this._srcDir) {
      const srcPath = path.join(this._cwd, SRC_DIR);
      if (await isDirectory(srcPath)) {
        this._srcDir = srcPath;
      }
    }

    this._buildDir = path.resolve(this._cwd, this._buildDir);

    const dotGitPath = path.join(this._cwd, GIT_DIR);
    if (await isDirectory(dotGitPath)) {
      this._repoPath = path.resolve(dotGitPath, '../');
    }
  }

  selectStrain(request) {
    // look for X-Strain cookie first
    if (request.cookies) {
      const cstrain = this.config.strains.get(request.cookies['X-Strain']);
      if (cstrain) {
        return cstrain;
      }
    }
    // todo: use strain conditions, once implemented. for now, just use request.headers.host
    const host = request && request.headers ? request.headers.host : '';
    const reqPath = `${request && request.path && request.path.replace(/\/+$/, '') ? request.path : ''}/`;
    const strains = this.config.strains.getByFilter((strain) => {
      if (strain.urls.length === 0) {
        return false;
      }
      const uri = new URL(strain.urls[0]);
      if (uri.host !== host) {
        return false;
      }
      const uriPath = `${uri.pathname.replace(/\/+$/, '')}/`;
      return reqPath.indexOf(uriPath) === 0;
    });
    if (strains.length > 0) {
      return strains[0];
    }
    return this.config.strains.get('default');
  }

  /**
   * Invalidates the node module cache of the file in the build directory.
   */
  invalidateCache() {
    // we simple remove all entries from the node cache that fall below the build or src directory
    Object.keys(require.cache).forEach((file) => {
      if (file.startsWith(this._buildDir) || (this._srcDir && file.startsWith(this._srcDir))) {
        delete require.cache[file];
        this.log.debug(`evicted ${path.relative(this._cwd, file)}`);
      }
    });
  }

  async init() {
    if (!this._logger) {
      this._logger = Logger.getLogger({
        category: 'hlx',
        level: 'debug',
      });
    } else {
      this._logger = this._logger.getLogger('hlx');
    }
    this._gitMgr = new GitManager()
      .withCwd(this._cwd)
      .withLogger(this._logger);

    if (!this._cfg) {
      this._cfg = await new HelixConfig()
        .withDirectory(this._cwd)
        .withLogger(this._logger).init();
    }

    await this.checkPaths();

    if (!this._srcDir) {
      throw new Error('Invalid config. No "src" directory.');
    }

    this.registerLocalStrains();

    const log = this._logger;
    if (this._displayVersion) {
      log.info('    __ __    ___         ');
      log.info('   / // /__ / (_)_ __    ');
      log.info('  / _  / -_) / /\\ \\ / ');
      log.info(` /_//_/\\__/_/_//_\\_\\ v${this._displayVersion}`);
      log.info('                         ');
    }
    log.debug('Initialized helix-config with: ');
    log.debug(`     srcPath: ${this._srcDir}`);
    log.debug(`    buildDir: ${this._buildDir}`);
    return this;
  }

  /**
   * the strains that have a local git url, need to be registered to server the local directory.
   */
  registerLocalStrains() {
    this._cfg.strains.getRuntimeStrains().forEach((strain) => {
      if (strain.content.isLocal) {
        if (!this._repoPath) {
          this.log.warn(`Local GitURL in strain ${strain.name}.content invalid when running outside of a .git repository.`);
        } else {
          this.registerGitRepository(this._repoPath, strain.content);
        }
      }
      if (strain.static.url.isLocal) {
        if (!this._repoPath) {
          this.log.warn(`Local GitURL in strain ${strain.name}.static invalid when running outside of a .git repository.`);
        } else {
          this.registerGitRepository(this._repoPath, strain.static.url);
        }
      }
    });
  }

  /**
   * Checks if the given {@code strain} has content or static repositories that need local
   * git emulation.
   *
   * @param {Strain} strain the strain.
   */
  async emulateGit(strain) {
    const contentUrl = await this._gitMgr.resolve(strain.content);
    if (contentUrl) {
      // eslint-disable-next-line no-param-reassign
      strain.content = contentUrl;
    }
    const staticUrl = await this._gitMgr.resolve(strain.static.url);
    if (staticUrl) {
      // eslint-disable-next-line no-param-reassign
      strain.static.url = staticUrl;
    }
  }

  async start() {
    this.log.debug('Launching helix simulation server for development...');
    await this._server.init();
    await this._server.start(this);
    return this;
  }

  async stop() {
    this.log.debug('Stopping helix simulation server..');
    await this._server.stop();
    await this._gitMgr.stop();
    return this;
  }
}

module.exports = HelixProject;
