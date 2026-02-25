# Changelog

## [Unreleased]

### Added
- Python language support with 8 new slop detection patterns:
  - `python_bare_except` - bare except: without exception type
  - `python_eval_exec` - eval()/exec() usage
  - `python_os_system` - os.system() calls
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
