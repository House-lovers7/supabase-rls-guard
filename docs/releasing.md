# Releasing

How a version of `supabase-rls-guard` reaches npm. The publish pipeline is
`.github/workflows/release.yml`, triggered by **publishing a GitHub Release**;
it re-runs every gate (audit → typecheck → lint → build → test →
validate:package) before `npm publish`.

## One-time bootstrap (status 2026-07-20: NOT done yet)

The package does not exist on the registry yet (`npm view supabase-rls-guard`
→ 404, re-checked 2026-07-20). The version that bootstraps it is **0.3.0** —
0.1.0 and 0.2.0 were tagged in git but never published. npm Trusted Publishing **cannot create a brand-new package** — the
trusted-publisher settings only exist for a published package
([npm docs](https://docs.npmjs.com/trusted-publishers/),
[npm/cli#8544](https://github.com/npm/cli/issues/8544)). So the first release
is manual, once:

1. **First publish (local, human-run)** — from a clean checkout of the release
   commit, logged in as the package owner:

   ```sh
   pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm validate:package
   npm publish --access public
   ```

2. **Configure the trusted publisher** — npmjs.com → package
   `supabase-rls-guard` → Settings → Trusted publishing → GitHub Actions:

   | Field | Value |
   | --- | --- |
   | Organization or user | `House-lovers7` |
   | Repository | `supabase-rls-guard` |
   | Workflow filename | `release.yml` |
   | Environment name | (leave empty — no GitHub environment is used) |

   Only one trusted publisher can be configured per package.

3. **Tighten publishing access (recommended)** — after one OIDC release
   succeeds, set the package's publishing access to *require two-factor
   authentication or an automation/granular token is no longer needed*; revoke
   any token created for step 1.

## Normal release (after bootstrap)

1. Bump `version` in `package.json`, move the `[Unreleased]` CHANGELOG section
   under the new version, land it on `main` via PR.
2. Create and **publish a GitHub Release** with tag `vX.Y.Z` on that commit.
3. `release.yml` runs all gates and `npm publish` authenticates via OIDC — no
   `NPM_TOKEN` secret. Provenance attestations are generated automatically
   (public repo + public package).

Requirements already satisfied by the workflow (verified 2026-07-19 against
the official docs): `permissions: id-token: write`, npm CLI ≥ 11.5.1 (bundled
with Node 24), GitHub-hosted runner (self-hosted is unsupported), workflow is
not reusable/called-from-elsewhere.

## Rollback

See "Rollback手順" in
[docs/engineering/05_nfr_slo.md](./engineering/05_nfr_slo.md): guide users to
pin the previous version, `npm deprecate` the bad version (do not assume
unpublish), revert and ship a patch release through this same pipeline.
