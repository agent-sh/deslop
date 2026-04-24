'use strict';

/**
 * Adapter around the agent-analyzer slop queries.
 *
 * Two queries feed the deslop pipeline:
 *
 *   - `slop-fixes`   pinpoint structured fixes (Haiku-tier). The
 *                    analyzer has already done the work; the entries
 *                    flow directly into the deslop `fixes` array
 *                    without re-running detection.
 *   - `slop-targets` ranked Sonnet/Opus targets. Used as `targetFiles`
 *                    for the detection pipeline so we only scan
 *                    likely-slop files instead of everything.
 *
 * Both calls degrade gracefully: if the analyzer or repo-intel artifact
 * is unavailable, helpers return `null` and the caller falls back to
 * the unguided pipeline behavior.
 *
 * @module lib/repo-intel-signals
 */

const path = require('path');
const fs = require('fs');

const agentsys = require('./agentsys');

/**
 * Resolve the platform state directory the analyzer wrote
 * `repo-intel.json` into. Mirrors what the agentsys resolver would
 * compute, but does not depend on it being present.
 */
function resolveStateDir(cwd) {
  const candidates = ['.claude', '.opencode', '.codex'];
  for (const c of candidates) {
    if (fs.existsSync(path.join(cwd, c))) {
      return path.join(cwd, c);
    }
  }
  return path.join(cwd, '.claude');
}

function mapFilePath(cwd) {
  return path.join(resolveStateDir(cwd), 'repo-intel.json');
}

function hasRepoIntel(cwd) {
  return fs.existsSync(mapFilePath(cwd));
}

/**
 * Run an agent-analyzer query and parse JSON. Returns null when the
 * analyzer or repo-intel artifact is missing — callers should treat
 * null as "feature unavailable, continue without".
 */
function runQuery(cwd, queryArgs) {
  if (!hasRepoIntel(cwd)) return null;
  let modules;
  try {
    modules = agentsys.get();
  } catch (e) {
    return null;
  }
  const mapFile = mapFilePath(cwd);
  const fullArgs = ['repo-intel', 'query', ...queryArgs, '--map-file', mapFile, cwd];
  try {
    const out = modules.binary.runAnalyzer(fullArgs);
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

/**
 * Pinpoint slop fixes from the analyzer. These are HIGH-certainty,
 * pre-located findings — the deslop agent applies them mechanically
 * (Haiku confirms the shape still matches, applies the edit).
 *
 * @param {string} cwd
 * @returns {{fixes: Array<{action: string, path: string, lines?: number[], category: string, reason: string}>}|null}
 */
function getSlopFixes(cwd) {
  return runQuery(cwd, ['slop-fixes']);
}

/**
 * Ranked Sonnet (file-level) and Opus (cross-file) targets. Used to
 * narrow the detection pipeline's scan set.
 *
 * @param {string} cwd
 * @param {Object} [options]
 * @param {number} [options.top=20] - Max rows per tier
 * @returns {{targets: Array<{kind: string, path?: string, paths?: string[], tier: string, score: number, suspect: string, why: string}>}|null}
 */
function getSlopTargets(cwd, options) {
  const opts = options || {};
  const args = ['slop-targets', '--top', String(opts.top || 20)];
  return runQuery(cwd, args);
}

/**
 * Convert a slop-fix from the analyzer into the deslop fix-action
 * shape. Keeps the wire format used by simple-fixer stable while
 * still surfacing the analyzer's reason and category.
 */
function toDeslopFix(analyzerFix) {
  const baseFix = {
    file: analyzerFix.path,
    pattern: analyzerFix.category,
    reason: analyzerFix.reason,
    certainty: 'HIGH',
    source: 'analyzer-slop-fixes'
  };
  // Reject malformed input — drop the fix instead of producing entries
  // with `undefined` line numbers that downstream simple-fixer would
  // crash on. The agent will simply skip these silently, same as for
  // unknown actions.
  const hasValidRange =
    Array.isArray(analyzerFix.lines) &&
    analyzerFix.lines.length >= 2 &&
    Number.isFinite(analyzerFix.lines[0]) &&
    Number.isFinite(analyzerFix.lines[1]);

  switch (analyzerFix.action) {
    case 'delete-file':
      if (!analyzerFix.path) return null;
      return Object.assign({}, baseFix, { fixType: 'delete-file' });
    case 'delete-lines':
      if (!hasValidRange) return null;
      return Object.assign({}, baseFix, {
        fixType: 'remove-line',
        line: analyzerFix.lines[0],
        endLine: analyzerFix.lines[1]
      });
    case 'replace-lines':
      if (!hasValidRange) return null;
      return Object.assign({}, baseFix, {
        fixType: 'replace',
        line: analyzerFix.lines[0],
        endLine: analyzerFix.lines[1],
        replacement: analyzerFix.with
      });
    default:
      return null;
  }
}

/**
 * Pull file paths out of slop-targets, deduplicated, ordered by
 * descending score. Pipeline uses this as `targetFiles` to focus the
 * scan when repo-intel data is available.
 *
 * @param {{targets: Array}} targetsResult
 * @returns {string[]}
 */
function targetsToFileList(targetsResult) {
  if (!targetsResult || !Array.isArray(targetsResult.targets)) return [];
  const seen = new Set();
  const out = [];
  const sorted = targetsResult.targets
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const t of sorted) {
    if (t.kind === 'file' && t.path) {
      if (!seen.has(t.path)) {
        seen.add(t.path);
        out.push(t.path);
      }
    } else if (t.kind === 'area' && Array.isArray(t.paths)) {
      for (const p of t.paths) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    }
  }
  return out;
}

module.exports = {
  hasRepoIntel,
  mapFilePath,
  getSlopFixes,
  getSlopTargets,
  toDeslopFix,
  targetsToFileList
};
