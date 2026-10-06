---
name: deslop
description: "Use when the user asks to deslop or clean up a change: 'deslop', 'clean up slop', 'check my diff for leftovers'. Runs a git-based detector for what current models leave behind, verifies each finding, and returns confirmed findings and safe fixes."
version: 5.5.0
argument-hint: "[report|apply] [--scope=diff|repo|PATH] [--base=REF]"
---

# deslop

Check a change for the defects current coding models leave that no compiler or test catches, confirm each one by reading it, and return the confirmed ones with fixes. This skill only reads; the caller applies fixes.

Arguments: `$ARGUMENTS`

- **mode**: `report` (default) or `apply`. Passed through to the result; it does not change the scan.
- **--scope**: `diff` (default: the branch against its merge base), `repo` (every tracked file), or a path (repo scope narrowed to it).
- **--base**: base ref for diff scope. Default: origin's default branch.

## What it finds

Models no longer leave debug prints and TODO stubs. They leave text that was true before the change: a doc still naming a script the change deleted, a count updated in one file and not the next, a link to a heading that was renamed, a comment that records the review round instead of the reason. The detector looks for those with git, so it costs no tokens when the change is clean.

| Check | What it means | Read before confirming |
|---|---|---|
| `stale-mention` | A file, flag, env var, function or value this change removed or replaced is still named elsewhere. | Is the line describing the current state? A dated record or a "was removed" note is fine. |
| `missing-path` | An added line cites a repo path that does not exist. HIGH when this change deleted it. | Is it an example, another repo's path, or a file a sibling PR adds? |
| `broken-anchor` | A Markdown link points at a heading that no longer exists. | Check the target's headings. |
| `scope-claim` | The PR text or a commit says docs-only or test-only but the diff changes code. | Comment-only code edits are fine. |
| `review-provenance` | A code comment records review history ("revuto round 2"). | Rewrite it to say why the code is this way, or delete it. |
| `test-cannot-fail` | A new test has no assertion, or a test script has no failing exit. | A helper the test calls may assert. |
| `test-swallows-failure` | Test code discards an error (`|| true`, `2>/dev/null`). | Is the failure checked another way? |
| `displaced-doc-comment` | New code was inserted between a doc comment and the item it documented. | Move the comment back above its item. |
| `duplicate-line` | A comment or prose line written twice. | |
| `no-caller`, `unread-setting` | Something added that nothing calls or reads. | Entry points, framework hooks and public API are wired from outside. |
| `dropped-rule` | A doc or prompt rewrite removed a rule or reason whose words appear nowhere in the new text. | Was dropping it intended? Current models shorten well but lose exceptions. |
| `missing-companion` | A file the repo declares (`together` in `.deslop.json`) or history shows changing with an edited file was left alone. | Does it describe or mirror what changed? |
| `merge-residue`, `secret`, `local-path`, `broken-file` | Conflict markers, credentials, machine-local paths, unparseable JSON. | |
| `lint` | shellcheck, ruff or actionlint, on added lines, when installed. | |
| `em-dash` | House style. Turn it off with `{"style": {"emDash": false}}` in `.deslop.json`. | |

Logic errors, missed edge cases, races and wrong conditions need a reviewer; this skill does not look for them.

## Run

The detector is `scripts/detect.js`, two directories up from this skill. Resolve it to an absolute path and run it from the repository root:

```bash
node <plugin>/scripts/detect.js .                         # diff scope against origin's default branch
node <plugin>/scripts/detect.js . --base=main --worktree  # include uncommitted changes
node <plugin>/scripts/detect.js . --scope=repo -- docs/   # every tracked file under docs/
gh pr view --json body -q .body | node <plugin>/scripts/detect.js . --pr-body=-
```

Pass the PR body when there is one: `scope-claim` and `em-dash` read it along with the commit messages. Output is a short text list, HIGH first; `--json` gives the same as JSON. `ripgrep` makes it fast on large repos; without it the detector falls back to `git grep`. Exit status 1 means the scan failed, not that it found something.

## Confirm

The detector reports candidates. Read each cited line (and the changed line it refers to) and decide:

- **real**: it is wrong after this change. Put it in `findings`, and in `fixes` when the edit is mechanical and you know the exact new text.
- **dismissed**: it is right as written (an example, a historical record, another repo's path). Leave it out of `findings` and count it in `summary.dismissed`.

Do not go looking for other problems while confirming; that is the review's job and it costs tokens here. A HIGH finding is almost always real; a REVIEW finding is real often enough to read.

A fix belongs in `fixes` only when you have read the line. `stale-mention` findings carry the replacement token when the change renamed something; confirm the new name is right for that line before using it.

## Output

Return this block last. `/deslop` and `/next-task` parse it; `fixes` use `next-task:simple-fixer`'s actions.

```
=== DESLOP_RESULT ===
{
  "mode": "report",
  "scope": "diff",
  "base": "origin/main",
  "findings": [
    { "file": "docs/setup.md", "line": 12, "check": "stale-mention",
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

`action` is `remove-line`, `replace` (`old` to `new` on that line), `insert-after` or `insert-before` (`new`). Paths are relative to the repository root. On failure return the block with empty arrays and an `"error"` field.
