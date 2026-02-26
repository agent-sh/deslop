# Changelog

## [Unreleased]

### Added
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
