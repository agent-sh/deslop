---
description: "Check a change for what current coding models leave behind: mentions of deleted or renamed things, paths and anchors that do not exist, review notes in code comments, tests that cannot fail. Reports by default; `apply` fixes confirmed findings. Use for 'deslop', 'clean up slop', 'check my diff for leftovers'."
codex-description: 'Use when user asks to "deslop", "clean up slop", "check my diff for leftovers", "find stale docs after a rename". Checks a change for what current coding models leave behind and fixes confirmed findings on request.'
argument-hint: "[report|apply] [--scope=diff|repo|PATH] [--base=REF]"
allowed-tools: Task, Skill, Read, Edit, Bash(git:*), Bash(node:*), Bash(gh:*)
---

# /deslop

Find and fix the leftovers of a change: text that was true before it and is not now, references that resolve to nothing, and tests that cannot fail.

## Arguments

From `$ARGUMENTS`:

- **mode**: `report` (default) or `apply`.
- **scope**: `--scope=diff|repo|<path>`, or a bare path. Default `diff`, the current branch against its merge base.
- **base**: `--base=<ref>` for diff scope.

If the scope is a path that does not exist, reply `Path not found: <path>` and stop.

## Scan

Spawn `deslop:deslop-agent` with:

```
Mode: {mode}
Scope: {scope}
Base: {base, if given}
Return the DESLOP_RESULT block.
```

Without the Task tool (Codex, OpenCode), load the `deslop` skill in this session with the same arguments.

Read the JSON between `=== DESLOP_RESULT ===` and `=== END_RESULT ===`. If it is missing or does not parse, show what came back and stop; apply nothing.

## Report mode

List each confirmed finding as `file:line - message`, grouped by check, then one line: `N reported, M confirmed, K dismissed`. If nothing was confirmed, say the change is clean. Mention `/deslop apply` only when `fixes` is not empty.

## Apply mode

Apply `fixes` yourself with Edit (actions: `remove-line`, `replace` on that line, `insert-after`, `insert-before`). Findings without a fix need a person or a rewrite; list them.

- Git is required for the rollback. Without it, reply `Git required for rollback safety` and stop.
- Skip any fix in a file that already has uncommitted changes and list it as skipped: reverting a failed fix restores the whole file, which must not take the user's own edits.
- Within a file, apply fixes bottom-up so line numbers stay valid. If the line no longer holds the `old` text, skip that fix.

Then run the project's test command. If it fails, `git restore -- <the files you edited>`, report which fix broke it, and stop. If it passes, commit only the files you edited with `fix: clean up leftovers (deslop)`, and list what was applied, what was skipped, and the findings left for a person.
