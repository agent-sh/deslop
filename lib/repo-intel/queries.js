'use strict';

/**
 * Typed wrappers over `agent-analyzer repo-intel query <type>` subcommands.
 *
 * Each function constructs the exact argv expected by the binary, delegates to
 * `binary.runAnalyzer`, parses the JSON output, and returns the result.
 *
 * All functions throw `RepoIntelMissingError` when the repo-intel map file
 * has not been generated yet (run `agentsys repo-intel update` first).
 *
 * @module lib/repo-intel/queries
 */

const fs = require('fs');
const path = require('path');
const { getStateDir } = require('../platform/state-dir');
const binary = require('../binary');

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the repo-intel map file is absent.
 */
class RepoIntelMissingError extends Error {
  /**
   * @param {string} mapFile - Expected path to the map file
   */
  constructor(mapFile) {
    super(
      `repo-intel map not found at ${mapFile}. ` +
      'Run `agentsys repo-intel update` to generate it first.'
    );
    this.name = 'RepoIntelMissingError';
    this.code = 'REPO_INTEL_MISSING';
    this.mapFile = mapFile;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MAP_FILE_NAME = 'repo-intel.json';

/**
 * Resolve the map file path for a given project root.
 * @param {string} cwd
 * @returns {string}
 */
function resolveMapFile(cwd) {
  const stateDir = getStateDir(cwd);
  return path.join(cwd, stateDir, MAP_FILE_NAME);
}

/**
 * Assert the map file exists, throwing `RepoIntelMissingError` if not.
 * @param {string} cwd
 * @returns {string} resolved map file path
 */
function requireMapFile(cwd) {
  const mapFile = resolveMapFile(cwd);
  if (!fs.existsSync(mapFile)) {
    throw new RepoIntelMissingError(mapFile);
  }
  return mapFile;
}

/**
 * Run a repo-intel query and parse JSON output.
 * @param {string} queryName - The subcommand name (e.g. 'hotspots')
 * @param {string[]} extraArgs - Additional argv elements
 * @param {string} cwd - Project root
 * @returns {*} Parsed JSON result
 */
function runQuery(queryName, extraArgs, cwd) {
  const mapFile = requireMapFile(cwd);
  const args = ['repo-intel', 'query', queryName, ...extraArgs, '--map-file', mapFile, cwd];
  let raw;
  try {
    raw = binary.runAnalyzer(args);
  } catch (err) {
    throw new Error(
      `repo-intel query failed [${queryName}]: ${err.message}`,
      { cause: err }
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_parseErr) {
    const preview = raw.slice(0, 200);
    throw new Error(
      `repo-intel query [${queryName}] returned non-JSON output: ${preview}`
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Hotspot files by change frequency.
 * @param {string} cwd
 * @param {{ limit?: number }} [opts]
 * @returns {Array}
 */
function hotspots(cwd, opts = {}) {
  const extra = [];
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  return runQuery('hotspots', extra, cwd);
}

/**
 * Co-change coupling for a file.
 * @param {string} cwd
 * @param {string} file
 * @param {{ limit?: number }} [opts]
 * @returns {Array}
 */
function coupling(cwd, file, opts = {}) {
  const extra = [file];
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  return runQuery('coupling', extra, cwd);
}

/**
 * Bus factor report.
 * @param {string} cwd
 * @param {{ adjustForAi?: boolean, limit?: number }} [opts]
 * @returns {Object}
 */
function busFactor(cwd, opts = {}) {
  const extra = [];
  if (opts.adjustForAi) extra.push('--adjust-for-ai');
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  return runQuery('bus-factor', extra, cwd);
}

/**
 * Files with low test coverage relative to change frequency.
 * @param {string} cwd
 * @param {{ limit?: number, minChanges?: number }} [opts]
 * @returns {Array}
 */
function testGaps(cwd, opts = {}) {
  const extra = [];
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  if (opts.minChanges != null) extra.push('--min-changes', String(opts.minChanges));
  return runQuery('test-gaps', extra, cwd);
}

/**
 * AI-authored ratio per file or project.
 * @param {string} cwd
 * @param {{ pathFilter?: string }} [opts]
 * @returns {Object}
 */
function aiRatio(cwd, opts = {}) {
  const extra = [];
  if (opts.pathFilter != null) extra.push('--path-filter', opts.pathFilter);
  return runQuery('ai-ratio', extra, cwd);
}

/**
 * Risk score for a diff (set of changed files).
 * @param {string} cwd
 * @param {string[]} files
 * @returns {Array}
 */
function diffRisk(cwd, files) {
  if (!Array.isArray(files)) {
    throw new TypeError('diffRisk: files must be an array of strings');
  }
  if (!files.every(f => typeof f === 'string')) {
    throw new TypeError('diffRisk: all entries in files must be strings');
  }
  const joined = files.join(',');
  if (joined.length > 30000) {
    throw new RangeError(
      `diffRisk: files argument exceeds 30000 character limit (got ${joined.length})`
    );
  }
  const extra = ['--files', joined];
  return runQuery('diff-risk', extra, cwd);
}

/**
 * Call-graph dependents of a symbol.
 * @param {string} cwd
 * @param {string} symbol
 * @param {string} [file] - Scope to a specific file
 * @returns {Object}
 */
function dependents(cwd, symbol, file) {
  const extra = [symbol];
  if (file != null) extra.push('--file', file);
  return runQuery('dependents', extra, cwd);
}

/**
 * Bugspot risk scores.
 * @param {string} cwd
 * @param {{ limit?: number }} [opts]
 * @returns {Array}
 */
function bugspots(cwd, opts = {}) {
  const extra = [];
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  return runQuery('bugspots', extra, cwd);
}

/**
 * Project health summary.
 * @param {string} cwd
 * @returns {Object}
 */
function health(cwd) {
  return runQuery('health', [], cwd);
}

// ---------------------------------------------------------------------------
// Graph queries (Phase 5.1 - agent-analyzer v0.4.0+)
// ---------------------------------------------------------------------------

/**
 * Louvain-discovered file communities.
 * @param {string} cwd
 * @returns {Array}
 */
function communities(cwd) {
  return runQuery('communities', [], cwd);
}

/**
 * Files bridging multiple communities (architectural seams).
 * @param {string} cwd
 * @param {{ limit?: number }} [opts]
 * @returns {Array}
 */
function boundaries(cwd, opts = {}) {
  const extra = [];
  if (opts.limit != null) extra.push('--top', String(opts.limit));
  return runQuery('boundaries', extra, cwd);
}

/**
 * Which community a file belongs to.
 * @param {string} cwd
 * @param {string} file
 * @returns {Object}
 */
function areaOf(cwd, file) {
  return runQuery('area-of', [file], cwd);
}

/**
 * Composite health roll-up for a community.
 * @param {string} cwd
 * @param {number} id - Community id (non-negative integer)
 * @returns {Object}
 */
function communityHealth(cwd, id) {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
    throw new TypeError(
      'communityHealth: id must be a non-negative integer'
    );
  }
  return runQuery('community-health', [String(id)], cwd);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Error class
  RepoIntelMissingError,

  // Core queries
  hotspots,
  coupling,
  busFactor,
  testGaps,
  aiRatio,
  diffRisk,
  dependents,
  bugspots,
  health,

  // Graph queries
  communities,
  boundaries,
  areaOf,
  communityHealth,
};
