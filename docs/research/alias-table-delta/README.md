# Sizing ADR 0002's alias table against the published numbers

What step 4 of [ADR 0002](../../adr/0002-thermal-point-identity-by-canonical-name.md) costs
on every surface this repo publishes, measured the way
[#61](https://github.com/FlorinPopaCodes/termoficare-data/issues/61) measured steps 1–3.
The ADR states step 4's decision and its evidence but records its magnitude as "not yet
measured"; this is that magnitude. Resolves
[#72](https://github.com/FlorinPopaCodes/termoficare-data/issues/72).

**Headline: step 4 costs 2 episodes and 0.005pp — and it is the first component of the
identity model that does not move every surface one way.** Its twenty label-keyed rows
merge, and are worth −23 episodes; its five `(label, street)` rows *divide* one ambiguous
label between two thermal points, and are worth +21. The two nearly cancel. On the
accountability number the same split shows as **11 claims flipping hit→miss and 5 flipping
miss→hit** — the first miss→hit flips any fold in this repo has produced.

Nothing here changes the decision. Step 4 is worth landing on the strength of the
addressing result it was decided for (97.78% resolution against 94.36% without it); its
cost on the published figures rounds to nothing.

## How it was measured

`src/` is untouched. Each model is a rewrite applied to the observation stream between
`foundationSnapshots` and `deriveDatasets` — the same observation→key seam ADR 0002 names —
so every run is a real full re-derive of 4.5 years of history and the comparison is between
published artifacts, not between models of them.

The input is pinned to the foundation CSVs at `2ef397a6c`, the last `Derive:` commit, which
is the same commit #61 pinned to. Every figure here is therefore directly comparable to
that report's.

Sector is dropped exactly as #61 dropped it: rewritten to the identity's canonical sector
(most recent label wins), which makes it a *function* of the identity, so every key
containing it collapses as removing it would while `sector_cause_slip` stays a real backoff
level and the `sector` column stays populated. The same modelling caveat carries over —
`episode_id` and `incident_id` are not the ids the landed implementation will produce, and
no measured surface contains an id.

**One thing this measurement needs that the derivation cannot give it.** Step 4's five
street-keyed rows read `zone_raw`, and `foundationSnapshots` drops `zone_raw` at the seam
before any model sees it (`derive.ts:75`). So `prepare.ts` resolves those rows in a
separate pass over the observation archive and hands the seam a lookup on
`(snapshot_ts, sector, label)`. That lookup is the one fragile joint in the harness: if the
consumer misses it, every blended label quietly falls through to itself and the run still
produces a complete, plausible set of numbers for a fold that never happened. `verify.ts`
gate 8 reads the *folded run's own output* and asserts no alias key survives as an
identity, which is the check that catches it. **The landed implementation has the same
exposure** — it will read `zone_raw` at the same seam — and deserves the same assertion.

### Gates

`verify.ts`, all passing:

- **All 16 published artifacts re-derive byte-identical** under the unchanged model —
  `on_time_rates.csv`, `active_episodes.csv`, and all 14 SVGs.
- The baseline prediction context reproduces the committed `on_time_probability`, `basis_n`
  and `basis_bucket` on **all 194** live outages in `current.json`. (The right file is the
  first scrape *after* the derive commit: `current.json` committed *at* `2ef397a6c` was
  written by the scrape before it and reproduces only 189 of 193.)
- `snapshots` (26,679) and `usableDays` (1,657) are identical across all four runs.
- The three properties ADR 0002 asserts about step 4 hold on the table as shipped here: no
  alias target is itself an alias key (so it is one lookup, not a fixpoint), it changes
  **none** of the 951 registry names, and all 30 targets are registry names.
- All **2,041** street-scoped observations resolve, with no snapshot resolving one label two
  ways, and **no alias key survives the folded run as an identity**.

The census reproduces every count in ADR 0002 exactly: **1,731** non-empty corpus labels,
**1,057** identities after steps 1–3 and **1,032** after step 4, **126 → 101** identities
absent from the registry, 17 registry names never published as down.

## The ladder

Each rung is one full re-derive; the Δ columns are increments over the rung above.

| rung | identities | episodes | Δ | incidents | Δ | bridged gaps | Δ | on-time rate | Δpp |
|---|---|---|---|---|---|---|---|---|---|
| baseline — `(sector, raw label)` | 1,732 | 132,905 | — | 134,965 | — | 10,528 | — | 38.39% | — |
| + ADR 0002 steps 1–3, sector dropped | 1,058 | 130,474 | −2,431 | 134,157 | −808 | 11,517 | +989 | 37.95% | −0.441 |
| + drop the empty `pt_name` | 1,057 | 130,473 | −1 | 134,156 | −1 | 11,517 | +0 | 37.94% | −0.000 |
| + step 4, the alias table | **1,032** | **130,471** | **−2** | **134,145** | **−11** | **11,514** | **−3** | **37.94%** | **−0.005** |

Read against #61: the whole decided model is now **−2,434 episodes (−1.83%)** and
**−0.446pp** from baseline, against the −2,454 and −0.45pp that report measured. The decided
model therefore ends **20 episodes above** the one #61 modelled. The wider suffix list and
the empty-row rule take one each; the remaining 22 are the alias table declining merges that
*registry containment at derivation time* — the mechanism ADR 0002 went on to reject — made
by sending each of the five blended labels wholesale to a single estate.

## Step 4's own delta

`steps123` → `full`, the increment the ticket asks for.

### 1. Counts

| | before | after | delta |
|---|---|---|---|
| episodes | 130,473 | 130,471 | **−2 (−0.002%)** |
| incidents | 134,156 | 134,145 | −11 (−0.008%) |
| bridged gaps | 11,517 | 11,514 | −3 (−0.026%) |
| scored estimates | 237,903 | 237,890 | −13 (−0.005%) |

### 2. On-time rate — the accountability number

All-history: **37.94% → 37.94%, −0.005pp** (90,272/237,903 → 90,256/237,890).

Per-claim: **11 flip hit → miss, 5 flip miss → hit**, 237,866 unchanged, 20 disappear into
merged histories, 8 appear. One claim sits on a key carrying more than one candidate row and
is not counted either way — the error bar.

**The five miss→hit flips are the finding.** Every fold measured before this one was
strictly one-directional: #54 found 1,057 hit→miss and 0 back, #61 found 1,087 and 0, and
this report's own baseline→full total is 1,092 and 1. Step 4 is the exception, and the
split is clean along the table's two halves:

| | hit → miss | miss → hit |
|---|---|---|
| label-keyed rows (merges) | 11 — `ct stirbei voda` 6, `spitalul militar central` 3, `militari - 6 placare` 1, `mt plavat` 1 | 0 |
| `(label, street)` rows (splits) | 0 | 5 — `9 placare-t` 3, `militari - 9 placare` 1, `3 placare-t` 1 |

Merging two histories lengthens the episode a claim is scored against, so a deadline that
was met can stop being met. Dividing one history between two points shortens both, so a
deadline that was missed can start being met. The table does both, and the two effects land
on disjoint sets of claims.

### 3. On-time trend (`images/on-time-trend.svg`)

21 of 91 monthly points move, **17 down and 4 up**. One changes the whole-percent figure the
tooltip displays. Largest move −0.133pp at 2024-03 ACC (n=1,505). No points appear or
disappear — no `MIN_BASIS=20` crossings.

### 4. Duration trend (`images/duration-trend.svg`)

Effectively untouched: **one** of 86 points moves at p50 (2026-05 ACC, 4.744h → 4.746h — 9
seconds), none at p90 or p99, no `DURATION_MIN_BASIS=100` crossings. The duration
percentiles are a steps-1–3 story entirely.

### 5. Heatmaps (`images/episodes-*.svg`)

| utility | day-cells with an episode | cells changing | down | up | mean Δ | max Δ |
|---|---|---|---|---|---|---|
| INC | 844 | **6 (0.7%)** | 3 | 3 | +0.17 | +2 |
| ACC | 1,670 | **49 (2.9%)** | 36 | 13 | −0.51 | +3 |

55 day-cells change value and 37 change their published fill colour. **None recolours
without its count moving** — the global colour range is unmoved on both utilities (INC max
478, ACC max 522), so unlike #61's 344 pure recolours, nothing here shifts under a cell that
did not itself change.

Ten of the twelve per-year titles move, and **not all in the same direction**:

| year | INC | ACC |
|---|---|---|
| 2021 | 1,030 → 1,032 | 613 → 614 |
| 2022 | 9,699 → 9,702 | 20,598 → 20,611 |
| 2023 | — | 20,299 → 20,298 |
| 2024 | 7,304 → 7,302 | 20,244 → 20,239 |
| 2025 | 8,246 → 8,244 | 17,723 → 17,714 |
| 2026 | — | 11,171 → 11,169 |

The early years rise because the shorthand era *is* 2021–2022: dividing `9 Placare` into two
estates adds episodes exactly where the shorthand was published, and the merges that remove
episodes are spread across the whole record.

### 6. `data/derived/on_time_rates.csv`

| level | before | after | delta | usable rows | delta |
|---|---|---|---|---|---|
| `pt_cause_slip` | 15,844 | 15,658 | **−186** | 3,459 | **+3** |
| `sector_cause_slip` | 144 | 144 | +0 | 141 | +0 |
| `cause_slip` | 24 | 24 | +0 | 24 | +0 |
| `slip` | 4 | 4 | +0 | 4 | +0 |

Buckets clearing `MIN_BASIS=20`: 3,625 → **3,628 (+3)**. The thinned-basis worry behaves as
it did in #54 and #61 — visible in row count, positive in effect.

### 7. `data/current.json`

194 live outages, all with a posted estimate. **42 change a published field; 4 change the
probability itself** (max 0.001), **0 change the displayed whole percent**, and **0 change
`basis_bucket`**. The other 38 move only `basis_n` — a wider basis behind an unchanged
published number.

## Why it is nearly nil

Per family, where a family is one alias key and everything it can reach:

| family | keyed on | episodes before | after | Δ |
|---|---|---|---|---|
| `9 placare` → `9 placare-t` / `militari - 9 placare` | `(label, street)` | 488 | 498 | +10 |
| `3 placare` → `3 placare-t` / `militari - 3 placare` | `(label, street)` | 412 | 416 | +4 |
| `8 placare` → `8 placare-t` / `militari - 8 placare` | `(label, street)` | 388 | 392 | +4 |
| `2 placare` → `2 placare-t` / `militari - 2 placare` | `(label, street)` | 472 | 474 | +2 |
| `7 placare` → `7 placare-t` / `militari - 7 placare` | `(label, street)` | 301 | 302 | +1 |
| `stirbei voda` → `ct stirbei voda` | label | 164 | 157 | −7 |
| `spitalul militar` → `spitalul militar central` | label | 44 | 38 | −6 |
| `dageco` → `s.c. dageco invest s.r.l.` | label | 12 | 7 | −5 |
| `ministerul de chimie` → `ministerul de chimie (inst.politehnic polizu)` | label | 23 | 20 | −3 |
| `plavat` → `mt plavat` | label | 147 | 146 | −1 |
| `6 placare` → `militari - 6 placare` | label | 176 | 175 | −1 |

**Label-keyed rows: −23 episodes. Street-keyed rows: +21.** Episodes outside every family
move by 0.

Fourteen of the twenty-five labels move nothing at all, including the two the ticket
expected most from. `Saboani` (361 observations) and `5 Oltenitei` (9) are misspellings
abandoned on the day their correctly-spelled twin appears, so the two identities' outages
never overlap or adjoin and merging them merges no episode — the same reason #61 found
dropping sector to be the largest structural change and nearly the smallest published one.
The rule holds generally: **a relabelling at a moment in time reunites identities without
reuniting episodes.** `Cămin RADET` (260) and `Ministerul de Chimie` (190), new to the count
in #71, are worth 0 and −3.

What the table reaches, by observations: `plavat` 4,412, `stirbei voda` 3,606,
`spitalul militar` 990, then the Placare labels (2,041 of them street-scoped), down to
`5 oltenitei` at 9 and one Obregia module at 6 — **14,496 observations, 0.66% of the
corpus**.

## The empty `pt_name` rule

Isolated as its own rung, because #71 found it moves the baseline and the byte-identical
check has to account for it. Its whole published cost is **1 episode, 1 incident, 1 scored
estimate, 1 heatmap day-cell (INC 2026), −0.000pp**, and **nothing** on `current.json` or on
any image but `episodes-inc-2026.svg`, whose title goes 5,314 → 5,313.

The rule is worth stating for correctness, not for its magnitude: without it the derivation
builds an episode for an identity that is the empty string, which every registry name
contains — and it is the reason each figure since #55 sat exactly one too high.

## Landing it: silently, or a restatement?

**Neither, and the reason is timing rather than size.** Nothing has been published yet, so
there is no figure to restate. Step 4 must land *with* steps 1–3, not after them, and then
its incremental publication cost is zero — the same 14 images are already being republished
for the −2,434-episode fold around it.

Landing it later would be a `Restatement` per
[ADR 0003](../../adr/0003-claim-only-what-the-record-positively-shows.md) and a bad trade:
55 heatmap day-cells and 10 of 12 year titles change, so all 14 images republish, and the
whole gain is 2 episodes and 0.005pp. Worse, it would be the first restatement in which a
figure moves *up* — five claims go from missed to met, four monthly trend points rise, and
four year titles rise. A correction that improves CMTEB's number in places is exactly the
kind that should not arrive on its own.

## Corrections

**The ticket's expectation that this fold would move "the same direction on every surface"
is wrong**, and it is the only expectation in it that does not survive. Every earlier
measurement in this series established one-directionality as a property of the identity
model, and it is a property of *folding* — steps 1–3 only ever merge. Step 4 is the first
step that also **splits**, because five of its rows exist precisely to divide a label CMTEB
used for two different thermal points. Any future statement that "the revision moves every
published surface in the same direction, against CMTEB" is true of the fold as a whole and
false of step 4 in isolation.

Nothing else needs correcting: `Saboani` at 361 observations, `5 Oltenitei` at 9,
`Cămin RADET` at 260, `Ministerul de Chimie` at 190, and 2,041 observations on the
street-scoped Placare labels all reproduce to the unit.

## Reproducing

Against the foundation and artifacts at `2ef397a6c` — a later scrape fails the
byte-identical gate for the ordinary reason that the input moved. `data/thermal_points.csv`
post-dates that commit and is read from `main`; it feeds only the registry-absent counts and
two of the gates, never the derivation.

```sh
# one archive pass: street-scoped resolutions, canonical sectors, the census
WORK=work deno run -A docs/research/alias-table-delta/prepare.ts \
  data/observations data/thermal_points.csv docs/research/alias-table-delta/aliases.csv

# four full re-derives
for m in baseline steps123_keepempty steps123 full; do
  TZ=UTC WORK=work deno run -A docs/research/alias-table-delta/measure.ts "$m" "out/$m"
done

WORK=work deno run -A docs/research/alias-table-delta/verify.ts out .
WORK=work deno run -A docs/research/alias-table-delta/ladder.ts out
WORK=work deno run -A docs/research/alias-table-delta/compare.ts steps123 full out
WORK=work deno run -A docs/research/alias-table-delta/families.ts out/steps123 out/full
```

`aliases.csv` is the decided table in full: the 54 rows
[#56 derived from the address corpus](../address-resolution/pt_aliases.csv) plus the three
[#71](https://github.com/FlorinPopaCodes/termoficare-data/issues/71) added for installations
that never appear at a residential address. `alias`/`street` are canonical; `canonical` holds
the registry name as published and is put through steps 1–3 on load, so the file stays
checkable against `data/thermal_points.csv` by eye. **This is the list the implementation
needs**, and `alias_table.ts` is its reference reader.
