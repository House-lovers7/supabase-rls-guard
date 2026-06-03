# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (with the
caveat that, pre-1.0, minor versions may include breaking changes).

## [Unreleased]

## [0.2.0]

### Added

- **RLS015** (`auth_users_exposed`, Splinter 0002): flags a view in an exposed
  schema that selects from `auth.users` (leaks user PII).
- **RLS016** (`rls_uses_auth_role`, Info): suggests the native `TO <role>` clause
  over gating on `auth.role()` inside a policy predicate.
- **RLS017** (`multiple_permissive_policies`, Splinter 0006): flags two or more
  permissive policies that overlap on the same role and command.
- **RLS005** now also detects schema-wide grants
  (`GRANT … ON ALL TABLES IN SCHEMA … TO anon`), which apply to every table in
  the schema, including those created in later migrations.
- **`ALTER POLICY`** is now modeled: loosening a secure policy (e.g. to
  `USING (true)`) in a later migration is detected.
- **`REVOKE`** is now applied when folding, so a granted-then-revoked privilege
  no longer false-positives `RLS005` (conservative: a grant is cleared only when
  the revoke fully covers it).
- **`ALTER TABLE … ADD COLUMN`** is now folded into the table's columns, so a
  sensitive column added in a later migration is seen by `RLS004`.
- `docs/known-limitations.md` and per-rule false-positive/suppression notes.

### Changed

- **RLS006**: no longer flags an `INSERT` policy with `WITH CHECK (true)` (the
  standard "anyone can submit" form); only read/affect always-true predicates fire.
- **RLS013**: corrected to match PostgreSQL semantics — when `WITH CHECK` is
  omitted, `USING` is reused as the new-row check, so this is usually safe.
  Re-leveled from Warning to Info with accurate wording.
- README now leads as a "static pre-deploy linter" with an explicit
  "guardrail, not a guarantee" scope note, a bad → detected → fixed example, and
  a copy-paste CI workflow.

### Fixed

- `skipLeadingTrivia` no longer returns an offset past the end on an unterminated
  block comment.
- `pnpm selfscan` script now points at the real build output (`dist/cli.mjs`).

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

[Unreleased]: https://github.com/House-lovers7/supabase-rls-guard/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/House-lovers7/supabase-rls-guard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/House-lovers7/supabase-rls-guard/releases/tag/v0.1.0
