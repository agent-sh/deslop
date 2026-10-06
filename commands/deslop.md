---
description: "One cleanup pass over a change: leftovers of renamed or deleted things, docs out of sync with the code, duplicated code, functions grown too large, agent-config errors. A small model confirms each finding. Reports by default; `apply` fixes confirmed findings. Use for 'deslop', 'clean up slop', 'sync docs', 'check my diff for leftovers'."
codex-description: 'Use when user asks to "deslop", "clean up slop", "sync docs", "find duplicated code", "check my diff for leftovers". One cleanup pass over a change; a small model confirms findings and fixes are applied on request.'
argument-hint: "[report|apply] [--scope=diff|repo|PATH] [--base=REF]"
allowed-tools: Task, Skill, Read, Edit, Bash(git:*), Bash(node:*), Bash(gh:*)
---

# /deslop

Find and fix what a change left behind: text that was true before it and is not now, docs that no longer match the code, references that resolve to nothing, code copied instead of reused, functions grown too large, and tests that cannot fail.

## Arguments

From `$ARGUMENTS`:

- **mode**: `report` (default) or `apply`.
- **scope**: `--scope=diff|repo|<path>`, or a bare path. Default `diff`, the current branch against its merge base.
- **base**: `--base=<ref>` for diff scope.

If the scope is a path that does not exist, reply `Path not found: <path>` and stop.

## Scan

Load the `deslop` skill with the same arguments and run its Run section here: the detector, then `confirm.js`, which hands the findings to the project's small model.

- If `confirm.js` printed a result, that JSON is the `DESLOP_RESULT`. If its `unconfirmed` list is not empty (it then carries an `"error"`), those findings still need judging: treat them as in the next point.
- If it printed `deslop-confirm: no small model configured`, spawn `deslop:deslop-agent` to judge them:

```
Mode: {mode}
Scope: {scope}
Base: {base, if given}
Return the DESLOP_RESULT block.
```

Without the Task tool (Codex, OpenCode), judge them in this session as the skill's Confirm section says.

Read the JSON between `=== DESLOP_RESULT ===` and `=== END_RESULT ===` (or `confirm.js`'s output). If it is missing or does not parse, show what came back and stop; apply nothing.

## Report mode

List each confirmed finding as `file:line - message`, grouped by check, then one line: `N reported, M confirmed, K dismissed`. Say the change is clean only when nothing was confirmed and every reported finding was judged; a finding still in `unconfirmed` is listed as unjudged, never counted as clean. Mention `/deslop apply` only when `fixes` is not empty.

## Apply mode

Apply `fixes` yourself with Edit (actions: `remove-line`, `replace` on that line, `insert-after`, `insert-before`). Findings without a fix need a person or a rewrite; list them.

- Git is required for the rollback. Without it, reply `Git required for rollback safety` and stop.
- Skip any fix in a file that already has uncommitted changes and list it as skipped: reverting a failed fix restores the whole file, which must not take the user's own edits.
- Within a file, apply fixes bottom-up so line numbers stay valid. If the line no longer holds the `old` text, skip that fix.

Then run the project's test command. If it fails, `git restore -- <the files you edited>`, report which fix broke it, and stop. If it passes, commit only the files you edited with `fix: clean up leftovers (deslop)`, and list what was applied, what was skipped, and the findings left for a person.
