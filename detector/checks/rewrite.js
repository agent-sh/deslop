'use strict';
// Rules a rewrite of a doc or prompt dropped. Current models shorten instruction files well
// but lose an exception, a reason or a whole rule on the way; this lists removed sentences
// that state a rule and whose key words no longer appear anywhere in the new file.
const NORMATIVE = /\b(must|never|always|only|do not|don't|required?|requires|forbidden|without|unless|except|before|after|every|no\s+\w+\s+(?:may|can))\b/i;
const REASON = /\b(because|so that|otherwise|since|or else|which means|to avoid|to keep|to prevent)\b/i;
const STOP = new Set('a an the and or but if then else when while for to of in on at by with from into onto over under this that these those it its is are was were be been being has have had do does did not no nor so than too very can could should would may might will shall must never always only each every any all some such own same other more most less least just also again further once here there where why how what which who whom whose your you we our they them their he she his her i me my use used using make sure'.split(' '));

function words(s) {
  return (s.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []).filter((w) => !STOP.has(w));
}

module.exports = {
  id: 'rewrite',
  scopes: ['diff'],
  run(ctx) {
    const items = [];
    for (const f of ctx.files) {
      if (f.kind !== 'prompt' && f.kind !== 'docs') continue;
      if (f.status === 'D' || f.removed.length < 8) continue; // only real rewrites
      const head = ctx.headReader.read(f.path);
      if (head === null) continue;
      const vocab = new Set(words(head));
      const addedLine = f.added.length ? f.added[0].line : 1;
      for (const r of f.removed) {
        const t = r.text.replace(/^[\s>*#|-]+|\d+\.\s/g, '').trim();
        if (t.length < 30 || !(NORMATIVE.test(t) || REASON.test(t))) continue;
        const ws = [...new Set(words(t))];
        if (ws.length < 4) continue;
        const kept = ws.filter((w) => vocab.has(w)).length / ws.length;
        if (kept >= 0.5) continue;
        items.push({
          check: 'dropped-rule',
          severity: 'review',
          file: f.path,
          line: addedLine,
          excerpt: `- ${t.slice(0, 150)}`,
          message: `removed ${REASON.test(t) && !NORMATIVE.test(t) ? 'reason' : 'rule'} (old line ${r.line}) whose key words appear nowhere in the new file; confirm dropping it was intended`,
        });
      }
    }
    // A long rewrite can drop many sentences; past a handful the list stops being read.
    return items.slice(0, 8);
  },
};
