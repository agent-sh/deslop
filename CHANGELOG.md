# Changelog

## [Unreleased]

### Added
- C/C++ language support with 10 slop detection patterns:
  - C (7 patterns): `c_printf_debugging`, `c_ifdef_debug_block`, `c_placeholder_todo`, `c_pragma_warning_disable`, `c_goto_usage`, `c_hardcoded_credential_path`, `c_magic_number_cast`
  - C++ (3 patterns): `cpp_cout_debugging`, `cpp_throw_not_implemented`, `cpp_empty_catch`
- Support for C/C++ file extensions (.c, .h, .cpp, .cc, .cxx, .hpp, .hxx)
- CMakeLists.txt and meson.build as C/C++ project indicators
- cppcheck and clang-tidy CLI tool support
- 93 tests for C/C++ patterns
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
