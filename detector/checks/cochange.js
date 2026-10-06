'use strict';
// Files that history says change together, where this change edited one and not the other.
// Two sources: pairs the repo declares in .deslop.json ("together"), and pairs mined from
// recent commits (a file that changed in nearly every commit that touched its partner).
const { git } = require('../git');
const { SKIP_KINDS } = require('../files');

const HISTORY = 400;
const MIN_SUPPORT = 6;
const MIN_CONFIDENCE = 0.85;
// Version manifests change in every release commit along with whatever shipped; they say
// nothing about which files belong together.
const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|setup\.py|setup\.cfg|go\.mod|plugin\.json|marketplace\.json|version\.[a-z]+|VERSION)$/;

function globToRe(g) {
  const esc = g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

module.exports = {
  id: 'cochange',
  scopes: ['diff'],
  run(ctx) {
    const items = [];
    const changed = new Set(ctx.files.map((f) => f.path));
    // A deleted file has no companions left to keep in step.
    const edited = ctx.files.filter((f) => f.status !== 'D' && !SKIP_KINDS.has(f.kind) && f.kind !== 'changelog' && (f.added.length || f.removed.length));
    // Declared pairs.
    for (const rule of ctx.opts.together || []) {
      const when = (Array.isArray(rule.when) ? rule.when : [rule.when]).map(globToRe);
      const also = (Array.isArray(rule.also) ? rule.also : [rule.also]).map(globToRe);
      const trigger = edited.find((f) => when.some((re) => re.test(f.path)));
      if (!trigger || [...changed].some((p) => also.some((re) => re.test(p)))) continue;
      items.push({ check: 'missing-companion', severity: 'high', file: trigger.path, line: 0, excerpt: '', token: [].concat(rule.also).join(','), message: rule.message || `changes here go with ${[].concat(rule.also).join(', ')}, which this change does not touch` });
    }
    if (ctx.opts.mineCochange === false || !ctx.base) return items;
    // Mined pairs from the commits before this change.
    const log = git(ctx.root, ['-c', 'core.quotepath=off', 'log', '--no-merges', '--format=%x00', '--name-only', `-${HISTORY}`, ctx.base], { allowFail: true });
    const commits = log.split('\0').map((c) => c.split('\n').filter(Boolean)).filter((c) => c.length);
    const count = new Map();
    const pair = new Map();
    const focus = new Set(edited.map((f) => f.path));
    for (const c of commits) {
      // Support counts every commit that touched the file, alone or not; only pairs skip
      // sweeping commits, which pair everything with everything.
      for (const a of c) count.set(a, (count.get(a) || 0) + 1);
      if (c.length > 12) continue;
      for (const a of c) {
        if (!focus.has(a)) continue;
        for (const b of c) if (a !== b) pair.set(`${a}\0${b}`, (pair.get(`${a}\0${b}`) || 0) + 1);
      }
    }
    for (const [k, n] of pair) {
      const [a, b] = k.split('\0');
      if (MANIFEST.test(a) || MANIFEST.test(b)) continue;
      const support = count.get(a) || 0;
      if (support < MIN_SUPPORT || n / support < MIN_CONFIDENCE) continue;
      if (changed.has(b) || !ctx.headFiles.has(b) || SKIP_KINDS.has(ctx.kindOf(b)) || ctx.kindOf(b) === 'changelog') continue;
      items.push({ check: 'missing-companion', severity: 'review', file: b, line: 0, excerpt: '', token: a, message: `changed in ${n} of the last ${support} commits that touched ${a}, but not in this one; check it still matches` });
    }
    return items;
  },
};
