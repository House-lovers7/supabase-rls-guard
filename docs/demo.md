# Recording the demo

A short terminal clip is the fastest way to show what the tool does. Everything
below uses the **bundled examples**, so no Supabase project is needed.

> Until the package is on npm, use `node dist/cli.mjs …` (after `pnpm build`).
> Once published, swap in `npx supabase-rls-guard …`.

## The three shots that tell the story

1. **Terminal** — the colored findings on the unsafe example (and the non-zero exit).
2. **Pull request** — a red `rls-guard` check with inline annotations (`--format github`).
3. **Security tab** — the SARIF results under GitHub → Security → Code scanning (`--format sarif`).

Put the GIF/screenshot near the top of the README.

## Option A — animated GIF with [vhs](https://github.com/charmbracelet/vhs) (deterministic)

Install vhs, then save this as `demo.tape` and run `vhs demo.tape` → `demo.gif`:

```tape
Output demo.gif
Set FontSize 18
Set Width 1200
Set Height 700
Set Theme "Dracula"

Type "# 1. A migration that forgets RLS on a table with a token column"
Enter
Type "node dist/cli.mjs examples/unsafe-project/supabase/migrations | head -20"
Enter
Sleep 4s

Type "# 2. The safe example passes (exit 0)"
Enter
Type "node dist/cli.mjs examples/safe-project/supabase/migrations"
Enter
Sleep 3s
```

## Option B — quick screenshots

```bash
git clone https://github.com/House-lovers7/supabase-rls-guard
cd supabase-rls-guard
pnpm install && pnpm build

# findings + non-zero exit
node dist/cli.mjs examples/unsafe-project/supabase/migrations

# clean + zero exit
node dist/cli.mjs examples/safe-project/supabase/migrations

# what CI sees (GitHub annotations)
node dist/cli.mjs examples/unsafe-project/supabase/migrations --format github
```

## Option C — asciinema (web-embeddable)

```bash
asciinema rec demo.cast
# run the commands above, then Ctrl-D
agg demo.cast demo.gif   # convert to GIF with https://github.com/asciinema/agg
```
