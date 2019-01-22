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
const path = require('path');
const _ = require('lodash');
const gitServer = require('@adobe/git-server/lib/server.js');
const { GitUrl, Logger, HelixConfig } = require('@adobe/helix-shared');
const HelixServer = require('./HelixServer.js');
const packageJson = require('../package.json');

const INDEX_MD = 'index.md';

const README_MD = 'README.md';

const SRC_DIR = 'src';

const DEFAULT_BUILD_DIR = '.hlx/build';

const DEFAULT_WEB_ROOT = './';

const GIT_DIR = '.git';

const GIT_LOCAL_HOST = '127.0.0.1';

const GIT_LOCAL_OWNER = 'helix';

const GIT_LOCAL_CONTENT_REPO = 'content';

const GIT_SERVER_CONFIG = {
  configPath: '<internal>',
  repoRoot: '.',
  listen: {
    http: {
      port: 0,
      host: '0.0.0.0',
    },
  },

  subdomainMapping: {
    // if enabled, <subdomain>.<baseDomain>/foo/bar/baz will be
    // resolved/mapped to 127.0.0.1/<subdomain>/foo/bar/baz
    enable: true,
    baseDomains: [
      // some wildcarded DNS domains resolving to 127.0.0.1
      'localtest.me',
      'lvh.me',
      'vcap.me',
      'lacolhost.com',
    ],
  },

  // repository mapping. allows to 'mount' repositories outside the 'repoRoot' structure.
  virtualRepos: {
    [GIT_LOCAL_OWNER]: {
    },
  },

  logs: {
    level: 'info',
    logsDir: './logs',
    reqLogFormat: 'short', // used for morgan (request logging)
  },
};

async function isFile(filePath) {
  return fs.stat(filePath).then(stats => stats.isFile()).catch(() => false);
}

async function isDirectory(dirPath) {
  return fs.stat(dirPath).then(stats => stats.isDirectory()).catch(() => false);
}

class HelixProject {
  constructor() {
    this._cwd = process.cwd();
    this._srcDir = '';
    this._indexMd = '';
    this._repoPath = '';
    this._cfg = null;
    this._gitConfig = _.cloneDeep(GIT_SERVER_CONFIG);
    this._gitState = null;
    this._needLocalServer = false;
    this._buildDir = DEFAULT_BUILD_DIR;
    this._runtimePaths = module.paths;
    this._webRootDir = DEFAULT_WEB_ROOT;
    this._server = new HelixServer(this);
    this._displayVersion = packageJson.version;
    this._logger = null;
    this._strainName = 'default';
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

  withStrainName(name) {
    this._strainName = name;
    return this;
  }

  withWebRootDir(dir) {
    this._webRootDir = dir;
    return this;
  }

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

  get config() {
    return this._cfg;
  }

  get gitConfig() {
    return this._gitConfig;
  }

  get buildDir() {
    return this._buildDir;
  }

  get webRootDir() {
    return this._webRootDir;
  }

  get runtimeModulePaths() {
    return this._runtimePaths;
  }

  /**
   * Location of the content repo.
   * @returns {null|GitUrl}
   */
  get contentRepo() {
    return this.strain.content;
  }

  get strain() {
    return this.config.strains.get(this._strainName);
  }

  get started() {
    return this._server.isStarted();
  }

  /**
   * Returns the helix server
   * @returns {HelixServer}
   */
  get server() {
    return this._server;
  }

  get directoryIndex() {
    return this.strain.directoryIndex;
  }

  /*
   * Returns the git state
   * @returns {Object}
   */
  get gitState() {
    return this._gitState;
  }

  async checkPaths() {
    const readmePath = path.join(this._cwd, README_MD);
    if (await isFile(readmePath)) {
      this._indexMd = readmePath;
    }

    const idxPath = path.resolve(this._cwd, INDEX_MD);
    if (await isFile(idxPath)) {
      this._indexMd = idxPath;
    }

    const srcPath = path.join(this._cwd, SRC_DIR);
    if (await isDirectory(srcPath)) {
      this._srcDir = srcPath;
    }

    this._buildDir = path.resolve(this._cwd, this._buildDir);
    this._webRootDir = path.resolve(this._cwd, this._webRootDir);

    const dotGitPath = path.join(this._cwd, GIT_DIR);
    if (await isDirectory(dotGitPath)) {
      this._repoPath = path.resolve(dotGitPath, '../');
    }
  }

  async init() {
    if (!this._logger) {
      this._logger = Logger.getLogger('hlx');
    } else {
      this._logger = this._logger.getLogger('hlx');
    }

    if (!this._cfg) {
      this._cfg = await new HelixConfig()
        .withDirectory(this._cwd)
        .withLogger(this._logger).init();
    }

    await this.checkPaths();

    if (!this._srcDir) {
      throw new Error('Invalid config. No "src" directory.');
    }

    // if strains has default content repo we need to start git server
    if (this.contentRepo.isLocal) {
      if (this._indexMd) {
        if (!this._repoPath) {
          throw new Error('Local README.md or index.md must be inside a valid git repository.');
        }
        this._gitConfig.virtualRepos[GIT_LOCAL_OWNER][GIT_LOCAL_CONTENT_REPO] = {
          path: this._repoPath,
        };
        this._needLocalServer = true;
      } else {
        throw new Error('Invalid config. No "content" location specified and no "README.md" or "index.md" found.');
      }
    }

    const log = this._logger;
    log.info('    __ __    ___         ');
    log.info('   / // /__ / (_)_ __    ');
    log.info('  / _  / -_) / /\\ \\ / ');
    log.info(` /_//_/\\__/_/_//_\\_\\ v${this._displayVersion}`);
    log.info('                         ');
    log.debug('Initialized helix-config with: ');
    log.debug(`      strain: ${this.strain.name}`);
    log.debug(` contentRepo: ${this.contentRepo}`);
    log.debug(`     srcPath: ${this._srcDir}`);
    log.debug(`    buildDir: ${this._buildDir}`);
    return this;
  }

  async startGitServer() {
    this._logger.debug('Launching local git server for development...');
    this._gitConfig.logger = this._logger.getLogger('git');
    this._gitState = await gitServer.start(this._gitConfig);
  }

  async stopGitServer() {
    this._logger.debug('Stopping local git server..');
    await gitServer.stop();
    this._gitState = null;
  }

  async start() {
    if (this._needLocalServer) {
      await this.startGitServer();
      // #65 consider currently checked out branch
      const { currentBranch } = await gitServer.getRepoInfo(
        this._gitConfig, GIT_LOCAL_OWNER, GIT_LOCAL_CONTENT_REPO,
      );
      this.strain.content = new GitUrl({
        protocol: 'http',
        hostname: GIT_LOCAL_HOST,
        port: this._gitState.httpPort,
        owner: GIT_LOCAL_OWNER,
        repo: GIT_LOCAL_CONTENT_REPO,
        ref: currentBranch,
      });
    }

    this._logger.debug('Launching petridish server for development...');
    await this._server.init();
    await this._server.start(this);
    return this;
  }

  async stop() {
    this._logger.debug('Stopping petridish server..');
    await this._server.stop();

    if (this._needLocalServer) {
      await this.stopGitServer();
    }
    return this;
  }
}

module.exports = HelixProject;
