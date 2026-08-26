#!/usr/bin/env node
// Copyright © 2026 Insurely AB. All rights reserved.
//
// Asserts the published tarball contains only what it should.
//
// `package.json`'s `files` array includes whole directories — `src`, `ios`,
// `android` — so anything that later lands inside one of them ships. A
// captured API response saved while debugging, a keystore, a log file with a
// real personal number in it: all would be published without anyone noticing.
//
// And a publish is effectively permanent. `npm unpublish` only works within
// 72 hours and only while nothing depends on the package; after that the
// tarball stays downloadable forever. There is no force-push.
//
// So this fails the build when the tarball's shape changes unexpectedly.
// Widening ALLOWED_TOP_LEVEL is a deliberate act, which is the point.
//
// Usage:
//   node scripts/check-tarball.js [path/to/package.tgz]
//
// With no argument it packs one itself. CI passes $TARBALL_PATH so the
// artifact that gets inspected is the exact one the install jobs consume,
// rather than a separate dry run that could differ.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ALLOWED_TOP_LEVEL = new Set([
  'package.json',
  'README.md',
  'LICENSE',
  'InsurelyHttp.podspec',
  'app.plugin.js',
  'lib',
  'src',
  'ios',
  'android',
  'plugin',
  'bin',
]);

// Things that must never ship, whatever the allowlist says.
const FORBIDDEN = [
  /\.env(\.|$)/i,
  /\.(keystore|jks|p12|pfx|pem|key)$/i,
  /google-services\.json$/i,
  /GoogleService-Info\.plist$/i,
  /\.log$/i,
  // Tests are excluded by directory in package.json's `files`, which misses
  // any test file not living in a __tests__/ directory -- src/__proof.test.ts
  // shipped for exactly that reason, along with its compiled JS, sourcemap
  // and .d.ts. Match the filename convention too, so the two rules do not
  // share a blind spot.
  /\.test\./,
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)__contract__(\/|$)/,
  /(^|\/)\.npmrc$/i,
  /(^|\/)local\.properties$/i,
];

// Never parse npm's stdout. `npm pack` interleaves the `prepare` lifecycle
// script's output with its own, and --ignore-scripts does not reliably
// suppress it across npm versions -- this exact assumption is what broke
// both the workflow's Pack step and the first version of this script. Pack
// into a directory and read the filename off the filesystem instead.
function packToTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insurely-pack-'));
  execFileSync('npm', ['pack', '--pack-destination', dir], {
    stdio: 'ignore',
  });
  const tgz = fs.readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (!tgz) {
    throw new Error(`npm pack produced no tarball in ${dir}`);
  }
  return path.join(dir, tgz);
}

const tarballPath = process.argv[2] || packToTempDir();

if (!fs.existsSync(tarballPath)) {
  console.error(`No tarball at ${tarballPath}`);
  process.exit(1);
}

// `tar -tzf` lists paths one per line, all under the leading `package/`
// directory npm wraps around the contents.
const files = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.replace(/^package\//, ''))
  .filter((line) => line !== '' && !line.endsWith('/'));

const problems = [];

for (const file of files) {
  const top = file.split('/')[0];
  if (!ALLOWED_TOP_LEVEL.has(top)) {
    problems.push(`unexpected top-level entry "${top}" (via ${file})`);
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(file)) {
      problems.push(`forbidden file in tarball: ${file}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Tarball ${tarballPath} contains files it should not:\n`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  console.error(
    '\nTo stop a file shipping, add a negation to `files` in package.json.' +
      '\nIf it SHOULD ship, widen ALLOWED_TOP_LEVEL or FORBIDDEN in this' +
      '\nscript and say why in the commit message. A publish cannot be undone.'
  );
  process.exit(1);
}

console.log(
  `Tarball OK: ${files.length} files, top-level entries all expected.`
);
