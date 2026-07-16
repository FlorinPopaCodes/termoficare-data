---
name: verify
description: How to verify changes in this repo (the Flat Data postprocess pipeline). Use when running /verify or confirming a change works at runtime.
---

# Verify: termoficare-data

The only runtime surface is the **Flat postprocess entrypoint** — a Deno script the
GitHub Action runs after each scrape. There is no server or UI.

## Build / launch / drive

```bash
deno run -A postprocess.ts    # the surface — regenerates images/*.svg + README.md
deno task test                # unit tests (needs --allow-read, pinned in deno.json)
```

Running it reads `git log` (author `flat-data` / `Archive Bot`) for commit-per-day
counts, then writes `images/heatmap-<year>.svg` and `README.md`. Older years are
frozen once their SVG exists; the **current year is always regenerated**.

## Verifying a refactor is behavior-preserving (byte-identity)

The strongest check is a before/after from the **same git state**. Run the current
tree, then run the base version, and diff the outputs:

```bash
tmp=$(mktemp -d)
deno run -A postprocess.ts          # AFTER (current working tree)
cp README.md "$tmp/README.after"; cp -r images "$tmp/images.after"
git checkout -- README.md images/

base=$(git show main:postprocess.ts)   # BASE — see caveat below
echo "$base" > "$tmp/base.ts"
deno run -A "$tmp/base.ts"          # BEFORE
cp README.md "$tmp/README.before"; cp -r images "$tmp/images.before"
git checkout -- README.md images/

diff "$tmp/README.before" "$tmp/README.after"      # must be identical
diff -r "$tmp/images.before" "$tmp/images.after"   # must be identical
```

Always `git checkout -- README.md images/` after each run so the working tree stays clean.

**Caveat — the base script must be self-contained.** `git show <ref>:postprocess.ts`
into a temp file only runs if that ref's `postprocess.ts` has no relative imports.
That holds for `main` and any *pre-*refactor ref. For a ref **after** this refactor,
`postprocess.ts` imports `./src/*.ts`, which won't resolve from a temp dir — check that
ref out in a `git worktree` and run it in place instead.

**Keep TZ constant across both runs.** `generateSVG` output depends on the ambient
timezone (see the heatmap module header); a single shell already holds TZ fixed, so
before/after stay comparable. Production (the Flat workflow) runs under UTC.

## Gotcha: current-year SVG "differs from committed" is NOT a regression

`images/heatmap-<currentYear>.svg` will differ from the committed copy every time you
run, because the live `git log` has more commits than when the file was last committed
(the scraper commits every 15 min). Prior-year SVGs are frozen and must match. Compare
refactored-vs-original from the *same git state* (above) — don't compare against the
committed bytes and don't flag the current-year delta as a bug.
