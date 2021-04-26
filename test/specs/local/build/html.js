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
const { Response } = require('@adobe/helix-fetch')
const { utils } = require('./helper.js');

/* eslint-disable */
module.exports.main = function main(req) {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  if (params.path === '/404.md') {
    return new Response('404 Not Found', {
      status: 404,
    });
  }
  return new Response(
    `<html><head>Test</head><body>${utils.stamp()} path=${params.path}, strain=${req.headers.get('x-strain')}</body></html>`, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      }
    },
  );
};
