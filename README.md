# deslop

One cleanup pass over a change: leftovers of what it removed or renamed, docs that no longer match the code, duplicated code, functions grown too large, and agent-config errors. Software finds the candidates; a small model confirms each one; confirmed fixes are applied on request.

## Why

The slop changed. Current models do not leave debug prints, TODO stubs or empty catch blocks; in a study of 2,912 defects that reviewers found in agent-written pull requests, 6 were that kind. What they leave is text that was true before the change:

- a doc, comment or setting that still names the script, flag or env var the change deleted
- a count or version updated in one file and not in its copies
- a link to a heading that was renamed, a cited path that does not exist
- a code comment that records the review round instead of the reason
- a test that cannot fail, a PR body that says "docs-only" over a code change
- a rewritten instruction file that lost a rule or its reason

deslop 1.x looked for the old kind. Measured on 39 recent pull requests, 0.5% of its findings were real and it caught none of the 106 defects reviewers found, while a run cost 15 to 25K tokens. deslop 2 is a git-based detector: it costs nothing when the change is clean, and a small model reads only the lines it flags.

The same pass covers the cleanup that used to need separate tools: docs kept in sync with the code (changelog entries, CLI examples, versions), code copied instead of reused, functions a change pushed past a readable size, and agent configuration checked by [agnix](https://github.com/agent-sh/agnix).

## Installation

```bash
agentsys install deslop
```

## Usage

```bash
/deslop                      # report on the current branch against its merge base
/deslop apply                # apply the fixes the agent confirmed, run tests, commit
/deslop --base=release/2.x   # another base
/deslop --scope=docs/        # every tracked file under docs/, no diff
```

The detector and the confirm step run on their own too:

```bash
node scripts/detect.js .                    # text report
node scripts/detect.js . --json --worktree  # include uncommitted changes
gh pr view --json body -q .body | node scripts/detect.js . --pr-body=-
node scripts/detect.js . --json | node scripts/confirm.js   # findings confirmed by the small model
```

## What it checks

| Check | Finds |
|---|---|
| `stale-mention` | A file, flag, env var, function or value the change removed or replaced, still named elsewhere |
| `missing-path`, `broken-anchor` | Cited paths and Markdown heading links that resolve to nothing |
| `scope-claim` | PR text or commits claiming docs-only or test-only over a code change |
| `review-provenance` | Review history in code comments |
| `test-cannot-fail`, `test-swallows-failure` | Tests with no assertion, scripts with no failing exit, swallowed errors |
| `displaced-doc-comment`, `duplicate-line` | Code inserted between a doc comment and its item; lines written twice |
| `no-caller`, `unread-setting` | Added code nothing calls, settings nothing reads |
| `dropped-rule` | Rules and reasons a doc or prompt rewrite removed |
| `missing-companion` | Files declared or historically changed together, where the change edited one side |
| `changelog-missing` | A user-visible change (CLI flag, env var, command, skill or agent file, package bin, or a `feat:`/`fix:`/`perf:` commit over code) with no entry under `Unreleased` |
| `doc-example-stale` | A docs example passing a flag the repo's own CLI or slash command does not define, or invoking a slash command the change deleted |
| `version-mismatch` | A package version moved in one manifest and not in another manifest of the same package (plugin.json, marketplace.json, Cargo.toml, pyproject.toml), or a new docs line pinning another version |
| `duplicate-code` | Added code of 60 tokens and 6 distinct lines or more that already exists elsewhere in the repo, or twice in the change |
| `complexity` | A function the change pushed past 80 lines, 5 levels of control-flow nesting or 6 parameters (JS/TS, Python, Rust, Go, shell) |
| `agent-config` | agnix errors in instruction files, skills, agents, commands, plugin manifests, hooks and MCP configs the change touched, when agnix is installed |
| `merge-residue`, `secret`, `local-path`, `broken-file` | Conflict markers, credentials, machine-local paths, unparseable JSON |
| `lint` | shellcheck, ruff and actionlint on added lines, when installed |
| `em-dash` | House style; off with `.deslop.json` |

`duplicate-code` and `complexity` skip tests, generated files and snapshot or dated record folders. With `--scope=repo` they audit the whole repository instead of a change.

Logic errors, edge cases and races need a reviewer, so deslop does not guess at them.

## The small model

`scripts/confirm.js` sends each finding, with the flagged line and two lines around it, to a small model and keeps only what it confirms. Fixes come back in `next-task:simple-fixer`'s format and are checked against the file before they are returned. It runs, in this order:

1. `--cmd="..."`: a shell command; `{prompt}` in it is replaced by the prompt, otherwise the prompt goes to stdin.
2. `DESLOP_SMALL_CMD`: the same, from the environment.
3. The `small` role in [gishra](https://github.com/agent-sh/gishra)'s `project.json` (`$GISHRA_STATE/project.json`, else `.gishra/project.json` at the root of the main checkout):

```json
{ "roles": { "small": { "harness": "codex", "profile": "luna" } } }
```

| harness | command |
|---|---|
| `codex` | `codex exec -p <profile> <prompt>` (or `-m <model>`; `-c model_reasoning_effort=<effort>`) |
| `claude` | `claude -p <prompt> --model <model>` (`--effort <effort>`) |
| `opencode` | `opencode run <prompt> -m <model>` (`--variant <effort>`) |
| `agy` | `agy -p <prompt> --model <model> --effort <effort>` |
| `pi` | `pi -p <prompt> --model <model> --provider <provider> --thinking <effort>` |
| `command` | the `command` array, with `{prompt}` replaced |

Options missing from the role are left out; `args` are appended last. The step edits nothing, so no permission flags are passed. `--dry-run` prints the command that would run.

With no model configured, `confirm.js` prints the findings ready to judge and exits 0; `/deslop` then hands them to `deslop-agent`, which uses the session's model. A reply that is not valid JSON in the expected shape is discarded: every finding comes back unconfirmed with an `error`.

## Configuration

`.deslop.json` at the repository root:

```json
{
  "ignore": ["vendor/**", "fixtures/**"],
  "disable": ["lint"],
  "style": { "emDash": false },
  "together": [{ "when": "rules.json", "also": "docs/RULES.md", "message": "rule changes need the rules doc" }],
  "mineCochange": true
}
```

## Requirements

- Git and Node.js
- [ripgrep](https://github.com/BurntSushi/ripgrep) recommended: on large repositories it is the difference between seconds and minutes
- shellcheck, ruff and actionlint are used when installed
- [agnix](https://github.com/agent-sh/agnix) is used for `agent-config` when installed
- a small model for the confirm step (optional): a gishra `small` role, `DESLOP_SMALL_CMD` or `--cmd`

## Related plugins

- [next-task](https://github.com/agent-sh/next-task) runs deslop before review
- [audit-project](https://github.com/agent-sh/audit-project) for multi-agent review

## Host authorization for command execution

The bundled benchmark, profiling and custom-source helpers treat command strings and
policy responses as data. They now deny process execution unless trusted host code
supplies a separate synchronous `authorizeExecution(request)` callback. Only literal
`true` approves a launch. Missing callbacks, JSON flags, promises and policy errors
deny it. Authorization failures expose a generic error without policy details.

Migration for callers:

- `runBenchmark(command, options, authorizeExecution)`
- `runBenchmarkSeries(command, options, authorizeExecution)`
- `runProfiling(options, authorizeExecution)`
- `runBreakingPointSearch(options, authorizeExecution)`,
  `runConstraintTest(options, authorizeExecution)` and
  `runOptimizationExperiment(options, authorizeExecution)`
- `probeCLI(toolName, authorizeExecution)`,
  `buildCustomConfig(type, name, authorizeExecution)` and
  `parseAndCachePolicy(responses, authorizeExecution)`

Each launch has its own immutable request containing the final executable, argv,
platform, Windows shim plan, absolute cwd, effective environment and spawn options.
Approve that complete invocation from a trusted policy or an operator decision.
Profiler overrides and optimization warmup are separate launches. Never construct the
callback from remote input, deserialize executable JavaScript, or return `true`
unconditionally for untrusted data. Authority is never saved in source preferences.

`isToolAvailable(command)` and `checkTool(command, versionFlag)` now accept only their
existing fixed availability checks. Unknown commands and flags return unavailable.
Use the callback-bound custom probe for an operator-approved additional CLI.
Pure parsing and Windows argument planning remain available without approval.

Approval permits host execution. It does not isolate filesystem, network or credentials,
or make project code safe. Use a separate sandbox when the approved program or inspected
repository needs isolation. Host code owns executable lookup, repository contents and
environment policy, including PATH and interpreter startup variables.

## License

MIT
