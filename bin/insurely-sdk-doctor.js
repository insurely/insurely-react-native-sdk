#!/usr/bin/env node
// Copyright © 2026 Insurely AB. All rights reserved.
//
// Bare React Native projects have no config plugin, so this reports exactly
// which native entries are missing and where to add them.

const fs = require('fs');
const path = require('path');

const problems = [];

const plistPaths = globSync('ios', 'Info.plist');
if (plistPaths.length === 0) {
  problems.push('Could not find ios/**/Info.plist — skipping the iOS checks.');
} else {
  for (const plistPath of plistPaths) {
    const contents = fs.readFileSync(plistPath, 'utf8');
    if (
      !contents.includes('LSApplicationQueriesSchemes') ||
      !contents.includes('<string>bankid</string>')
    ) {
      problems.push(
        `${plistPath}: missing the BankID query scheme. Add:\n` +
          '  <key>LSApplicationQueriesSchemes</key>\n  <array>\n    <string>bankid</string>\n  </array>'
      );
    }
    if (!contents.includes('CFBundleURLTypes')) {
      problems.push(
        `${plistPath}: no CFBundleURLTypes. BankID cannot return the user to your app without a URL scheme.`
      );
    }
  }
}

const manifestPath = path.join(
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml'
);
if (!fs.existsSync(manifestPath)) {
  problems.push(
    `Could not find ${manifestPath} — skipping the Android checks.`
  );
} else {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android:scheme="bankid"')) {
    problems.push(
      `${manifestPath}: missing the BankID package query. Add inside <manifest>:\n` +
        '  <queries>\n    <intent>\n      <action android:name="android.intent.action.VIEW" />\n' +
        '      <data android:scheme="bankid" />\n    </intent>\n  </queries>'
    );
  }
}

if (problems.length === 0) {
  console.log('Insurely SDK: native setup looks correct.');
  process.exit(0);
}

console.error('Insurely SDK: found ' + problems.length + ' problem(s):\n');
for (const problem of problems) console.error('- ' + problem + '\n');
process.exit(1);

function globSync(root, filename) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Exclude generated, vendored, and hidden directories
      if (
        entry.name === 'Pods' ||
        entry.name === 'build' ||
        entry.name === 'DerivedData' ||
        entry.name === 'node_modules' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }
      found.push(...globSync(full, filename));
    } else if (entry.name === filename) found.push(full);
  }
  return found;
}
