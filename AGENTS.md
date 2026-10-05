# deslop

This repo is the deslop plugin: AI slop cleanup with minimal diffs that preserve behavior. Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem; skills follow https://agentskills.io.

## Rules

- Output is plain text: no emojis or ASCII art. Status markers are `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]`.
- Commit only product files. Summaries, plans and audit notes belong in the PR or the conversation.
- A change is done when its tests pass; a feature or fix comes with a test that covers it.
- Non-trivial changes go through a PR, not a direct push to main. Run the git hooks; do not bypass them.
- In prose use ` - ` (single dash with spaces), not ` -- `.
- If a script fails, report the failure before doing the step by hand, so broken tooling gets fixed.
- Agent models: Opus for complex reasoning and planning, Sonnet for validation and most agents, Haiku for mechanical work.
- Priorities, in order: plugin users' experience, automation that needs no babysitting, token efficiency, output quality, simplicity.

## Layout

- `commands/deslop.md`: the `/deslop` command (report or apply).
- `agents/deslop-agent.md`: the read-only Sonnet scanner that returns the `DESLOP_RESULT` block.
- `skills/deslop/SKILL.md`: detection, judgment and the output contract; repo-intel detail in `skills/deslop/references/repo-intel.md`.
- `references/slop-categories.md`: pattern catalog and fix strategies per language.
- `scripts/detect.js`: the detector CLI (`--help`).
- `lib/` is synced from [agent-core](https://github.com/agent-sh/agent-core), including `lib/agentsys.js`, so change shared code there. These are local and edited here: `lib/repo-intel-signals.js`, `lib/utils/command-execution.js` and the nine host-authorization files listed in agent-core's [sync-exclude.json](https://github.com/agent-sh/agent-core/blob/main/sync-exclude.json) (`lib/patterns/cli-enhancers.js`, `lib/platform/verify-tools.js`, the benchmark, breaking-point, constraint, optimization and profiling runners in `lib/perf/`, `lib/sources/custom-handler.js` and `lib/sources/policy-questions.js`). The sync skips those nine.

## Checks

```bash
npm test   # jest (__tests__/) and the authorized-execution suite
agnix .    # agent config lint (also runs in CI)
```

CI also runs `tests/windows-shim-conformance.cjs` on Windows. User-visible changes get a CHANGELOG entry under `[Unreleased]`.
