---
name: verify
description: How to verify changes in this repo (the scrape → parse → derive → health pipeline). Use when running /verify or confirming a change works at runtime.
---

# Verify: termoficare-data

There is no server or UI. The repo has **three scheduled runtime surfaces**, each a
Deno script a GitHub workflow runs:

1. **Flat postprocess** (`postprocess.ts`, `flat.yml`) — after each scrape, parses
   `data/termoficare.html` into observation + scrape-log rows and
   `data/current.json`, then regenerates `README.md`.
2. **Daily derive** (`scripts/derive.ts`, `derive.yml`) — regenerates
   `data/derived/{incidents,estimates,causes,episodes,episode_incidents}` wholesale
   from the foundation CSVs.
3. **Health cron** (`scripts/health.ts`, `health.yml`) — collects cadence facts
   (workflow runs, scrape log, git), evaluates alert conditions, opens/closes
   `scrape-health` issues, and writes the `data/health.json` badge.

`flat.yml` and `health.yml` both request a `*/15 * * * *` cron, but GitHub throttles
scheduled runs to roughly hourly in practice (median gap 76 min — see `health.yml`'s
header comment and `docs/research/2026-07-17-external-scheduler-for-15min-cron.md`).

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
deno run -A postprocess.ts    # parses the snapshot + regenerates README.md
```

**On a clean tree this is a no-op** — it prints `Snapshot unchanged — skipping all
writes` and exits, because writes are gated on `data/termoficare.html` differing from
git's index (an unchanged snapshot must not commit — it would append duplicate
observation rows and produce noise commits). When the snapshot *has* changed, it
appends observation and scrape-log rows timestamped with the current wall clock,
rewrites `data/current.json`, and regenerates `README.md` from the `images/` listing.

After any driven run, restore the tree:

```bash
git checkout -- data/ README.md
```

### Verifying a refactor is behavior-preserving (byte-identity)

The strongest check is a before/after from the **same git state**. Run the current
tree, then run the base version, and diff the outputs:

```bash
tmp=$(mktemp -d)
deno run -A postprocess.ts          # AFTER (current working tree)
cp README.md "$tmp/README.after"
git checkout -- data/ README.md

git worktree add "$tmp/base" main   # BASE — see caveat below
(cd "$tmp/base" && deno run -A postprocess.ts)
cp "$tmp/base/README.md" "$tmp/README.before"
git worktree remove --force "$tmp/base"

diff "$tmp/README.before" "$tmp/README.after"      # must be identical
```

**Caveat — `postprocess.ts` is not self-contained.** It imports `./src/*.ts`, so
`git show <ref>:postprocess.ts` into a temp file won't resolve its imports; run the
base ref in a `git worktree` as above. (Only refs from before the parser refactor
were single-file.) The worktree run sees its *own* clean snapshot — to drive the
parse path on both sides, make the same snapshot edit in both checkouts.

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
