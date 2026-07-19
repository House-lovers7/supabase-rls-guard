# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (with the
caveat that, pre-1.0, minor versions may include breaking changes).

## [Unreleased]

### Added

- **`examples/README.md`**: every bundled migration (11 unsafe + 3 safe) mapped
  to what it demonstrates and the findings expected against the final folded
  state; engineering docs gained a hand-verified public-interface inventory
  (CLI + library entrypoints) and an executable npm rollback procedure,
  closing all three P1 handoff gaps.
- **RLS spot-audit service docs** (`docs/service/`): offer, order/intake and
  report templates, a synthetic sample report (from `examples/unsafe-project`),
  an operator runbook with a bounded lifecycle (recheck ≤30 days, customer-data
  deletion ≤37 days after first delivery), and ADR-0001 fixing the boundary
  that customer material never enters the public repo. Consistency (single
  offer, price cap, disclaimers, no overstated claims) is pinned by
  `tests/service-docs.test.ts`.

### Changed

- **`--strict` now rejects incomplete scans with exit 2.** Operational scan
  warnings (parser fallback to the regex backend, skipped unreadable entries,
  invalid config fields) mean the analysis covered less than requested; under
  `--strict` they are now a tool error (exit 2), kept distinct from
  finding-based failures (exit 1). The rendered partial result stays on stdout
  for review.
- **The text reporter no longer renders an incomplete scan as a clean pass.**
  With zero findings but pending scan warnings it prints a yellow `⚠ … scan
  warning(s) prevent a clean pass` line instead of the green `✔`, and appends a
  `scan incomplete` suffix to finding summaries.
- **Supply-chain hardening of CI and release**: dependency audit
  (`pnpm audit --audit-level high`) and package validation (publint + attw) now
  gate both CI and the release workflow; PRs touching dependencies run a pinned
  `dependency-review` action; pnpm bumped to 11.x.

## [0.2.0] - 2026-07-12

First published release (v0.2.0 was versioned but never tagged or published;
this release folds the audit batch below into it).

Audit batch: 17 bugs found by a multi-agent audit (with adversarial verification
of every finding) were fixed — see issues #18–#34.

### Fixed — correctness of findings

- **Regex backend no longer misparses `ALTER POLICY … RENAME TO`** as a roles
  change, which silently downgraded an always-true-policy Critical and flipped
  the CI exit code (#18).
- **libpg byte offsets are converted to string indexes**, so line numbers are
  correct after multibyte text (e.g. Japanese comments) and inline suppressions
  target the right lines (#20).
- **GRANT/REVOKE semantic fidelity** (#21, #24, #25):
  - schema-wide grants expand to the tables existing at execution time (no more
    false positives on tables created later);
  - `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES` is modeled and applies to
    tables created afterwards (was a false negative);
  - REVOKE now cancels grants across levels (table-level vs `ON ALL TABLES IN
    SCHEMA`), fixing permanent RLS005 false positives on the canonical
    `REVOKE ALL … FROM anon` lockdown pattern;
  - `REVOKE GRANT OPTION FOR` no longer clears the underlying grant;
  - `GRANT … TO PUBLIC` is treated as reaching anon.
- **`DROP VIEW` / `DROP FUNCTION` are folded**, so deleted objects stop firing
  RLS010/RLS015/RLS011 (#22).
- **RLS017 expands `TO public`** to every concrete role, catching the common
  legacy-TO-less + role-scoped overlap (#23).
- **Regex backend auth-fn detection** uses identifier boundaries and
  subquery-scope tracking (no more `my_auth.role_check` false positives or
  closed-subquery false negatives) (#26).
- **Regex backend `ADD COLUMN`** handles comma-separated multi-ADD and the
  `COLUMN`-keyword-less form (#27).

### Fixed — CLI & pipeline

- **Piped output is no longer truncated at 64 KiB**: every exit waits for stdout
  to flush (#19).
- **`discover()` no longer aborts the scan** on a directory named `*.sql` or a
  broken symlink — such entries are skipped with a warning (#28); directory
  symlinks are not followed and files are de-duplicated by realpath (#31).
- **`--strict` only ever lowers the gate** — it no longer weakens a config that
  sets `failOn: "info"` (#29).
- **Migration ordering is deterministic codepoint order** (matching migration
  runners), not locale-dependent collation (#30).
- **Invalid `--format`/`--backend`/`--fail-on` values exit 2** (documented
  tool-error code), not 1 (#32).
- **Out-of-cwd scans emit scan-root-relative paths** instead of `..`-prefixed
  ones that GitHub cannot map (#33).
- **Zero `.sql` files scanned now exits 2** (fail-closed) unless `--allow-empty`
  is passed; the warning is no longer suppressed by `--quiet` (#34).
- `loadConfig` no longer crashes when a search start directory is supplied
  (cosmiconfig `stopDir` misuse).

### Fixed — allowlist scoping

- **Unqualified `publicTables` entries no longer match same-named tables in
  other schemas.** An entry like `"blog_posts"` now only allowlists
  `public.blog_posts`; it no longer silently suppresses findings for
  `private.blog_posts`, `admin.blog_posts`, etc. Schema-qualified entries
  (e.g. `"public.blog_posts"`) are unaffected.

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
