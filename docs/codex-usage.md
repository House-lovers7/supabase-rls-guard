# Using Supabase RLS Guard with OpenAI Codex

When an AI agent like Codex writes Supabase migrations, RLS mistakes are easy to
introduce and easy to miss in review. This tool is designed to be a guardrail in
that loop.

## As an agent guardrail

Give Codex (or any agent) a hard checkpoint after it edits migrations:

```bash
npx supabase-rls-guard ./supabase/migrations --format json
```

The JSON output is structured for programmatic consumption:

```json
{
  "summary": { "critical": 2, "warning": 1, "info": 0, "total": 3, "failed": true },
  "findings": [
    {
      "ruleId": "RLS001",
      "ruleName": "rls_disabled_in_public",
      "severity": "critical",
      "target": "public.users",
      "message": "Table public.users is in an API-exposed schema but RLS is not enabled …",
      "fix": "ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;",
      "loc": { "file": "supabase/migrations/001_users.sql", "line": 1, "column": 1, "offset": 0 }
    }
  ]
}
```

Each finding carries a concrete `fix`, so an agent can read the findings and
self-correct before handing the change back to a human.

## Suggested AGENTS.md snippet for your own repo

```md
## Supabase migrations

After creating or editing any file under `supabase/migrations/`, run:

    npx supabase-rls-guard ./supabase/migrations

Fix every Critical finding before considering the task complete. Each finding
includes the exact SQL fix. Do not disable a rule to make the check pass unless a
human has explicitly approved it.
```

## In CI on agent-authored PRs

Because the tool needs no database and no secrets, it runs safely on PRs from
forks and from automated agents. See [ci-integration.md](./ci-integration.md).
