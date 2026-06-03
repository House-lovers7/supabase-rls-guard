# Using Supabase RLS Guard with Claude Code

[Claude Code](https://claude.com/claude-code) can run `supabase-rls-guard` as a
verification step whenever it touches your migrations.

## Run it manually

```bash
npx supabase-rls-guard ./supabase/migrations
```

## Make it automatic with a hook

Add a `PostToolUse` hook so the linter runs every time a migration file is
written. In `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "case \"$CLAUDE_FILE_PATHS\" in *supabase/migrations/*.sql*) npx supabase-rls-guard ./supabase/migrations --no-color || true ;; esac"
          }
        ]
      }
    ]
  }
}
```

Claude will see the findings in the hook output and can fix them in the same
turn.

## Put the policy in CLAUDE.md

```md
## Supabase

Whenever you add or change SQL under `supabase/migrations/`, run
`npx supabase-rls-guard ./supabase/migrations` and resolve every Critical
finding before finishing. Each finding includes the exact `ALTER TABLE …`/policy
fix to apply.
```

## Library use inside a custom tool

```ts
import { scan } from 'supabase-rls-guard'

const { findings, summary } = await scan({ path: 'supabase/migrations' })
if (summary.failed) {
  // surface findings back to the agent / fail the step
}
```
