---
name: deslop
description: "Use when the user asks to deslop or clean up a change: 'deslop', 'clean up slop', 'sync docs', 'find duplicated code'. Runs a git-based detector for leftovers, doc drift, duplicates, overgrown functions and agent-config errors; a small model confirms each finding."
version: 5.5.0
argument-hint: "[report|apply] [--scope=diff|repo|PATH] [--base=REF]"
---

# deslop

One cleanup pass over a change. Software finds the candidates: leftovers of what the change removed or renamed, docs that no longer match the code, duplicated code, functions the change made too large, and agent-config errors. A small model then reads only the flagged lines and confirms each one. This skill only reads; the caller applies fixes.

Arguments: `$ARGUMENTS`

- **mode**: `report` (default) or `apply`. Passed through to the result; it does not change the scan.
- **--scope**: `diff` (default: the branch against its merge base), `repo` (every tracked file), or a path (repo scope narrowed to it).
- **--base**: base ref for diff scope. Default: origin's default branch.

## What it finds

| Check | What it means | Read before confirming |
|---|---|---|
| `stale-mention` | A file, flag, env var, function or value this change removed or replaced is still named elsewhere. | Is the line describing the current state? A dated record or a "was removed" note is fine. |
| `missing-path` | An added line cites a repo path that does not exist. HIGH when this change deleted it. | Is it an example, another repo's path, or a file a sibling PR adds? |
| `broken-anchor` | A Markdown link points at a heading that no longer exists. | Check the target's headings. |
| `doc-example-stale` | A docs example runs a command this change removed: a slash command whose file it deleted or renamed, or a package bin it took out of `package.json`. Removed or renamed flags are `stale-mention`. | Does the command still exist under that name somewhere? |
| `version-mismatch` | The change moved a package's version in one manifest and left another manifest with the same exact package name behind, or a new docs line pins another version. | Do both files describe the same package? |
| `changelog-missing` | A user-visible change (flag, env var, command, skill or agent file, package bin, or a `feat:`/`fix:`/`perf:` commit over code) with nothing under `Unreleased`. | Would users notice the change? |
| `scope-claim` | The PR text or a commit says docs-only or test-only but the diff changes code. | Comment-only code edits are fine. |
| `review-provenance` | A code comment records review history ("revuto round 2"). | Rewrite it to say why the code is this way, or delete it. |
| `test-cannot-fail` | A new test has no assertion, or a test script has no failing exit. | A helper the test calls may assert. |
| `test-swallows-failure` | Test code discards an error (`|| true`, `2>/dev/null`). | Is the failure checked another way? |
| `displaced-doc-comment` | New code was inserted between a doc comment and the item it documented. | Move the comment back above its item. |
| `duplicate-line` | A comment or prose line written twice. | |
| `duplicate-code` | Added code (60 tokens and 6 distinct lines or more) that already exists elsewhere in the repo, or twice in the change. | Do both copies do the same job? Generated or deliberately mirrored copies are fine. |
| `complexity` | The language's linter (ruff, the repository's eslint, golangci-lint, clippy) rates a function or block on a line this change added as too complex; the message quotes the linter. | Would it read better split? A flat table or a dispatcher can stay. |
| `no-caller`, `unread-setting` | Something added that nothing calls or reads. | Entry points, framework hooks and public API are wired from outside. |
| `dropped-rule` | A doc or prompt rewrite removed a rule or reason whose words appear nowhere in the new text. | Was dropping it intended? Current models shorten well but lose exceptions. |
| `missing-companion` | A file the repo declares (`together` in `.deslop.json`) or history shows changing with an edited file was left alone. | Does it describe or mirror what changed? |
| `agent-config` | agnix errors in agent files the change touched (instruction files, skills, agents, commands, plugin manifests, hooks, MCP configs), when agnix is installed. HIGH on lines the change wrote. | Does the rule apply to this harness? |
| `merge-residue`, `secret`, `local-path`, `broken-file` | Conflict markers, credentials, machine-local paths, unparseable JSON. | |
| `lint` | shellcheck, ruff or actionlint, on added lines, when installed. | |
| `em-dash` | House style. Turn it off with `{"style": {"emDash": false}}` in `.deslop.json`. | |

Logic errors, missed edge cases, races and wrong conditions need a reviewer; this skill does not look for them.

## Run

The scripts are in `scripts/`, two directories up from this skill. Resolve them to absolute paths and run from the repository root: the detector's JSON goes straight into the confirm step.

```bash
node <plugin>/scripts/detect.js . --json | node <plugin>/scripts/confirm.js --mode=<mode>   # diff scope against origin's default branch
node <plugin>/scripts/detect.js . --json --base=main --worktree | node <plugin>/scripts/confirm.js
node <plugin>/scripts/detect.js . --json --scope=repo -- docs/ | node <plugin>/scripts/confirm.js
node <plugin>/scripts/detect.js . --json --pr-body=<(gh pr view --json body -q .body) | node <plugin>/scripts/confirm.js
```

Without `--json` the detector prints a short text list, HIGH first, for a person to read.

Pass the PR body when there is one: `scope-claim` and `em-dash` read it along with the commit messages. `ripgrep` makes the detector fast on large repos; without it the detector falls back to `git grep`. Exit status 1 means the scan failed, not that it found something.

`confirm.js` runs the small model the project configured, in this order: `--cmd`, the `DESLOP_SMALL_CMD` environment variable, or the `small` role in gishra's `project.json` (`$GISHRA_STATE/project.json`, else `.gishra/project.json` at the root of the main checkout), for example `{"harness": "codex", "profile": "luna"}`. Harnesses: `claude`, `codex`, `opencode`, `agy`, `pi`, or `command` with a `command` array. `--cmd` and `DESLOP_SMALL_CMD` take the same kind of array as JSON, such as `["codex", "exec", "-p", "luna", "{prompt}"]`; it runs without a shell, an element that is exactly `{prompt}` becomes the prompt, and with none the prompt goes to stdin. A role may add `model`, `profile`, `provider`, `effort` and `args`. `--dry-run` prints the command it would run.

It prints one of two things:

- **A result**: JSON with `findings`, `fixes`, `dismissed`, `unconfirmed` and `summary`. Every fix was checked against the file. Use it as the `DESLOP_RESULT` below. If it carries an `"error"` (the model failed, replied with invalid JSON or left a finding unjudged), every finding is in `unconfirmed`: judge those yourself as in Confirm. If it carries `detectorErrors`, some checks did not run: report them. If it carries `skipped`, those languages were not measured (their linter is missing): name them. Never call a change clean while `unconfirmed` or `detectorErrors` is not empty.
- **`deslop-confirm: no small model configured`**, then each finding with its context. Judge them yourself as in Confirm.

## Confirm

Only when `confirm.js` did not judge the findings. Read each cited line (and the changed line it refers to) and decide:

- **real**: it is wrong after this change. Put it in `findings`, and in `fixes` when the edit is mechanical and you know the exact new text.
- **dismissed**: it is right as written (an example, a historical record, another repo's path). Leave it out of `findings` and count it in `summary.dismissed`.

Do not go looking for other problems while confirming; that is the review's job and it costs tokens here. A HIGH finding is almost always real; a REVIEW finding is real often enough to read.

A fix belongs in `fixes` only when you have read the line. `stale-mention` and `version-mismatch` findings carry the replacement token when the change renamed or moved something; confirm the new value is right for that line before using it.

## Output

Return this block last. `/deslop` and `/next-task` parse it; `fixes` use `next-task:simple-fixer`'s actions.

```
=== DESLOP_RESULT ===
{
  "mode": "report",
  "scope": "diff",
  "base": "origin/main",
  "findings": [
    { "file": "docs/setup.md", "line": 12, "check": "stale-mention", "severity": "high",
      "message": "names scripts/old-install.sh, which this change deleted" }
  ],
  "fixes": [
    { "file": "docs/setup.md", "line": 12, "action": "replace",
      "old": "scripts/old-install.sh", "new": "scripts/install.sh", "reason": "stale-mention" }
  ],
  "summary": { "reported": 3, "confirmed": 1, "dismissed": 2, "fixable": 1 }
}
=== END_RESULT ===
```

`severity` is the detector's level for that finding: `high` or `review`. Findings about the PR body or commit messages have `file: "(PR text)"` and `line: 0`; they are fixed by editing the PR or the next commit message, never by a file edit. `action` is `remove-line`, `replace` (`old` to `new` on that line), `insert-after` or `insert-before` (`new`). Paths are relative to the repository root. The extra fields `confirm.js` adds (`dismissed`, `unconfirmed`, `detectorErrors`, `skipped`, `model`) may stay in the block. On failure return the block with empty arrays and an `"error"` field.
