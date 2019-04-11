/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

const path = require('path');
const _ = require('lodash');
const gitServer = require('@adobe/git-server/lib/server.js');
const { GitUrl } = require('@adobe/helix-shared');

const GIT_LOCAL_HOST = '127.0.0.1';

const GIT_LOCAL_OWNER = 'helix';

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

/**
 * Returns the key that identifies a local git server. it includes the host, owner and repository
 * (but not the ref).
 *
 * @param {GitUrl} giturl
 * @reurn {string} the key
 */
function getServerKey(giturl) {
  return `${giturl.host}--${giturl.owner}--${giturl.repo}`;
}

class GitMapping {
  /**
   * Creates a new git mapping.
   * @param {string} repoPath local directory
   * @param {GitUrl} gitUrl the mapped git url
   * @param {string} key the url this server will emulate
   */
  constructor(repoPath, gitUrl, key) {
    this._key = key;
    this._gitUrl = gitUrl;
    this._repoPath = repoPath;
    this._localUrl = null;
  }

  get key() {
    return this._key;
  }

  get gitUrl() {
    return this._gitUrl;
  }

  get repoPath() {
    return this._repoPath;
  }

  get localUrl() {
    return this._localUrl;
  }
}

class GitManager {
  constructor() {
    this._cwd = process.cwd();
    this._logger = null;
    this._serversByUrl = new Map();
    this._serversByPath = new Map();
    this._gitState = null;
    this._gitConfig = _.cloneDeep(GIT_SERVER_CONFIG);
  }

  withCwd(cwd) {
    this._cwd = cwd;
    return this;
  }

  withLogger(logger) {
    this._logger = logger;
    return this;
  }

  get log() {
    return this._logger;
  }

  get state() {
    return this._gitState;
  }

  /**
   * Registers a server at the local {@code dir} repository for the given {@code giturl}.
   * @param {string} repoPath local directory
   * @param {GitUrl} giturl the url this server will emulate
   */
  registerServer(repoPath, giturl) {
    if (!repoPath) {
      throw new Error(`${repoPath} is no valid git repository.`);
    }
    const localPath = path.resolve(this._cwd, repoPath);
    const key = getServerKey(giturl);

    let srv = this._serversByPath.get(localPath);
    if (!srv) {
      srv = new GitMapping(repoPath, giturl, key);
      this._serversByPath.set(localPath, srv);
      this._serversByUrl.set(key, srv);
    }

    if (srv.key !== key) {
      throw new Error(`Server for ${key} already registered for ${srv.repoPath}`);
    }
  }

  /**
   * Resolves the given giturl to a locally linked server. If no link is defined for this url,
   * it will return {@code null}. It automatically starts a server if needed.
   *
   * @param {GitUrl} giturl The url to resolve
   * @returns {GitUrl} the resolved url or {@code null}.
   */
  async resolve(giturl) {
    const key = getServerKey(giturl);
    const srv = this._serversByUrl.get(key);
    if (!srv) {
      return null;
    }
    await this.start();
    if (srv.localUrl.path !== giturl.path) {
      const copy = srv.localUrl.toJSON();
      copy.path = giturl.path;
      return new GitUrl(copy);
    }
    return srv.localUrl;
  }

  async start() {
    if (this._gitState) {
      return;
    }

    const mappings = Array.from(this._serversByPath.values());
    mappings.forEach((mapping) => {
      this._gitConfig.virtualRepos[GIT_LOCAL_OWNER][mapping.key] = {
        path: mapping.repoPath,
      };
    });
    this.log.debug('Launching local git server...');
    this._gitConfig.logger = this.log.getLogger('git');
    this._gitState = await gitServer.start(this._gitConfig);

    await Promise.all(mappings.map(async (mapping) => {
      const { currentBranch } = await gitServer.getRepoInfo(
        this._gitConfig, GIT_LOCAL_OWNER, mapping.key,
      );

      // #65 consider currently checked out branch
      // eslint-disable-next-line no-param-reassign,no-underscore-dangle
      mapping._localUrl = new GitUrl({
        protocol: 'http',
        hostname: GIT_LOCAL_HOST,
        port: this._gitState.httpPort,
        owner: GIT_LOCAL_OWNER,
        repo: mapping.key,
        ref: currentBranch,
      });
      this.log.debug(`git emulating ${mapping.gitUrl} via ${mapping.localUrl} from './${path.relative(this._cwd, mapping.repoPath)}'`);
    }));
  }

  async stop() {
    if (!this._gitState) {
      return;
    }
    this.log.debug('Stopping local git server...');
    await gitServer.stop();
    this._gitState = null;
  }
}

module.exports = GitManager;
