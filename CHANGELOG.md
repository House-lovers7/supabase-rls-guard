# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (with the
caveat that, pre-1.0, minor versions may include breaking changes).

## [Unreleased]

## [0.1.0]

Initial release.

### Added

- Static scanner for Supabase migration SQL with **no database connection
  required**.
- Cumulative, timestamp-ordered migration folding into a single final schema
  state — RLS enabled in a later migration does not produce false positives.
- Hybrid SQL parser: `libpg-query` (the real PostgreSQL grammar via WASM) with a
  resilient regex fallback.
- 13 rules (`RLS001`–`RLS018`), aligned with Supabase's Splinter lint catalog
  where they overlap. See [docs/rules.md](./docs/rules.md).
- Output formats: human-readable text, JSON, GitHub Actions annotations, and
  SARIF 2.1.0 for GitHub Code Scanning.
- Config via cosmiconfig (`.rlsguardrc`, `package.json#rlsguard`, …) with runtime
  validation, plus inline `-- rls-guard-disable-*` suppression comments and a
  `publicTables` allowlist.
- CLI (`supabase-rls-guard` / `rlsguard`) with severity-based exit codes for CI
  gating, and an importable library API (`scan`).
- GitHub Actions workflows for CI, self-scan (SARIF upload), and Trusted
  Publishing releases; examples, and full docs.

[Unreleased]: https://github.com/House-lovers7/supabase-rls-guard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/House-lovers7/supabase-rls-guard/releases/tag/v0.1.0
