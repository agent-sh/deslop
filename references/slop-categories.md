# Slop Pattern Categories

Detailed reference for all slop patterns detected by the pipeline.

## Pattern Categories

### Console Debugging

| Language | Patterns | Severity |
|----------|----------|----------|
| JavaScript | `console.log()`, `console.debug()`, `console.info()` | medium |
| Python | `print()`, `import pdb`, `breakpoint()` | medium |
| Rust | `println!()`, `dbg!()`, `eprintln!()` | medium |
| Rust | `log::debug!()`, `log::trace!()` | medium |

**Excludes**: Test files, CLI entry points, config files

### Unsafe Error Handling (Rust)

| Pattern | Severity | Better Alternatives |
|---------|----------|---------------------|
| `.unwrap()` | medium | `.expect("msg")`, `.unwrap_or(default)`, `?` operator |
| `.expect("msg")` | medium | `?` operator, explicit match/if-let |
| `Err(_) => {}` empty match arm | high | Log error, return Err, or propagate |

Bare `.unwrap()` and `.expect()` calls can cause panics in production. Prefer:
- `?` operator - propagate errors to caller
- `.unwrap_or(default)` / `.unwrap_or_default()` - provide fallback
- `.unwrap_or_else(\|\| ...)` - lazy fallback computation
- `.ok()` / `.map()` / `.and_then()` - transform Result/Option

Empty error match arms silently swallow errors. Always log or propagate.

**Excludes**: Test files, examples, benchmarks

### Placeholder Code

| Pattern | Language | Severity |
|---------|----------|----------|
| `throw new Error("TODO: ...")` | JavaScript | high |
| `todo!()`, `unimplemented!()` | Rust | high |
| `raise NotImplementedError` | Python | high |
| `panic("TODO: ...")` | Go | high |
| Empty function bodies `{}` | All | high |
| `pass` only functions | Python | high |

### Error Handling Issues

| Pattern | Description | Fix Strategy |
|---------|-------------|--------------|
| Empty catch blocks | `catch (e) {}` | add_logging |
| Silent except | `except: pass` | add_logging |

### Hardcoded Secrets

**Critical severity** - always flagged for manual review.

| Pattern | Examples |
|---------|----------|
| Generic credentials | `password=`, `api_key=`, `secret=` |
| JWT tokens | `eyJ...` base64 pattern |
| Provider-specific | `sk-` (OpenAI), `ghp_` (GitHub), `AKIA` (AWS) |

**Excludes**: Template placeholders (`${VAR}`, `{{VAR}}`), masked values (`xxxxxx`)

### Documentation Issues

| Pattern | Description | Severity |
|---------|-------------|----------|
| JSDoc > 3x function | Excessive documentation | medium |
| Issue/PR references | `// #123`, `// PR #456` | medium |
| Stale file references | `// see auth-flow.md` | low |

### Code Smells

| Pattern | Description | Severity |
|---------|-------------|----------|
| Boolean blindness | `fn(true, false, true)` | medium |
| Message chains | `a.b().c().d().e()` | low |
| Mutable globals | `let CONSTANT = ...` | high |
| Dead code | Unreachable after return | high |
| Unnecessary `.clone()` (Rust) | Review if borrow would suffice | low |
| `unsafe {}` without `// SAFETY:` (Rust) | Missing justification comment | high |

### Portability Issues

| Pattern | Description | Severity |
|---------|-------------|----------|
| Hardcoded absolute paths (Rust) | `"/home/..."`, `"/tmp/..."`, `"/etc/..."` | medium |
| Hardcoded user paths (Python) | `"/home/user/"`, `"/Users/user/"` | medium |

Hardcoded paths like `/home/user/config` or `/tmp/cache` break cross-platform portability.
Use `std::env::temp_dir()`, `dirs::home_dir()`, `os.path.expanduser("~")`, or `pathlib.Path.home()`.

### Python

| Pattern | Description | Severity |
|---------|-------------|----------|
| python_debugging | print(), pdb, breakpoint() debug statements | medium |
| placeholder_not_implemented_py | raise NotImplementedError placeholder | high |
| placeholder_pass_only_py | Function with only pass statement | high |
| placeholder_ellipsis_py | Function with only ellipsis (...) | high |
| empty_except_py | Empty except blocks with pass | high |
| mutable_globals_py | Mutable global collections (list/dict/set) | high |
| python_bare_except | Bare except: without exception type | high |
| python_eval_exec | eval()/exec() usage | high |
| python_os_system | os.system() calls | medium |
| python_chmod_777 | os.chmod with 0o777 | high |
| python_hardcoded_path | Hardcoded /home/ or /Users/ paths | medium |
| python_logging_debug | logging.basicConfig with DEBUG level | medium |
| python_os_environ_debug | Debug prints of os.environ/sys.argv | medium |
| python_shell_injection | subprocess with shell=True | high |

### Shell/Bash

| Pattern | Description | Severity |
|---------|-------------|----------|
| shell_debugging | set -x/set -v debug tracing left enabled | medium |
| shell_echo_debug | Debug echo statements (DEBUG, TRACE, HERE) | medium |
| shell_placeholder_todo | Placeholder functions (not implemented, TODO) | high |
| shell_error_silencing | Error silencing with \|\| true | medium |
| shell_empty_trap | Empty trap handlers | high |
| shell_hardcoded_path | Hardcoded user paths (/home/, /Users/) | medium |
| shell_chmod_777 | Overly permissive chmod 777 | critical |
| shell_curl_pipe_bash | Piping remote content to shell | critical |
| shell_unquoted_variable | Unquoted variables in dangerous commands | high |
| shell_eval_usage | Eval command usage | high |

### Verbosity Patterns

| Pattern | Examples | Severity |
|---------|----------|----------|
| AI preambles | "Certainly!", "I'd be happy to help" | low |
| Marketing buzzwords | "synergize", "paradigm shift" | low |
| Hedging language | "it's worth noting", "arguably" | low |

## Certainty Levels

### HIGH Certainty
- Direct regex match
- Definitive slop pattern
- Safe for auto-fix

### MEDIUM Certainty
- Multi-pass analysis required
- Review context before fixing
- May need human judgment

### LOW Certainty
- Heuristic detection
- High false positive rate
- Flag only, no auto-fix

## Auto-Fix Strategies

| Strategy | When Used |
|----------|-----------|
| `remove` | Debug statements, trailing whitespace |
| `replace` | Mixed indentation, multiple blank lines |
| `add_logging` | Empty error handlers |
| `flag` | Secrets, placeholders, code smells |

## Multi-Pass Analyzers

These patterns require structural analysis beyond regex:

- `doc_code_ratio_js` - JSDoc/function ratio
- `over_engineering_metrics` - File/export ratios
- `buzzword_inflation` - Claims vs evidence
- `infrastructure_without_implementation` - Setup without usage
- `dead_code` - Unreachable code detection
- `shotgun_surgery` - Git co-change analysis
