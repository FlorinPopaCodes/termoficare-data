# Sizing ADR 0002's identity model against the published numbers

What [ADR 0002](../../adr/0002-thermal-point-identity-by-canonical-name.md) costs on every
surface this repo publishes, measured the way
[#54](https://github.com/FlorinPopaCodes/termoficare-data/issues/54) measured folding
` - Partial` alone. ADR 0002 states the decision and its evidence but deliberately not its
magnitudes; this is those magnitudes. Resolves
[#61](https://github.com/FlorinPopaCodes/termoficare-data/issues/61).

**Headline: the corrected model merges 2,454 episodes (−1.85%) and lowers the all-history
on-time rate by 0.45pp — and 96.5% of that is ` - Partial`, already measured by #54.
Everything ADR 0002 adds on top of ` - Partial` is worth 87 episodes and 0.017pp.** The
fold is worth landing on the strength of #54's numbers; the rest of the model is
correctness housekeeping that costs almost nothing to publish.

Nothing here changes the decision. Two things in ADR 0002's own prose need correcting
before it is implemented — see [Corrections](#corrections).

## How it was measured

`src/` is untouched. Each model is a rewrite table applied to the observation stream
between `foundationSnapshots` and `deriveDatasets` — the same observation→key seam ADR
0002 names — so every run is a real full re-derive of 4.5 years of history and the
comparison is between published artifacts, not between models of them.

Sector is dropped by rewriting it to the identity's canonical sector (most recent label
wins; ties to the later row in file order), which makes it a *function* of the identity.
Every key containing it therefore collapses exactly as removing it would, while
`sector_cause_slip` stays a real backoff level and the `sector` column stays populated —
which is what ADR 0002 specifies for the reported attribute.

**One modelling caveat.** Because sector is collapsed rather than deleted, `episode_id` and
`incident_id` are not the ids the landed implementation will produce (it takes sector out
of the digests at `derive.ts:412,418`), and `active_episodes.csv` sorts on the canonical
sector rather than on a shorter key. Neither affects any measured surface — no published
figure contains an id — but the ids in these outputs are not the real ones.

### Integrity

The input is pinned to the foundation CSVs at `2ef397a6c`, the last `Derive:` commit, so
the baseline run is comparable to what is actually committed. It is:

- **All 16 published artifacts re-derive byte-identical** — `on_time_rates.csv`,
  `active_episodes.csv`, and all 14 SVGs.
- The baseline prediction context reproduces the committed `on_time_probability`,
  `basis_n` and `basis_bucket` on **all 194** live outages in `current.json`.
- `snapshots` (26,679) and `usableDays` (1,657) are identical across all six runs — the
  invariant that catches a stream-wrapper bug.

A scrape landed mid-measurement and moved `HEAD`; every number below is from the re-run
against the frozen input.

### Reproducing #54

The ladder's second rung is #54's exact configuration (strip ` - Partial` only, no
folding, sector kept). It reproduces #54 to the unit or within its stated precision:
−2,367 episodes (#54: −2,368), −781 incidents, +974 bridged gaps, −0.43pp all-history,
1,055 hit→miss and 0 miss→hit (#54: 1,057 ±10, 0), 305/844 INC and 738/1,670 ACC day-cells
changed at mean −1.70 and −1.78. Unit-level differences are the one extra scrape between
#54's input and `2ef397a6c`.

## The ladder

Each rung is one full re-derive; the Δ columns are increments over the rung above.

| rung | derivation keys | identities | episodes | Δ | incidents | Δ | bridged gaps | Δ | on-time rate | Δpp |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline — `(sector, raw label)` | 1,811 | 1,732 | 132,905 | — | 134,965 | — | 10,528 | — | 38.39% | — |
| + fold ` - Partial` | 1,170 | 1,099 | 130,538 | −2,367 | 134,184 | −781 | 11,502 | +974 | 37.96% | −0.431 |
| + fold ` - Module Termice`, diacritics, casing, whitespace | 1,132 | 1,061 | 130,530 | −8 | 134,179 | −5 | 11,502 | +0 | 37.95% | −0.002 |
| + resolve pre-2022-07 shorthand | 1,108 | 1,039 | 130,507 | −23 | 134,162 | −17 | 11,505 | +3 | 37.95% | −0.007 |
| + drop sector from the key | **1,039** | **1,039** | **130,451** | −56 | **134,140** | −22 | **11,520** | +15 | **37.94%** | −0.008 |

**The ticket's expectation that dropping sector is "the largest structural change" is
right about the key space and wrong about the published numbers.** It is the largest of
the three components ADR 0002 adds — but it merges 56 episodes where ` - Partial` merges
2,367. Dropping sector reunites **64 identities** spread across **133 (sector, identity)
keys**, and those reunions mostly do *not* merge episodes: a wobbling sector label is
municipal re-labelling that moves a point from one sector to another at a point in time,
so the two halves' outages sit in disjoint periods and stay separate episodes, correctly.

## The full delta

Baseline → the decided model (canonicalization + shorthand + no sector), against the
artifacts committed at `2ef397a6c`.

### 1. Counts

| | baseline | folded | delta |
|---|---|---|---|
| episodes | 132,905 | 130,451 | **−2,454 (−1.85%)** |
| incidents | 134,965 | 134,140 | −825 (−0.61%) |
| bridged gaps | 10,528 | 11,520 | +992 (+9.42%) |
| scored estimates | 238,480 | 237,885 | −595 (−0.25%) |

### 2. On-time rate — the accountability number

All-history: **38.39% → 37.94%, −0.45pp** (91,544/238,480 → 90,249/237,885).

Per-claim, keyed `(mapped sector, mapped pt_name, utility, posted_ts, estimated_restore)`:
**1,087 flip hit → miss, 0 flip miss → hit.** 564 claims disappear (deduped into merged
histories), 1 appears, 236,765 are unchanged.

**#54's one-way finding holds under the full model**, and more strongly: #54 measured the
asymmetry at 1,057-vs-0, this at 1,087-vs-0. 64 claims sit on a natural key carrying more
than one row on one side and are not counted either way — the error bar. Read the flip
counts as accurate to roughly ±30.

### 3. On-time trend (`images/on-time-trend.svg`)

**86 of 91 monthly points move, every one downward.** 39 change the whole-percent figure
the tooltip displays. Largest move −2.66pp at 2023-10 INC (n=248, a thin month). No points
appear or disappear — no `MIN_BASIS=20` crossings.

### 4. Duration trend (`images/duration-trend.svg`)

86 points, none appear or disappear, no `DURATION_MIN_BASIS=100` crossings.

| percentile | points moving | up | down | largest absolute | median relative move |
|---|---|---|---|---|---|
| p50 | 34/86 | 34 | 0 | +4.00h (2025-08 ACC) | **+10.00%** |
| p90 | 50/86 | 50 | 0 | +8.00h (2025-10 INC) | +2.50% |
| p99 | 31/86 | 30 | 1 | +26.00h (2023-10 INC) | +2.33% |

#54's correction stands: the effect is largest in *hours* at p99 and largest in *percent*
at the median, where p50 sits at 5–13h and gains a whole hour.

### 5. Heatmaps (`images/episodes-*.svg`)

| utility | day-cells with an episode | cells changing | direction | mean Δ | max Δ |
|---|---|---|---|---|---|
| INC | 844 | **316 (37.4%)** | all down | −1.73 | −11 |
| ACC | 1,670 | **771 (46.2%)** | all down | −1.82 | −8 |

The global colour range moves on both (INC max 481 → 478, ACC 523 → 522), so the scale
itself shifts. **998 of 4,382 rendered day-cells change their published fill colour**, against 1,087
that change value — 654 change both, 433 change value inside the same colour band, and
**344 recolour without their count moving at all**, purely because the scale shifted under
them. Per-year titles all drop:

| year | INC | ACC |
|---|---|---|
| 2021 | 1,040 → 1,030 (−0.96%) | 619 → 613 (−0.97%) |
| 2022 | 9,836 → 9,699 (−1.39%) | 21,031 → 20,595 (−2.07%) |
| 2023 | 8,562 → 8,402 (−1.87%) | 20,715 → 20,298 (−2.01%) |
| 2024 | 7,406 → 7,302 (−1.40%) | 20,629 → 20,240 (−1.89%) |
| 2025 | 8,352 → 8,244 (−1.29%) | 18,125 → 17,714 (−2.27%) |
| 2026 | 5,388 → 5,314 (−1.37%) | 11,371 → 11,169 (−1.78%) |

### 6. `data/derived/on_time_rates.csv`

| level | baseline rows | folded rows | delta |
|---|---|---|---|
| `pt_cause_slip` | 18,248 | 15,719 | **−2,529** |
| `sector_cause_slip` | 144 | 144 | 0 |
| `cause_slip` | 24 | 24 | 0 |
| `slip` | 4 | 4 | 0 |

Buckets clearing `MIN_BASIS=20`: 3,613 → 3,625 (**+12**). #54's reading holds under the
full model — the basis consolidation is real in row count (−13.9% of PT-level rows) and
close to nothing in effect. Folding does not meaningfully buy back prediction specificity.
`sector_cause_slip` is unchanged in row count because the canonical sector is still one of
the same six labels.

### 7. `data/current.json`

194 live outages, all with a posted estimate. **146 change a published field**, and all
146 change the probability itself — 23 by ≥0.005, 18 by ≥0.01, 8 by ≥0.02, none by ≥0.05
(max 0.049). **60 change the displayed whole percent.** Two change `basis_bucket`:

- s4 `3 Tineretului` — `sector_cause_slip` (n=1,376, 0.394) → `pt_cause_slip` (n=20,
  0.350): **−4.4pp**, gaining a PT-level bucket it did not previously clear.
- s4 `8 Brancoveanu` — `sector_cause_slip` (n=1,376, 0.394) → `pt_cause_slip` (n=20,
  0.400): **+0.6pp**, likewise.

Under ` - Partial` alone only the first of these moves; the second is bought by the rest of
the model.

## Corrections

### 1. ADR 0002's step 1 must repeat, or 13 identities stay split

ADR 0002 says "Strip a trailing qualifier only by exact match against a closed list".
Read as a single pass, that is wrong: **13 labels carry both qualifiers stacked** —
`SC 1/2 - MODULE TERMICE - Partial`, `SC.G3 - Module Termice - Partial` and so on. One
pass strips ` - Partial` and leaves `sc 1/2 - module termice`, which never meets its base
`sc 1/2`. The corpus yields **1,074** identities that way and **1,061** — the count ADR
0002 and #55 both state — when the strip repeats until no suffix matches. Repeating is
therefore the reading the decision was actually made under; the ADR sentence needs to say
so.

### 2. The corpus does contain all four suffix spellings

#54 §8 and the note on #60 both state that the observations corpus uses only the two
spaced spellings and that the unspaced/truncated forms are a registry-only problem. It
does not. `SC 3/3 -MODULE TERMICE`, `SC 4/3 -MODULE TERMICE` and `SC.2Catelu-module`
appear in `data/observations/`, **and so do bare `SC 3/3`, `SC 4/3` and `SC.2Catelu`**.
Under ADR 0002's narrow closed list those are six identities where the registry has three.

So ADR 0002's "Applying that wider list to the observations corpus would change nothing"
is wrong on identities and right on figures. Measured (the sixth rung, `full_wide`):

- identities **1,061 → 1,058**; the three suffixed identities merge into their bare
  counterparts, which are already on the registry, so the identities absent from the
  registry drop from 130 to 127;
- published delta: **−1 episode, −1 incident, −1 scored estimate, 0.00pp on-time**.

Recommendation: widen the closed list to all four spellings. It costs one line, heals a
join that is otherwise permanently broken for three points, and moves no published figure.

### 3. The bare `N Placare` labels blend both estates — the tie-break is not clean

#55 says street-set overlap "separates all nine Placare pairs cleanly since the two
estates share no streets". The estates share no streets, but the *shorthand* labels are
blends of both, so the tie-break is a majority vote, not a separation:

| shorthand | streets | vs `MILITARI - N Placare` | vs `N Placare-T` |
|---|---|---|---|
| `2 placare` | 10 | 0.500 | 0.500 |
| `3 placare` | 5 | 0.400 | **0.500** |
| `7 placare` | 10 | 0.600 | 0.400 |
| `8 placare` | 7 | 0.714 | 0.286 |
| `9 placare` | 6 | 0.667 | 0.286 |

`2 placare` ties exactly and stays unresolved. `3 placare` resolves to **Titan**, against
the spacing rule ADR 0002 generalises from (`1Placare` Titan, `1 Placare` Militari) — the
overlap evidence and the spacing heuristic disagree on that one label. 2,041 observations
(0.09% of volume) sit on the five two-candidate labels, which is why this does not move any
figure above; it matters to #56, where a blended label points one address at two thermal
points 10–13 km apart.

### 4. Shorthand: 25 labels / 16,501 observations, not 27 / 20,805

#55 reports 27 shorthand labels over 20,805 observations. Re-running its rule — an
identity absent from the registry that some registry name contains as a substring —
against the now-committed `data/thermal_points.csv` gives **25 labels over 16,501
observations**, of which **22 resolve** (18 forced, 4 by street overlap) covering 13,591
observations. Every qualitative claim #55 makes about the set reproduces exactly: only the
bare Placare names have two candidates, `modul termic` has 84, every bare Placare label
last appeared 2022-06, and exactly 4 shorthand identities are still in use in 2026. The
identity join reproduces #55's 1,061 / 931 on-registry / 130 absent / 17 registry-only and
its 66 multi-sector identities to the unit. Only the shorthand subtotal differs, and the
difference is 4,304 observations that no reconstruction of the stated rule accounts for.
Treat 27 / 20,805 as superseded, and note the whole rung is worth 23 episodes either way.

One label is degenerate: sector 6 published an **empty `pt_name`** for 20 observations on
2026-02-03. It canonicalizes to the empty string, which every registry name contains, so
it is excluded from resolution rather than matched 948 ways.

### The shorthand resolution table

Input to [#60](https://github.com/FlorinPopaCodes/termoficare-data/issues/60) and
[#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56). Names are canonical
on both sides.

| shorthand label | obs | last seen | candidates | resolves to | how |
|---|---|---|---|---|---|
| `plavat` | 4,412 | 2025-06 | 1 | `mt plavat` | forced |
| `stirbei voda` | 3,606 | 2026-06 | 1 | `ct stirbei voda` | forced |
| `modul termic` | 2,355 | 2026-06 | 84 | **unresolved** | ambiguous |
| `spitalul militar` | 990 | 2026-07 | 1 | `spitalul militar central` | forced |
| `9 placare` | 724 | 2022-06 | 2 | `militari - 9 placare` | street overlap |
| `2 placare` | 535 | 2022-06 | 2 | **unresolved** | tie |
| `1 placare` | 531 | 2022-06 | 1 | `militari - 1 placare` | forced |
| `5 placare` | 379 | 2022-06 | 1 | `militari - 5 placare` | forced |
| `8 placare` | 325 | 2022-06 | 2 | `militari - 8 placare` | street overlap |
| `4 placare` | 307 | 2022-06 | 1 | `militari - 4 placare` | forced |
| `3 placare` | 263 | 2022-06 | 2 | `3 placare-t` | street overlap |
| `camin radet` | 260 | 2022-10 | 1 | `camin radet - apanova` | forced |
| `gradinita nr.268` | 259 | 2022-12 | 1 | `gradinita nr.268 scoala nr.128` | forced |
| `3a placare` | 230 | 2022-06 | 1 | `militari - 3a placare` | forced |
| `6 placare` | 201 | 2022-06 | 1 | `militari - 6 placare` | forced |
| `7 placare` | 194 | 2022-06 | 2 | `militari - 7 placare` | street overlap |
| `dageco` | 191 | 2026-03 | 1 | `s.c. dageco invest s.r.l.` | forced |
| `ministerul de chimie` | 190 | 2025-06 | 1 | `ministerul de chimie (inst.politehnic polizu)` | forced |
| `5a placare` | 161 | 2022-06 | 1 | `militari - 5a placare` | forced |
| `5placare` | 100 | 2022-06 | 1 | `5placare-t` | forced |
| `4placare` | 98 | 2022-06 | 1 | `4placare-t` | forced |
| `1placare` | 84 | 2022-06 | 1 | `1placare-t` | forced |
| `6placare` | 80 | 2022-06 | 1 | `6placare-t` | forced |
| *(empty label)* | 20 | 2026-02 | — | **unresolved** | degenerate |
| `modul termic - spitalul alexandru obregia ( cresa 25 )` | 6 | 2022-05 | 1 | `… / stationar de zi` | forced |

## What this hands the build effort

- **Land the fold.** The cost of not folding is a 0.45pp overstatement of CMTEB's on-time
  rate, a 1.85% overstatement of episode counts, and a 2–10% understatement of durations,
  all leaning the same way — the direction an accountability report must not lean by
  accident. Nothing measured here argues against it.
- **`identity.ts` in this folder is the canonicalization**, validated against the decision
  (1,061 identities) and against the corpus. It needs the two corrections above folded in
  before it moves to `src/`.
- **Republish everything in one step**, as ADR 0002 already requires: 998 of 4,382 heatmap
  day-cells recolour and both colour scales shift, so a partial republish leaves the images
  internally inconsistent.
- **No thresholds are near an edge.** No `MIN_BASIS` or `DURATION_MIN_BASIS` crossing in
  either trend chart, and the on-time rate CSV gains 12 usable buckets.
- **The README needs no numeric edit** — it carries image embeds, no hardcoded figures.

## Re-running

From the repo root. `WORK` holds the intermediate tables, `OUT` the per-model outputs.

```sh
export WORK=/tmp/identity-delta OUT=/tmp/identity-delta/out
mkdir -p "$WORK"
D=docs/research/identity-model-delta
deno run -A $D/census.ts                             # (sector, label) census
deno run -A $D/prepare.ts                            # streets, shorthand, canonical sector
for m in baseline partial canon canon_shorthand full full_wide; do
  TZ=UTC deno run -A $D/measure.ts $m "$OUT/$m"      # one full re-derive each, ~27s
done
TZ=UTC deno run -A $D/ladder.ts                      # the ladder table
TZ=UTC deno run -A $D/compare.ts "$OUT/baseline" "$OUT/full" full   # the surface-by-surface diff
```

`measure.ts` and `census.ts`/`prepare.ts` take the foundation directories as arguments, so
pinning to a commit is `git archive <ref> data/observations data/snapshots | tar -x -C <dir>`
and passing that dir — which is how the byte-identity check above was run.
