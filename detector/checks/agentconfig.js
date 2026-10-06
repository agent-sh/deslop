'use strict';
// Agent configuration the change touched (instruction files, skills, agents, commands, plugin
// manifests, hooks, MCP configs), run through agnix when it is installed. agnix knows each
// harness's schema; this check only maps its diagnostics onto the change.
const { spawnSync } = require('child_process');

const AGENT_CONFIG = /(^|\/)(CLAUDE|AGENTS|GEMINI)(\.local)?\.md$|(^|\/)SKILL\.md$|(^|\/)(agents|commands)\/[^/]+\.md$|(^|\/)\.claude-plugin\/[^/]+\.json$|(^|\/)hooks\/[^/]*\.json$|(^|\/)\.claude\/settings(\.local)?\.json$|(^|\/)\.?mcp\.json$|(^|\/)\.cursor\/rules\/[^/]+$|(^|\/)\.github\/copilot-instructions\.md$/;

let available;
function haveAgnix() {
  if (available === undefined) {
    const r = spawnSync('agnix', ['--version'], { encoding: 'utf8' });
    available = !r.error && r.status === 0;
  }
  return available;
}

module.exports = {
  id: 'agentconfig',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const files = ctx.files.filter((f) => f.status !== 'D' && AGENT_CONFIG.test(f.path));
    // agnix reads files from disk, so it can only check a scan of the checked-out tree.
    if (!files.length || (ctx.head && ctx.head !== 'HEAD') || !haveAgnix()) return [];
    const r = spawnSync('agnix', ['--format', 'json', ...files.map((f) => f.path)], { cwd: ctx.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    // agnix exits 1 when it finds errors, so the status says nothing; output that is not its JSON
    // means it did not run, and an empty result then would read as a clean change.
    let out;
    try { out = JSON.parse(r.stdout || ''); } catch {
      throw new Error(`agnix gave no JSON report (${r.error ? r.error.message : `exit ${r.status}`}): ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
    }
    const byPath = new Map(files.map((f) => [f.path, f]));
    const items = [];
    for (const d of out.diagnostics || []) {
      const f = byPath.get(String(d.file || '').replace(/^\.\//, ''));
      if (!f) continue;
      // Only what the change wrote is its own defect: an error elsewhere in a touched file is
      // older and only worth a look. Warnings are mostly prompt style (wording, position in the
      // file, home paths) and were never real in the evaluation set, so only those agnix itself
      // rates HIGH are kept.
      const fresh = f.status === 'A' || f.whole || f.added.some((a) => a.line === d.line);
      const error = d.level === 'error';
      if (!error && !(d.level === 'warning' && d.rule_severity === 'HIGH' && fresh)) continue;
      const lines = ctx.lines(f.path) || [];
      const hint = d.suggestion && d.suggestion.length <= 140 ? ` (${d.suggestion.replace(/\.$/, '')})` : '';
      items.push({
        check: 'agent-config',
        severity: error && fresh ? 'high' : 'review',
        file: f.path,
        line: d.line || 1,
        excerpt: (lines[(d.line || 1) - 1] || '').trim().slice(0, 160),
        message: `agnix ${d.rule}: ${d.message}${hint}${error && !fresh ? ' (on a line this change did not edit)' : ''}`,
        token: d.rule,
      });
    }
    return items;
  },
};
