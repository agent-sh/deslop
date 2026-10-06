# deslop

This repo is the deslop plugin: one cleanup pass over a change (leftovers current coding models leave, docs out of sync with the code, duplicated code, functions grown too large, agent-config errors). Software finds the candidates, a small model confirms them, and confirmed fixes are applied on request. Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem; skills follow https://agentskills.io.

## Rules

- Output is plain text: no emojis or ASCII art. Status markers are `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]`.
- Commit only product files. Summaries, plans and audit notes belong in the PR or the conversation.
- A change is done when its tests pass; a feature or fix comes with a test that covers it.
- Non-trivial changes go through a PR, not a direct push to main. Run the git hooks; do not bypass them.
- In prose use ` - ` (single dash with spaces), not ` -- `.
- If a script fails, report the failure before doing the step by hand, so broken tooling gets fixed.
- Models: the detector is software only. Confirming findings is a small model's job (the project's gishra `small` role, Codex Luna by default there), run by `scripts/confirm.js`; Claude agents inherit the session model.
- Priorities, in order: plugin users' experience, automation that needs no babysitting, token efficiency, output quality, simplicity.

## Layout

- `commands/deslop.md`: the `/deslop` command (report or apply).
- `agents/deslop-agent.md`: the read-only fallback agent that judges findings when no small model is configured, and returns the `DESLOP_RESULT` block.
- `skills/deslop/SKILL.md`: the checks, how to confirm each, and the output contract.
- `scripts/detect.js`: the detector CLI (`--help`); `detector/` holds its git access, diff parser, the lexer the code-shape checks share (`detector/code.js`) and one file per check in `detector/checks/`.
- `scripts/confirm.js`: the confirm step (`--help`): runs the configured small model on the detector's JSON and validates its reply and fixes.
- `lib/` is synced from [agent-core](https://github.com/agent-sh/agent-core), including `lib/agentsys.js`, so change shared code there. The detector does not use it. These are local and edited here: `lib/utils/command-execution.js` and the nine host-authorization files listed in agent-core's [sync-exclude.json](https://github.com/agent-sh/agent-core/blob/main/sync-exclude.json) (`lib/patterns/cli-enhancers.js`, `lib/platform/verify-tools.js`, the benchmark, breaking-point, constraint, optimization and profiling runners in `lib/perf/`, `lib/sources/custom-handler.js` and `lib/sources/policy-questions.js`). The sync skips those nine.

A new check needs a case in `__tests__/detect.test.js` that fails without it and a look-alike that must stay quiet. `__tests__/confirm.test.js` drives `scripts/confirm.js` with a stand-in model command; tests never call a real model. Precision matters more than coverage: a check that is wrong half the time costs every run the tokens to dismiss it.

## Checks

```bash
npm test   # jest (__tests__/) and the authorized-execution suite
agnix .    # agent config lint (also runs in CI)
```

CI also runs `tests/windows-shim-conformance.cjs` on Windows. User-visible changes get a CHANGELOG entry under `[Unreleased]`.
