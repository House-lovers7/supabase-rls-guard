# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report them privately via
[GitHub's private vulnerability reporting](https://github.com/House-lovers7/supabase-rls-guard/security/advisories/new).
We aim to acknowledge reports within 72 hours and to provide a remediation
timeline after triage.

## Scope

`supabase-rls-guard` is a static analysis tool that reads local SQL files. It:

- does **not** connect to any database,
- does **not** require or read Supabase credentials,
- does **not** transmit your migrations anywhere.

The most relevant security concerns for this project are therefore:

- **False negatives** — a dangerous pattern the linter fails to flag. These are
  treated as high-priority bugs, since users rely on the tool as a guardrail.
- **Supply-chain integrity** — releases are published to npm with
  [provenance attestations](https://docs.npmjs.com/generating-provenance-statements)
  via GitHub Actions Trusted Publishing (OIDC).

If you find a class of insecure migration that the tool should catch but does
not, please report it — to us a missed detection is a security issue, not just a
feature request.

## Supported versions

The latest published `0.x` release is supported. Pre-1.0, breaking changes may
occur in minor versions; see the [CHANGELOG](./CHANGELOG.md).
