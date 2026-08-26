#!/usr/bin/env node
// Copyright © 2026 Insurely AB. All rights reserved.
//
// Exercises the behaviours that only exist in the native HTTP module and that
// unit tests cannot reach because they mock it: redirect-chain header
// collection, per-request cookie-jar isolation, `Set-Cookie` kept as separate
// array entries (never comma-joined), cookie rotation across hops, and a
// non-JSON response body. Driven by `example/src/InstructionProbe.tsx`.
'use strict';

const http = require('http');

const PORT = 8787;

const server = http.createServer((req, res) => {
  // Redirect chain: one intermediate hop (with its own Set-Cookie and a
  // custom header) followed by a final response that itself sets two
  // cookies. Proves finalUrl lands on the last hop, that headers set on the
  // intermediate hop survive into the result, and that multiple Set-Cookie
  // values on one response arrive as separate entries.
  if (req.url === '/redirect') {
    res.writeHead(302, {
      'Location': '/final',
      'Set-Cookie': 'hop=1; Path=/',
      'X-Hop': 'first',
    });
    res.end();
    return;
  }

  if (req.url === '/final') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'],
    });
    res.end(
      JSON.stringify({
        status: 'COMPLETE',
        cookies: req.headers.cookie ?? null,
      })
    );
    return;
  }

  // A non-JSON body. The result's `body` must come back as this raw string,
  // never parsed and never thrown on.
  if (req.url === '/html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not json</html>');
    return;
  }

  // Cookie rotation: the same cookie name ("session") is set to two
  // different values on two different hops of one redirect chain. A client
  // that sources setCookie from its per-request jar (deduplicated by
  // identity) reports only the current value; one that replays raw
  // per-hop Set-Cookie text reports both, including the stale one — which is
  // exactly the bug this probe exists to catch.
  if (req.url === '/rotate') {
    res.writeHead(302, {
      'Location': '/rotate-final',
      'Set-Cookie': 'session=old-value; Path=/',
    });
    res.end();
    return;
  }

  if (req.url === '/rotate-final') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=new-value; Path=/',
    });
    res.end(JSON.stringify({ status: 'COMPLETE' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`instruction test server on http://localhost:${PORT}`);
});
