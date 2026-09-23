---
description: This skill should be used when the user asks to "clean up slop", "remove AI artifacts", "deslop the codebase", "find debug statements", "remove console.logs", "repo hygiene", or mentions "AI slop", "code cleanup", "slop detection".
codex-description: 'Use when user asks to "clean up slop", "remove AI artifacts", "deslop the codebase", "find debug statements", "remove console.logs", "repo hygiene". Detects and removes AI-generated slop patterns.'
argument-hint: "[report|apply] [--scope=path] [--thoroughness=quick|normal|deep]"
allowed-tools: Task, Skill, Read, Edit, Glob, Grep, Bash(git:*), Bash(node:*)
---

# /deslop

Remove AI slop from a repository while keeping its behavior and public API intact, with the smallest diff that does it.

## Arguments

From `$ARGUMENTS`:

- **mode**: `report` (default) or `apply`.
- **scope**: `--scope=<all|diff|path>`, or a bare path. Default `all`.
- **thoroughness**: `--thoroughness=quick|normal|deep`. Default `normal`.

If the scope is a path that does not exist, reply `Path not found: <path>` and stop.

## Scan

Spawn `deslop:deslop-agent` with:

```
Scan for AI slop patterns.
Mode: {mode}
Scope: {scope}
Thoroughness: {thoroughness}

Return structured results between === DESLOP_RESULT === markers.
```

Without the Task tool (Codex, OpenCode), load the `deslop` skill in this session with the same arguments. It produces the same block.

Read the JSON between `=== DESLOP_RESULT ===` and `=== END_RESULT ===`. If it is missing or does not parse, show what came back and stop; do not apply anything.

## Report mode

```markdown
## Slop Hotspots

| Priority | File | Issue | Certainty | Fix |
|----------|------|-------|-----------|-----|
| 1 | src/api.js:42 | console.log | HIGH | auto |
| 2 | lib/utils.js:88 | excessive comments | MEDIUM | review |

## Summary

- **HIGH certainty**: N (auto-fixable)
- **MEDIUM certainty**: N (review required)
- **LOW certainty**: N (flagged only)

## Do Next

- [ ] Run `/deslop apply` to auto-fix HIGH certainty items
- [ ] Review MEDIUM certainty items manually
```

List findings marked `untested` first and say they have no test coverage.

## Apply mode

Apply `fixes` yourself with Edit (the `fixType` meanings are in the skill's output section). No other plugin is needed.

- Git is required, because the rollback depends on it. Without git, reply `Git required for rollback safety` and stop.
- Skip any fix in a file that already has uncommitted changes, and list it as skipped. Reverting a failed fix restores the whole file, and that must not take the user's own edits with it.
- Keep each change to the fix itself: no reformatting, no new dependencies or abstractions, deletion over invention, and follow the repo's CLAUDE.md or AGENTS.md conventions. When these pull against each other, preserving behavior and public APIs wins.
- Within a file, apply fixes from the bottom up so earlier line numbers stay valid.

Then run the project's test command (`npm test`, `pytest`, `cargo test`, `go test ./...`, or whatever the repo uses). If the harness asks permission for it, that is expected. If tests fail, run `git restore -- <the files you edited>`, report which fix broke them, and stop. If they pass, commit only the files you edited with `fix: clean up AI slop (auto-applied)`.

```markdown
## Applied Fixes

| File | Line | Fix |
|------|------|-----|
| src/api.js | 42 | remove-line (console.log) |

**Total**: N fixes applied

## Remaining (manual review needed)

| File | Line | Issue | Certainty |
|------|------|-------|-----------|
| lib/utils.js | 88 | excessive comments | MEDIUM |
```

Add a `Skipped` table when any fix was skipped, with the reason.

Pattern catalog and fix strategies: `references/slop-categories.md`. Detector CLI: `scripts/detect.js --help`.
