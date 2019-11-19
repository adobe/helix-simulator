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
const TemplateResolver = require('./TemplateResolver.js');

const SRC_DIR = 'src';

const DEFAULT_BUILD_DIR = '.hlx/build';

const GIT_DIR = '.git';

async function isDirectory(dirPath) {
  return fs.stat(dirPath).then((stats) => stats.isDirectory()).catch(() => false);
}

class HelixProject {
  constructor() {
    this._cwd = process.cwd();
    this._srcDirs = [];
    this._repoPath = '';
    this._cfg = null;
    this._buildDir = DEFAULT_BUILD_DIR;
    this._runtimePaths = module.paths;
    this._params = {};
    this._server = new HelixServer(this);
    this._logger = null;
    this._requestOverride = null;
    this._gitMgr = null;
    this._templateResolver = null;
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
    if (Array.isArray(value)) {
      this._srcDirs.push(...value);
    } else {
      this._srcDirs.push(value);
    }
    return this;
  }

  withActionParams(value) {
    this._params = value;
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

  get actionParams() {
    return this._params;
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

  get templateResolver() {
    return this._templateResolver;
  }

  /**
   * Returns the helix server
   * @returns {HelixServer}
   */
  get server() {
    return this._server;
  }

  async checkPaths() {
    if (this._srcDirs.length === 0) {
      const srcPath = path.resolve(this._cwd, SRC_DIR);
      if (await isDirectory(srcPath)) {
        this._srcDirs.push(srcPath);
      }
    }
    this._srcDirs = this._srcDirs.map((s) => (path.resolve(this._cwd, s)));
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
  async invalidateCache() {
    // we simple remove all entries from the node cache that fall below the build or src directory
    Object.keys(require.cache).forEach((file) => {
      if (this.isModulePath(file)) {
        delete require.cache[file];
        this.log.debug(`evicted ${path.relative(this._cwd, file)}`);
      }
    });
    await this._templateResolver.init();
  }

  /**
   * Checks whether the given file path is a potential module path. i.e. if it is in the
   * build, source or cgi-bin location.
   *
   * @param {string} filepath The path to check
   * @return {boolean} {@code true} if the filepath is a module path.
   */
  isModulePath(filepath) {
    if (!this._checkPaths) {
      this._checkPaths = [this._buildDir, ...this._srcDirs];
      this._checkPathsP = this._checkPaths.map((p) => (`${p}${path.sep}`));
    }
    return (this._checkPaths.indexOf(filepath) >= 0)
      || (this._checkPathsP.findIndex((p) => (filepath.startsWith(p))) >= 0);
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

    if (this._srcDirs.length === 0) {
      throw new Error('Invalid config. No "src" directory.');
    }

    this.registerLocalStrains();

    // init template resolver
    this._templateResolver = new TemplateResolver().withDirectory(this._buildDir);

    const log = this._logger;
    if (this._displayVersion) {
      log.info('    __ __    ___         ');
      log.info('   / // /__ / (_)_ __    ');
      log.info('  / _  / -_) / /\\ \\ / ');
      log.info(` /_//_/\\__/_/_//_\\_\\ v${this._displayVersion}`);
      log.info('                         ');
    }
    log.debug('Initialized helix-project with: ');
    log.debug(`    srcPaths: ${this._srcDirs.map((d) => (path.relative(this._cwd, d)))}`);
    log.debug(`    buildDir: ${path.relative(this._cwd, this._buildDir)}`);
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
    await this._templateResolver.init();
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
