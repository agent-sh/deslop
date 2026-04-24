# deslop

Detect and remove AI-generated slop from codebases with certainty-based findings and safe auto-fixes.

## Why

AI coding tools leave behind debug statements, placeholder text, empty catch blocks, over-commented code, and dead abstractions. Manual cleanup is tedious and error-prone. deslop runs a 3-phase detection pipeline that categorizes every finding by certainty level - HIGH findings get auto-fixed, MEDIUM findings get flagged for review, and LOW findings are reported without action. Behavior is preserved. Diffs are minimal.

**Use cases:**

- Pre-PR hygiene - scan changed files before opening a pull request
- Periodic repo maintenance - sweep the full codebase for accumulated slop
- CI gate - fail on HIGH-certainty slop in changed files

## Installation

```bash
agentsys install deslop
```

## Quick Start

```bash
# Report slop findings (no changes made)
/deslop

# Auto-fix HIGH certainty findings
/deslop apply

# Scan only changed files in current branch
/deslop report --scope=diff

# Fix up to 10 findings in a specific directory
/deslop apply src/ 10
```

## How It Works

deslop uses a 3-phase detection pipeline with increasing analysis depth:

**Phase 1 - Regex patterns (HIGH certainty).** Fast pattern matching for `console.log`, `print()`, `dbg!()`, TODO/FIXME markers, empty catch blocks, hardcoded secrets, trailing whitespace, and mixed indentation. These are safe to auto-fix.

**Phase 2 - Multi-pass analyzers (MEDIUM certainty).** Structural analysis for doc-to-code ratio problems, verbose over-commenting, over-engineering, buzzword inflation, dead code after return/throw, and stub functions. These need human review.

**Phase 3 - CLI tools (LOW certainty, optional).** Runs external tools when available - jscpd for duplication, madge for circular dependencies, eslint/pylint/clippy/golangci-lint for language-specific issues. Findings are flagged but not auto-fixed.

**Thoroughness levels** control which phases run:

| Level | Phases | Speed |
|-------|--------|-------|
| `quick` | Phase 1 only | Seconds |
| `normal` (default) | Phase 1 + 2 | Seconds |
| `deep` | Phase 1 + 2 + 3 | Depends on CLI tools |

**Repo-intel integration** - when repo-intel data is available, deslop targets AI-written files first (`recent-ai` query) and escalates MEDIUM findings to HIGH for files with no test coverage (`test-gaps` query).

## Certainty Levels

| Level | Meaning | Action |
|-------|---------|--------|
| HIGH | Definitely slop - safe to remove | Auto-fixed in apply mode |
| MEDIUM | Likely slop - needs context | Flagged for review |
| LOW | Possible slop - context-dependent | Reported only |

## Usage

### Report Mode (default)

```bash
/deslop
/deslop report --scope=diff
/deslop report --thoroughness=deep
```

Outputs a prioritized table of findings with certainty levels and suggested fixes. No files are modified.

### Apply Mode

```bash
/deslop apply
/deslop apply --scope=diff
/deslop apply src/ 10
```

Auto-fixes all HIGH certainty findings, then runs the project's test suite. If tests fail, all changes are rolled back with `git restore .` and the failing fix is reported.

### Scope Options

- `all` (default) - scan entire codebase
- `diff` - only files changed in current branch
- `<path>` - specific directory or file

### Thoroughness Options

```bash
/deslop --thoroughness=quick    # Phase 1 only
/deslop --thoroughness=normal   # Phase 1 + 2 (default)
/deslop --thoroughness=deep     # All phases
```

## Supported Languages

Two layers, two coverage stories:

| Layer | Languages | Detection |
|-------|-----------|-----------|
| **Analyzer slop queries** (when `repo-intel.json` present) | JavaScript/TypeScript, Python, Rust, Go, Java | tree-sitter AST: empty error handling per language idiom, tautological assertions across major test frameworks, orphan exports, cliché-name clusters, wrapper towers, single-impl traits, high-bug communities |
| **Regex pipeline** (always) | JavaScript/TypeScript, Python, Rust, Go, Java | universal patterns (debug statements, trailing whitespace, mixed indentation, placeholder text), language-specific patterns where defined |

Kotlin, C/C++, and Shell files are walked but no language-specific detectors are bundled today; only universal regex patterns apply. Tracked in [#27](https://github.com/agent-sh/agent-analyzer/issues/27).

## Requirements

- Git (required for rollback safety)
- Node.js
- [agentsys](https://github.com/agent-sh/agentsys) runtime
- For deep mode: jscpd, madge, eslint, pylint, clippy, or golangci-lint (optional, used when available)

## Related Plugins

- [next-task](https://github.com/agent-sh/next-task) - invokes deslop in Phase 8 pre-review gates
- [enhance](https://github.com/agent-sh/enhance) - broader code quality analysis
- [audit-project](https://github.com/agent-sh/audit-project) - multi-agent code review

## License

MIT
