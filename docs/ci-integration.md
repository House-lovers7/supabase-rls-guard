# CI integration

`supabase-rls-guard` exits non-zero when it finds problems at or above the
`failOn` threshold (Critical by default), so it slots into any CI as a gate.

## GitHub Actions (annotations on the PR)

```yaml
name: rls-guard
on:
  pull_request:
    paths: ['supabase/migrations/**.sql']

jobs:
  rls-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx supabase-rls-guard ./supabase/migrations --format github
```

`--format github` emits workflow commands (`::error file=…,line=…::`) that show
up as inline annotations on the changed lines.

## GitHub Code Scanning (SARIF alerts)

Upload SARIF to get findings in the **Security → Code scanning** tab, with stable
fingerprints across runs:

```yaml
name: rls-guard-sarif
on:
  push:
    branches: [main]
  pull_request:
    paths: ['supabase/migrations/**.sql']

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Don't fail the job here — let Code Scanning surface the alerts.
      - run: npx supabase-rls-guard ./supabase/migrations --format sarif > rls.sarif || true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: rls.sarif
          category: supabase-rls-guard
```

## pre-commit hook

Add a hook so mistakes are caught before they're even committed. With
[pre-commit](https://pre-commit.com), in `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: supabase-rls-guard
        name: Supabase RLS Guard
        entry: npx supabase-rls-guard ./supabase/migrations
        language: system
        files: 'supabase/migrations/.*\.sql$'
        pass_filenames: false
```

Or a plain Husky / `package.json` script:

```jsonc
{
  "scripts": {
    "rls:check": "supabase-rls-guard ./supabase/migrations"
  }
}
```

## GitLab CI

```yaml
rls-guard:
  image: node:22
  rules:
    - changes: ['supabase/migrations/**/*.sql']
  script:
    - npx supabase-rls-guard ./supabase/migrations
```

## Tuning the gate

- `--strict` — also fail on warnings, and reject incomplete scans (parser
  fallback, skipped unreadable files, invalid config fields) with exit 2 so a
  partial analysis can never pass as green.
- `--fail-on warning` — set the exact threshold.
- Commit a `.rlsguardrc.json` to share config (`publicTables`, disabled rules,
  severities) across the team and local runs.
