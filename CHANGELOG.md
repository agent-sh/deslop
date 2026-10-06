# Changelog

## [Unreleased]

### Added
- One cleanup pass instead of separate tools. New checks: `changelog-missing` (a user-visible change, such as a new flag, env var, command or `feat:` commit over code, with nothing under `Unreleased`), `doc-example-stale` (a docs example passing a flag the repo's own CLI or slash command does not define, or a slash command the change deleted; HIGH only when the command's entry file keeps its arguments to itself), `version-mismatch` (a version moved in one manifest of a package and not in another, such as `.claude-plugin/plugin.json`, or a new docs line pinning another version), `duplicate-code` (added code that already exists elsewhere, found by token fingerprints), `complexity` (a function the change pushed past 80 lines, 5 levels of nesting or 6 parameters) and `agent-config` (agnix errors in agent files the change touched, when agnix is installed).
- `scripts/confirm.js`: a small model confirms the detector's findings and returns fixes, each checked against the file. The model is `--cmd`, `DESLOP_SMALL_CMD`, or the gishra `small` role (`claude`, `codex`, `opencode`, `agy`, `pi` or a `command` array, with optional model, profile, provider, effort and args). With no model configured it prints the findings for the calling agent to judge. A reply that leaves any finding unjudged is rejected, and prompts are batched by UTF-8 bytes to stay under the exec argument limit.

### Changed
- `deslop-agent` no longer pins Sonnet; it inherits the session model and judges findings only when no small model is configured.
- `--scope=repo` reads files in batches and skips lock, vendored and recorded-data files, which no check reads: on a 200,000-file repository it finishes in about half a minute instead of running out of memory.
- Breaking: deslop now checks a change for what current coding models leave behind, not the debug prints and TODO stubs older models left. The detector (`scripts/detect.js`, `detector/`) is rewritten around git: leftover mentions of files, flags, env vars, functions and values the change removed or replaced; cited paths and heading anchors that do not exist; docs-only or test-only claims over code changes; review history in code comments; tests with no assertion; code inserted between a doc comment and its item; rules a doc or prompt rewrite dropped; unwired additions; conflict markers, secrets and machine-local paths; shellcheck, ruff and actionlint on added lines.
- Default scope is the branch diff against its merge base. `--scope=repo` or a path scans tracked files without a diff. The PR body (`--pr-body`) and commit messages are checked against the diff.
- Each finding is confirmed by reading the flagged line (by the small model, or the agent when none is configured), and only confirmed ones are returned. `fixes` use `next-task:simple-fixer`'s actions (`remove-line`, `replace` with `old`/`new`, `insert-after`, `insert-before`), so next-task can apply them as they are.
- Measured on 39 agent-written pull requests: 1.x reported 3,367 findings at 0.5% precision and caught none of the 106 defects reviewers found; 2.0 reports 57, of which 23 of 25 HIGH are real. On 48 held-out pull requests it reports 9, 3 of 4 HIGH real.
- `missing-companion`: files the repository declares as changing together (`together` in `.deslop.json`), or that recent history almost always changes together, where the change edited one side only.

### Removed
- `--thoroughness`, the regex pattern catalog (`references/slop-categories.md`), the repo-intel integration (`lib/repo-intel-signals.js`, `skills/deslop/references/repo-intel.md`) and the jscpd, madge and escomplex runs.

## [1.3.0] - 2026-10-06

### Changed
- `/deslop` description says what the command does (report by default, remove on request) before its trigger phrases, and the agent and AGENTS.md lost lines current models do not need. Same contract.
- `.agnix.toml` no longer disables the six rules that existed only for the old generated AGENTS.md, so the lint covers the new one.
- Breaking for direct callers of the `lib/` helpers: benchmark, profiling and custom CLI execution require a separate trusted host authorization callback. Plain command data and cached preferences cannot authorize a process. The callback approves the final immutable invocation for each launch. Callers pass `authorizeExecution` to the helpers; the migration list is in the README.
- Generic tool availability checks accept only their original fixed command and flag pairs. Additional CLI probes use the callback-bound custom-source API.

### Removed
- Removed unused `lib/repo-map/` leftovers (cache, converter, installer, updater) and a stale `lib/binary/index.test.js`.

### Fixed
- Windows batch-shim launches explicitly disable delayed expansion so literal exclamation
  marks in arguments remain intact even when the user's command processor enables it.
- Mistaken asynchronous host policies that return native promises from another realm are denied without leaving normal rejected promises unhandled. Denied execution starts no command child and policy failures expose no private exception details.

### Security
- Dev dependency `jest` moved to 30 and the CI reusable workflows and actions are pinned to commit SHAs, clearing the open dependency and workflow alerts.

## [1.2.0] - 2026-09-24

### Changed
- Rewrote the `/deslop` command, `deslop-agent` and the `deslop` skill for current models: goal, constraints with their reasons, a definition of done and one output contract, in place of phase pseudocode and three differing result shapes.
- One `DESLOP_RESULT` shape (findings array, fixes array, summary) and one `fixType` table, mapped from the detector's `autoFix` values and the analyzer's actions. The agent had documented a different `findings` object and the command a different fix vocabulary.
- The skill tells the model to check each HIGH finding before it becomes a fix: `console.log` in a CLI entry point is output, not debugging.
- Files with no test coupling are ranked first and marked `untested`, but no longer promoted from MEDIUM into auto-applied fixes: an unverified fix in untested code is the one nobody catches.
- The test-gaps lookup moved from a JavaScript block in the command (which had no `node` permission to run it) into the skill, as a `node -e` command. Repo-intel detail moved to `skills/deslop/references/repo-intel.md`.
- `scripts/detect.js` takes files to scan after the repo path, or `--files-from FILE|-`, and scans exactly those. `--scope=diff` pipes the changed files in. The old recipe piped files as extra paths, which the CLI dropped (it kept only the last) and a single file path returned nothing. A whole-repo run is a sample (200 source files, no tests, or the repo-intel targets) and the skill says so.
- `/deslop apply` skips files that already have uncommitted changes and reverts only the files it edited (`git restore -- <files>`) instead of `git restore .`, which discarded all of the user's uncommitted work on a test failure. It commits only the files it edited.

## [1.1.0] - 2026-09-23

### Changed
- `/deslop apply` applies HIGH certainty fixes itself with Edit instead of spawning `next-task:simple-fixer`, so it works without the next-task plugin.
- `/deslop` on a harness without Task (Codex, OpenCode) runs the deslop skill in the current session instead of stalling.
- Skill description cut to one trigger sentence (under 40 words) so Codex does not truncate it.


### Added
- Repo-intel integration: pre-fetch repo-intel data in `/deslop` command before agent spawn
- Pipeline risk weighting: test-gaps escalate MEDIUM findings to HIGH; diff-risk scores sort findings within certainty tiers
- Repo-intel and repo-map generation prompts in deslop skill (ask user when map not found)
- AI-targeted file scanning: use `recent-ai` query to prioritize AI-written files in detection pipeline
- Go language support with 15 slop detection patterns:
  - `placeholder_panic_go` - panic("TODO: ...") placeholder
  - `go_fmt_debugging` - fmt.Print/Println/Printf debug statements
  - `go_log_debugging` - log.Print/Println/Printf debug logging
  - `go_spew_debugging` - spew.Dump/Sdump debug output
  - `go_empty_error_check` - empty if err != nil {} blocks
  - `go_discarded_error` - _ = someFunc() discarding errors
  - `go_bare_os_exit` - os.Exit without defer cleanup
  - `go_empty_interface_param` - interface{} parameters
  - `go_todo_empty_func` - empty function bodies with TODO comments
  - `go_unchecked_type_assertion` - type assertion without comma-ok (panics)
  - `go_panic_recoverable` - panic for recoverable errors
  - `go_error_string_capitalized` - capitalized error strings (Go convention)
  - `go_defer_close_no_error` - defer Close() without error handling
  - `go_weak_random` - math/rand instead of crypto/rand
  - `go_unused_append` - append() result not assigned (always a bug)
- golangci-lint integration in Phase 2 pipeline
- Java language support with 10 slop detection patterns:
  - `placeholder_unsupported_java` - throw new UnsupportedOperationException()
  - `java_sysout_debugging` - System.out/err.println() debug output
  - `java_stacktrace_debugging` - printStackTrace() calls
  - `java_throw_todo` - RuntimeException("TODO") / IllegalStateException("not implemented")
  - `java_return_null_todo` - return null; // TODO placeholder
  - `java_empty_catch` - empty catch blocks
  - `java_catch_ignore` - catch block with // ignore comment
  - `java_suppress_warnings` - @SuppressWarnings annotations
  - `java_raw_type` - raw generics without type parameters
  - `java_wildcard_catch` - overly broad catch (Exception/Throwable)
- Kotlin language support with 6 slop detection patterns:
  - `kotlin_println_debugging` - println() debug output
  - `kotlin_todo_call` - TODO() stdlib call that throws at runtime
  - `kotlin_fixme_comment` - // FIXME comment with placeholder code
  - `kotlin_empty_catch` - empty catch blocks
  - `kotlin_swallowed_error` - runCatching{}.getOrNull() silently swallows errors
  - `kotlin_suppress_annotation` - @Suppress annotations
- Support for Kotlin file extensions (.kt, .kts)
- build.gradle, build.gradle.kts, pom.xml as Java/Kotlin project indicators
- 510 tests for Java and Kotlin patterns
- C/C++ language support with 10 slop detection patterns:
  - C (7 patterns): `c_printf_debugging`, `c_ifdef_debug_block`, `c_placeholder_todo`, `c_pragma_warning_disable`, `c_goto_usage`, `c_hardcoded_credential_path`, `c_magic_number_cast`
  - C++ (3 patterns): `cpp_cout_debugging`, `cpp_throw_not_implemented`, `cpp_empty_catch`
- Support for C/C++ file extensions (.c, .h, .cpp, .cc, .cxx, .hpp, .hxx)
- CMakeLists.txt and meson.build as C/C++ project indicators
- cppcheck and clang-tidy CLI tool support
- 93 tests for C/C++ patterns
- Python language support with 8 new slop detection patterns:
  - `python_bare_except` - bare except: without exception type
  - `python_eval_exec` - eval/exec usage
  - `python_os_system` - os.system calls
  - `python_chmod_777` - overly permissive file permissions (0o777)
  - `python_hardcoded_path` - hardcoded user home paths
  - `python_logging_debug` - logging.basicConfig with DEBUG level
  - `python_os_environ_debug` - debug prints of os.environ/sys.argv
  - `python_shell_injection` - subprocess with shell=True
- Shebang detection for extensionless Python scripts
- 100 tests for Python patterns
- Rust language support with 10 slop detection patterns:
  - `rust_debugging` - println!(), dbg!(), eprintln!() debug macros
  - `placeholder_todo_rust` - todo!() and unimplemented!() macros
  - `placeholder_panic_todo_rust` - panic!("TODO: ...") placeholders
  - `rust_bare_unwrap` - bare .unwrap() without error context
  - `rust_log_debug` - log::debug!(), log::trace!() left in production
  - `rust_empty_match_arm` - empty Err(_) => {} match arms
  - `rust_unnecessary_clone` - potentially unnecessary .clone() calls
  - `rust_unsafe_block` - unsafe blocks without SAFETY comment
  - `rust_hardcoded_path` - hardcoded absolute paths (/home/, /tmp/, etc.)
  - `rust_expect_production` - .expect() that can panic in production
- Test infrastructure with Jest (85 tests for Rust patterns)
- Shell/Bash language support with 10 slop patterns (.sh, .bash, .zsh)
- 72 tests for Shell patterns

## [1.0.0] - 2026-02-21

Initial release. Extracted from [agentsys](https://github.com/agent-sh/agentsys) monorepo.
