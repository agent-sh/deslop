'use strict';
// Credentials in added lines. Only formats with a fixed prefix: entropy guesses flag every hash.
const { SKIP_KINDS } = require('../files');

const RULES = [
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['aws-presigned-url', /X-Amz-(Signature|Credential)=[A-Za-z0-9%/_-]{16,}/],
  ['private-key', /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{30,}/],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9_-]{40,}/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe-key', /\b(sk|rk)_live_[0-9A-Za-z]{20,}/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['hf-token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@[\w.-]+/],
];

module.exports = {
  id: 'secrets',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      for (const a of f.added) {
        for (const [name, re] of RULES) {
          const m = re.exec(a.text);
          if (!m) continue;
          if (name === 'url-credentials' && /:\/\/[^:]+:(\$\{?|<|\*{3}|x{3}|password|pass|secret|token)/i.test(a.text)) continue;
          // Tests carry fake keys on purpose; still worth a look, not a certainty.
          items.push({ check: 'secret', severity: f.kind === 'test' ? 'review' : 'high', file: f.path, line: a.line, excerpt: a.text.trim().replace(m[0], m[0].slice(0, 8) + '...').slice(0, 100), message: `looks like a committed ${name}; rotate it if real` });
          break;
        }
      }
    }
    return items;
  },
};
