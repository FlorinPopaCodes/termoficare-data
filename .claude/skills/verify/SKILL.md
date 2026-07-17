---
name: verify
description: How to verify changes in this repo (the scrape → parse → derive → health pipeline). Use when running /verify or confirming a change works at runtime.
---

# Verify: termoficare-data

There is no server or UI. The repo has **three scheduled runtime surfaces**, each a
Deno script a GitHub workflow runs:

1. **Flat postprocess** (`postprocess.ts`, `flat.yml`, every ~15 min) — after each
   scrape, parses `data/termoficare.html` into observation + scrape-log rows and
   `data/current.json`, then regenerates `images/heatmap-*.svg` + `README.md`.
2. **Daily derive** (`scripts/derive.ts`, `derive.yml`) — regenerates
   `data/derived/{incidents,estimates,causes,episodes,episode_incidents}` wholesale
   from the foundation CSVs.
3. **Health cron** (`scripts/health.ts`, `health.yml`, every 15 min) — collects
   cadence facts (workflow runs, scrape log, git), evaluates alert conditions,
   opens/closes `scrape-health` issues, and writes the `data/health.json` badge.

Cheap whole-repo gates, in order of cost:

```bash
deno task check    # type-checks src/, all three surfaces, and the backfill script
deno task test     # unit tests (needs --allow-read, pinned in deno.json)
```

**Out of verify's scope:** `scripts/backfill.ts` (full-history regeneration of the
foundation CSVs) and `scripts/import-history.sh` (one-off import of a downloaded
archive into git history) are historical tools, run deliberately and rarely — not
part of verifying a change.

## Surface 1: Flat postprocess

```bash
deno run -A postprocess.ts    # parses the snapshot + regenerates images/*.svg + README.md
```

**On a clean tree this is a no-op** — it prints `Snapshot unchanged — skipping all
writes` and exits, because writes are gated on `data/termoficare.html` differing from
git's index (an unchanged snapshot must not commit, or the heatmap would count its own
previous commit forever). When the snapshot *has* changed, it appends observation and
scrape-log rows timestamped with the current wall clock, rewrites `data/current.json`,
reads `git log` (authors `flat-data` / `Archive Bot`, paths under `data/`) for
commit-per-day counts, and regenerates **every** year's SVG plus `README.md` (past
years are not frozen — backfills can add commits with historical dates).

After any driven run, restore the tree:

```bash
git checkout -- data/ README.md images/
```

### Verifying a refactor is behavior-preserving (byte-identity)

The strongest check is a before/after from the **same git state**. Run the current
tree, then run the base version, and diff the outputs:

```bash
tmp=$(mktemp -d)
deno run -A postprocess.ts          # AFTER (current working tree)
cp README.md "$tmp/README.after"; cp -r images "$tmp/images.after"
git checkout -- data/ README.md images/

git worktree add "$tmp/base" main   # BASE — see caveat below
(cd "$tmp/base" && deno run -A postprocess.ts)
cp "$tmp/base/README.md" "$tmp/README.before"; cp -r "$tmp/base/images" "$tmp/images.before"
git worktree remove --force "$tmp/base"

diff "$tmp/README.before" "$tmp/README.after"      # must be identical
diff -r "$tmp/images.before" "$tmp/images.after"   # must be identical
```

**Caveat — `postprocess.ts` is not self-contained.** It imports `./src/*.ts`, so
`git show <ref>:postprocess.ts` into a temp file won't resolve its imports; run the
base ref in a `git worktree` as above. (Only refs from before the parser refactor
were single-file.) The worktree run sees the same `git log` but its *own* clean
snapshot — to drive the parse path on both sides, make the same snapshot edit in both
checkouts.

**Keep TZ constant across both runs.** `generateSVG` output depends on the ambient
timezone (see the heatmap module header); a single shell already holds TZ fixed, so
before/after stay comparable. Production (the Flat workflow) runs under UTC.

### Gotcha: current-year SVG "differs from committed" is NOT a regression

`images/heatmap-<currentYear>.svg` will differ from the committed copy every time you
run, because the live `git log` has more commits than when the file was last committed
(the scraper commits every 15 min). Prior-year SVGs are regenerated too but should
come out identical. Compare refactored-vs-original from the *same git state* (above) —
don't compare against the committed bytes and don't flag the current-year delta as a bug.

## Surface 2: daily derive

```bash
deno task derive    # ~25s for the full history; streams one month at a time
```

Completing without throwing is itself a meaningful check: the foundation alignment
step throws on any scrape-log/observations mismatch (a scrape-log month with no
observations file, a log row claiming more observation rows than the file holds,
mismatched timestamps, leftover rows the log never claimed).

### Gotcha: dirty `data/derived/` after a run is NOT a regression

Mirror of the current-year-SVG gotcha: the foundation CSVs almost always have newer
rows than the last derive commit (the scraper commits every 15 min), so recent-month
derived files differ from the committed copies on every run. Expected — don't flag it.

The real regression check is **determinism**: two runs from the same foundation state
must be byte-identical.

```bash
tmp=$(mktemp -d)
deno task derive
cp -r data/derived "$tmp/derived.run1"
deno task derive
diff -r "$tmp/derived.run1" data/derived    # must be identical
```

(For a derive refactor, the same shape gives before/after: snapshot the current tree's
output, run the base ref in a worktree on the same foundation state, diff.)

Always end with the cleanup step so the tree is clean again:

```bash
git checkout -- data/derived
```

## Surface 3: health cron

```bash
deno task health --dry-run    # the ONLY form used for verification
```

Exercises the full collect → evaluate → plan → badge pipeline against the live
`gh api` while mutating nothing: prints `Facts` (JSON — includes the entire trailing
two months of scrape-log rows, so it's long), `Active conditions`, `Issue plan`, and
`Badge`, then stops with `--dry-run: no writes, no gh mutations`. Afterwards
`git status` must still be clean (no `data/health.json` write) and no `scrape-health`
issue changed.

Needs an authenticated `gh`. And `now` is the wall clock, so a stale local checkout
(foundation CSVs hours behind origin) can show conditions active — e.g. 1h silence —
that are not active in CI. Pull latest `main` data before reading the plan literally.

**⚠️ Never run `deno task health` without `--dry-run` as a verification step.** The
bare form is the production action: it opens/closes real GitHub issues (label
`scrape-health`) and writes `data/health.json`, the live badge endpoint.
