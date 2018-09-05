// modules are defined as an array
// [ module function, map of requires ]
//
// map of requires is short require name -> numeric require
//
// anything defined in a previous bundle is accessed via the
// orig method which is the require for previous bundles

// eslint-disable-next-line no-global-assign
parcelRequire = (function (modules, cache, entry, globalName) {
  // Save the require from previous bundle to this closure if any
  var previousRequire = typeof parcelRequire === 'function' && parcelRequire;
  var nodeRequire = typeof require === 'function' && require;

  function newRequire(name, jumped) {
    if (!cache[name]) {
      if (!modules[name]) {
        // if we cannot find the module within our internal map or
        // cache jump to the current global require ie. the last bundle
        // that was added to the page.
        var currentRequire = typeof parcelRequire === 'function' && parcelRequire;
        if (!jumped && currentRequire) {
          return currentRequire(name, true);
        }

        // If there are other bundles on this page the require from the
        // previous one is saved to 'previousRequire'. Repeat this as
        // many times as there are bundles until the module is found or
        // we exhaust the require chain.
        if (previousRequire) {
          return previousRequire(name, true);
        }

        // Try the node require function if it exists.
        if (nodeRequire && typeof name === 'string') {
          return nodeRequire(name);
        }

        var err = new Error('Cannot find module \'' + name + '\'');
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      localRequire.resolve = resolve;

      var module = cache[name] = new newRequire.Module(name);

      modules[name][0].call(module.exports, localRequire, module, module.exports, this);
    }

    return cache[name].exports;

    function localRequire(x){
      return newRequire(localRequire.resolve(x));
    }

    function resolve(x){
      return modules[name][1][x] || x;
    }
  }

  function Module(moduleName) {
    this.id = moduleName;
    this.bundle = newRequire;
    this.exports = {};
  }

  newRequire.isParcelRequire = true;
  newRequire.Module = Module;
  newRequire.modules = modules;
  newRequire.cache = cache;
  newRequire.parent = previousRequire;
  newRequire.register = function (id, exports) {
    modules[id] = [function (require, module) {
      module.exports = exports;
    }, {}];
  };

  for (var i = 0; i < entry.length; i++) {
    newRequire(entry[i]);
  }

  if (entry.length) {
    // Expose entry point to Node, AMD or browser globals
    // Based on https://github.com/ForbesLindesay/umd/blob/master/template.js
    var mainExports = newRequire(entry[entry.length - 1]);

    // CommonJS
    if (typeof exports === "object" && typeof module !== "undefined") {
      module.exports = mainExports;

    // RequireJS
    } else if (typeof define === "function" && define.amd) {
     define(function () {
       return mainExports;
     });

    // <script>
    } else if (globalName) {
      this[globalName] = mainExports;
    }
  }

  // Override the current require with this new one
  return newRequire;
})({"dump_html.pre.js":[function(require,module,exports) {
/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

module.exports.pre = (payload, action) => {
  action.request.headers.host = 'localhost:3000';
  payload.dump = JSON.stringify(action.request, null, "  ");
};
},{}],"dump_html.htl":[function(require,module,exports) {
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

/* eslint-disable */

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

/* eslint-disable */

const Runtime = require('@adobe/htlengine/src/runtime/Runtime');

function run(runtime) {
  const lengthOf = function (c) {
    return Array.isArray(c) ? c.length : Object.keys(c).length;
  };

  const out = runtime.out.bind(runtime);
  const exec = runtime.exec.bind(runtime);
  const xss = runtime.xss.bind(runtime);
  const listInfo = runtime.listInfo.bind(runtime);
  const use = runtime.use.bind(runtime);
  const slyResource = runtime.resource.bind(runtime);
  const call = runtime.call.bind(runtime);
  const template = runtime.template.bind(runtime);

  return runtime.run(function* () {
    const it = runtime.globals;
    out("<pre>");
    const var_0 = it["dump"];
    out(var_0);
    out("</pre>\n");
  });
}

module.exports.main = function main(resource) {
  const runtime = new Runtime();
  runtime.setGlobal(resource);
  return run(runtime).then(() => ({ body: runtime.stream }));
};

function wrap(main) {
  const { pipe } = require('@adobe/hypermedia-pipeline/src/defaults/html.pipe.js');
  const { pre } = require('./dump_html.pre.js');
  const owwrapper = require('@adobe/openwhisk-loggly-wrapper');

  const _isFunction = fn => !!(fn && fn.constructor && fn.call && fn.apply);

  // this gets called by openwhisk
  return function wrapped(params, secrets = {}, logger) {
    const runthis = (p, s, l) => {
      const next = (p, s, l) => {
        function cont(next) {
          const action = {
            secrets: s,
            logger: l,
            request: {
              // this is currently in the wrong place.
              params: p.request.params,
              headers: p.request.headers
            }
          };
          const ret = pre(p, action);
          if (ret && _isFunction(ret.then)) {
            return ret.then(pp => next(pp || p, s, l));
          }
          return next(ret || p, s, l);
        }
        return cont(main).then(resobj => ({ response: resobj }));
      };
      return pipe(next, p, s, l);
    };
    return owwrapper(runthis, params, secrets, logger);
  };
}

module.exports.main = wrap(module.exports.main);
},{"./dump_html.pre.js":"dump_html.pre.js"}]},{},["dump_html.htl"], null)
//# sourceMappingURL=/dump_html.map
