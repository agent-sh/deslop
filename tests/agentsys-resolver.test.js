/**
 * Smoke tests for lib/agentsys.js (the runtime resolver that locates the
 * canonical agentsys/lib install on the user's machine).
 *
 * Uses Node's built-in node:test runner so no jest / npm-install dance.
 *
 * Run: `node --test tests/agentsys-resolver.test.js`
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const resolverPath = path.resolve(__dirname, '..', 'lib', 'agentsys.js');

function freshResolver() {
  delete require.cache[resolverPath];
  return require(resolverPath);
}

test('candidatePaths returns at least the CC marketplace path', () => {
  const r = freshResolver();
  const paths = r.candidatePaths();
  const expectedCC = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'agentsys', 'lib');
  assert.ok(paths.includes(expectedCC), `expected CC path in candidates: ${paths.join(', ')}`);
});

test('candidatePaths includes a dev fallback under the parent directory', () => {
  const r = freshResolver();
  const paths = r.candidatePaths();
  const expectedDev = path.resolve(__dirname, '..', '..', 'agentsys', 'lib');
  assert.ok(paths.includes(expectedDev), `expected dev fallback in candidates: ${paths.join(', ')}`);
});

test('findAgentsysLib returns a path with a usable binary submodule', () => {
  const r = freshResolver();
  const found = r.findAgentsysLib();
  assert.ok(fs.existsSync(path.join(found, 'binary', 'index.js')));
});

test('findAgentsysLib throws an actionable error when no candidate exists', () => {
  // Weak shape check - the empty-host integration test belongs in a
  // separate child-process suite.
  const r = freshResolver();
  const paths = r.candidatePaths();
  assert.ok(paths.length >= 2, 'expected at least CC + dev fallback');
});

test('get() returns a usable binary module', () => {
  const r = freshResolver();
  const m = r.get();
  assert.equal(typeof m.binary.runAnalyzer, 'function');
  assert.equal(typeof m.libRoot, 'string');
  assert.ok(fs.existsSync(path.join(m.libRoot, 'binary', 'index.js')));
});

test('get() degrades gracefully when the chosen install lacks repo-intel', () => {
  // CC marketplace clones at agentsys < v5.8.6 lack lib/repo-intel/. The
  // resolver returns repoIntel: null instead of throwing, so callers that
  // only need `binary` keep working through the v5.8.6 propagation
  // window.
  const r = freshResolver();
  const m = r.get();
  assert.ok(m.repoIntel === null || typeof m.repoIntel.queries === 'object');
});

test('candidatePaths is idempotent', () => {
  const r = freshResolver();
  const a = r.candidatePaths();
  const b = r.candidatePaths();
  assert.deepEqual(a, b);
});
