# Predicting when an outage ends, and what "improving" means

Two questions, measured against the archive: can this repo tell a resident when their heat
comes back, and would a Bayesian treatment of the published on-time probability be more
accurate now that the system looks like it is improving.

**Headline: it is not improving. The on-time rate rose 16–20pp since 2022 while outages got
longer on every measure — the rise is not faster restoration, because restoration got
slower, and CMTEB's deadlines moved out over the same period. On prediction: nothing in the
archive beats CMTEB's own estimate as a guess at _when_ an outage ends, but their deadline
holds only 42% of the time, and a calibrated 80% deadline is estimable from the same data —
it is about three times as long. On Bayes: yes, and more urgently than the question
assumed. Today's published probability scores _worse than a single recency-weighted number_
on both test windows — its per-outage conditioning, as currently combined, is costing
accuracy rather than adding it. Shrinkage plus a 180-day half-life is the best configuration
measured here on both windows, and it cuts a −4.7pp lean to −1.9pp.**

`src/` is untouched. Everything below is one full re-derive flattened to two tables, then
model runs over those tables.

## 1. The system is not improving

The published on-time trend rises. Read alone, it says CMTEB is getting better at meeting
its own deadlines. Two series the repo does not publish say what is actually happening.
Months 1–7 of each year, so heating seasonality and the archive's July cut-off cannot
carry the comparison; 2021 is dropped (one December, and its restorations are bracketed to
4h rather than ~1h, so it is not comparable to anything).

| year | util | estimates | on-time | median lead | closed | p50 duration | p90 duration |
|---|---|---|---|---|---|---|---|
| 2022 | ACC | 20,586 | 31.0% | 9.0h | 10,813 | 8.0h | 60.0h |
| 2023 | ACC | 21,044 | 35.5% | 8.5h | 11,743 | 6.0h | 56.0h |
| 2024 | ACC | 16,643 | 42.7% | 9.0h | 11,306 | 7.0h | 60.0h |
| 2025 | ACC | 16,204 | 43.5% | 10.0h | 10,321 | 8.0h | 85.0h |
| 2026 | ACC | 18,288 | **47.2%** | **12.4h** | 11,167 | **11.2h** | **86.2h** |
| 2022 | INC | 12,405 | 28.2% | 9.0h | 5,396 | 10.0h | 43.0h |
| 2023 | INC | 6,840 | 42.1% | 9.5h | 3,958 | 9.0h | 45.0h |
| 2024 | INC | 5,739 | 44.3% | 10.5h | 3,444 | 10.0h | 45.0h |
| 2025 | INC | 9,513 | 42.2% | 10.0h | 5,181 | 11.0h | 75.0h |
| 2026 | INC | 10,356 | **47.9%** | 10.2h | 5,346 | **12.3h** | **68.3h** |

On-time is up 16.2pp on hot water and 19.7pp on heating. Over the same window the typical
outage got **3.2h longer** on hot water and **2.3h longer** on heating, and the p90 got
**26h** and **25h** longer. The deadline moved out with it: ACC's median posted lead went
from 9.0h to 12.4h.

The duration columns and the median-lead column are medians *of the monthly figures* — for
duration, the same quantities `images/duration-trend.svg` plots — so a single heavy month
cannot carry a year. The on-time column is pooled, weighted by each month's estimate count.

The deadline-free version of the same question — the share of outages restored within a
fixed number of hours of first sighting, which no choice of deadline can move:

| year | util | outages | ≤6h | ≤12h | ≤24h | ≤72h | ≤168h |
|---|---|---|---|---|---|---|---|
| 2022 | ACC | 10,813 | 45.3% | 59.5% | 70.5% | 88.4% | 97.1% |
| 2023 | ACC | 11,743 | 49.3% | 64.0% | 73.8% | 90.1% | 98.6% |
| 2024 | ACC | 11,306 | 47.5% | 61.5% | 71.0% | 90.0% | 99.2% |
| 2025 | ACC | 10,321 | 44.8% | 58.9% | 68.0% | 85.9% | 98.0% |
| 2026 | ACC | 11,359 | 41.7% | 56.0% | 67.6% | 84.3% | 93.8% |
| 2022 | INC | 5,396 | 28.8% | 51.5% | 71.3% | 95.1% | 99.8% |
| 2023 | INC | 3,962 | 39.2% | 58.1% | 74.0% | 95.4% | 100.0% |
| 2024 | INC | 3,449 | 34.6% | 52.0% | 68.3% | 95.5% | 99.8% |
| 2025 | INC | 5,184 | 34.3% | 53.0% | 69.3% | 89.6% | 99.2% |
| 2026 | INC | 5,358 | 26.2% | 44.8% | 63.8% | 86.2% | 94.1% |

**No year since 2023 has been faster than the one before it, on either utility, at any
horizon.** The clearest movement is in the tail, where a resident notices: hot water
outages resolving inside three days fell from 90.1% to 84.3%, heating from 95.4% to 86.2%.
2022→2023 is the one non-monotone step, so the claim is "since 2023", not "since the
archive opens".

Two things make this reading conservative rather than generous:

- **Scrape cadence got finer, not coarser.** The bracket on an observed restoration (last
  sighting → first absence) has a median of 1.00h in 2022–2025 and 0.63–0.81h in 2026.
  Finer cadence catches restoration *sooner*, which shortens measured durations. The
  slowdown is measured against a measurement that got more generous.
- **Each horizon carries its own denominator.** An outage begun three days before the
  archive ends settles the 6/12/24/72h horizons and not the 168h one, so it is dropped
  from that column only (2026 ACC: n=11,194 rather than 11,359). Counting the 193
  still-open outages either way would bend the last year.

This does not make the published on-time trend wrong — it measures what it says it
measures. It makes it insufficient on its own: a rising line there is consistent with a
system getting slower, and in this archive that is what it is.

## 2. Predicting when an outage ends

The evaluation unit is a **posting**: the moment CMTEB puts a deadline on the page is the
moment this repo would publish a prediction beside it. Every model is refitted monthly on
the archive as it stood on the 1st — outages closed by then as events, outages still out as
censored exposure — so no run sees its own future. 74,952 postings scored over
2025-01..2026-06, with the same run over 2023-01..2024-12 (101,033 postings) as the
robustness check.

Two families. **Age models** answer from the outage's own elapsed age and ignore what
CMTEB said. **Ratio models** answer in multiples of CMTEB's posted lead, which makes them a
correction of the deadline rather than a replacement for it. Both are Kaplan-Meier on a
coarse grid, so censored outages carry their exposure instead of being dropped.

| model | median abs err | pinball p50 | pinball p80 | 80% deadline coverage | median 80% deadline |
|---|---|---|---|---|---|
| **CMTEB's posted deadline** | **7.7h** | **14.79** | 19.56 | **42.4%** | 11.5h |
| age: pooled | 12.1h | 18.50 | 21.75 | 79.6% | 42.0h |
| age: utility | 11.3h | 18.30 | 21.47 | 79.2% | 43.0h |
| age: utility × cause | 12.0h | 18.23 | 20.61 | 78.4% | 53.4h |
| age: utility × cause × slip | 11.4h | 18.01 | 20.71 | 77.9% | 53.1h |
| age: + CMTEB's lead as a covariate | 9.6h | 16.11 | 18.27 | 80.5% | 38.4h |
| ratio: pooled | 8.8h | 14.90 | 19.79 | 81.8% | 35.8h |
| ratio: utility × cause × slip | 9.3h | 15.29 | 19.81 | 81.7% | 38.3h |
| **ratio: utility × cause × slip × lead** | 8.0h | **14.63** | **16.96** | **79.5%** | 33.8h |
| ratio: + elapsed age | 8.1h | 14.63 | 17.50 | 79.3% | 33.3h |

Pinball loss is the proper scoring rule for a quantile forecast; lower is better.
Coverage is the share of outages actually restored by the deadline the model named.

The 2023-01..2024-12 window, same protocol, 101,033 postings:

| model | median abs err | pinball p50 | pinball p80 | 80% deadline coverage | median 80% deadline |
|---|---|---|---|---|---|
| **CMTEB's posted deadline** | **6.5h** | 11.96 | 15.23 | **39.6%** | 10.0h |
| age: utility × cause × slip | 9.8h | 14.47 | 16.37 | 81.0% | 48.8h |
| age: + CMTEB's lead as a covariate | 8.5h | 12.91 | 14.93 | 82.8% | 34.1h |
| ratio: pooled | 7.4h | 12.58 | 17.45 | 82.6% | 31.9h |
| ratio: utility × cause × slip | 7.6h | 12.60 | 15.39 | 81.6% | 32.9h |
| **ratio: utility × cause × slip × lead** | **7.0h** | **11.60** | **13.38** | **81.4%** | 30.5h |
| ratio: + elapsed age | 7.1h | 11.70 | 13.66 | 81.0% | 30.5h |

Every conclusion drawn below holds on both windows: the same model wins, every age-only
model loses to CMTEB's deadline as a point forecast, the ratio family beats the age family,
adding elapsed age costs rather than gains, and the coverage gap is 39–42% against a
calibrated 79–81%. The one thing that does *not* reproduce is the ordering *within* the
losing age-only group, where three models sit inside 0.3 pinball of each other and swap
places between windows.

### CMTEB's estimate is the best point forecast available, and it is not close

Every age-only model loses to the posted deadline as a guess at when the outage ends —
14.79 for CMTEB against 18.01 for the best of them. Adding CMTEB's lead as a covariate
closes most of that gap (16.11); anchoring on it entirely closes all of it (14.63, a 1.1%
edge; 3.0% on the 2023–24 window).

That is the finding, and it is worth stating plainly: **the archive contains no covariate
that reproduces what CMTEB knows.** Thermal point, cause class, slip count and elapsed age
together are worse than the number a dispatcher types in. They can see what is broken.

**Elapsed age adds nothing once the lead is conditioned on** — pinball p50 identical to the
third decimal on this window (14.63) and slightly worse on the other (11.70 vs 11.60), p80
worse on both (17.50 vs 16.96, 13.66 vs 13.38). The heavy tail made age-conditioning look
like the obvious lever — an outage three days old should be a different animal from a
one-hour-old one — but measured, the lead already carries whatever age would have told us,
and splitting the cells further only thins them. That closes the hypothesis rather than
leaving it open.

### What is broken is not the estimate, it is the confidence

CMTEB's deadline holds **42.4%** of the time (39.6% on 2023–24). Read as a promise it is
wrong more often than right. Read as a *median* it is roughly honest, and that is the
distinction the page never makes.

The same data supports a deadline that means what it says. The winning model's 80%
deadline lands at **79.5% coverage** (81.4% on 2023–24) — calibrated to within half a
point, out of sample, on 74,952 predictions. The cost is length: its median is **33.8h**
against CMTEB's 11.5h. An honest 80% promise on a Bucharest hot-water outage is about a
day and a half, not an evening.

Two limits on this number. The tail stays unpredictable — p90 absolute error is 78–80h for
every model including CMTEB's, so "when" is answerable in distribution and not per outage.
And eval postings come only from outages that closed, so the 193 still open — exactly the
extreme tail a coverage statistic is sensitive to — are absent; read 79.5% as approximately
79%.

## 3. The published probability, with Bayes

The on-time probability in `data/current.json` pools every scored estimate in the archive
and walks a backoff chain, publishing the first bucket holding `MIN_BASIS = 20`. Two things
that can cost accuracy, and they are separate knobs:

- the **cliff at 20** discards everything a thinner bucket knows, discontinuously;
- **flat pooling** treats a 2022 estimate as evidence about today, and §1 shows the
  underlying rate is not stationary.

Shrinkage replaces the cliff: walking the chain coarse to fine, each level's posterior mean
pulls its own counts toward the level above with strength κ, so a bucket with two estimates
barely moves off its parent and one with two hundred is essentially its own rate. Decay
replaces flat pooling: each estimate is weighted `0.5 ^ (age / half-life)`.

Both full grids — 4 half-lives × (production, three κ, and a no-conditioning baseline) —
were run on **2025-01..2026-06** and on **2023-01..2024-12**, and both are in
`calibrate.ts`'s output, so the choice below is auditable rather than asserted. Neither
window is held out: the earlier one was run second, after the later grid had been seen. The
case for `κ=50, 180d` is not a single held-out score but stability — it has the best Brier
of any configuration on 2023–24 and sits 0.0002 off the best on 2025–26, with better
calibration and less lean than the configuration that edges it there.

The rows that reframe everything else are the two in the middle. A predictor that ignores
thermal point, cause class and slip count entirely — publishing one number, the
recency-weighted all-history rate as it stood at the cutoff — is included as the bar the
conditioning has to clear, alongside the best any constant could have done in hindsight.
Refit monthly, 74,952 predictions on the later window and 101,033 on the earlier.

| model | Brier | log loss | calibration error | bias | skill |
|---|---|---|---|---|---|
| **`backoff@20, flat` (production today)** | 0.24732 | 0.69107 | 6.48pp | **−4.66pp** | **−1.24%** |
| _a constant 42.44% (the skill floor)_ | _0.24429_ | _0.68168_ | — | — | _0.00%_ |
| `base rate only, 90d` (no conditioning) | 0.24489 | 0.68296 | **2.10pp** | −1.96pp | −0.25% |
| `backoff@20, 180d` (decay only) | 0.24576 | 0.68726 | 4.03pp | −1.93pp | −0.60% |
| `shrinkage κ=50, flat` (shrinkage only) | 0.24466 | 0.68374 | 5.27pp | −4.71pp | −0.15% |
| **`shrinkage κ=50, 180d` (chosen)** | **0.24306** | **0.68031** | 2.78pp | **−1.91pp** | **+0.50%** |

Bias is mean predicted probability minus realised hit rate — which way the whole surface
leans. Calibration error cannot see it: two bins wrong in opposite directions average out
there and do not average out here. Skill is the Brier improvement over a constant equal to
the window's realised hit rate. That constant is fitted *on the eval window* — it is the
best any single number could have done in hindsight, which is why it is a floor and not a
competitor. The fair out-of-time comparison is the `base rate only` row, which knows only
what the archive held at each cutoff.

### The published probability has negative skill

**Production scores below the floor on both windows** — −1.24% here, −0.54% on 2023–24
(0.24043 against 0.23915). The out-of-time version of that claim is the one that matters and
it holds too: **a single recency-weighted number, conditioned on nothing, beats production on
both windows** — 0.24489 vs 0.24732 here, 0.23984 vs 0.24043 there, at a calibration error of
2.10pp against production's 6.48pp. Production does beat an *undecayed* single number on the
earlier window (0.24043 vs 0.24202), so the claim is against a recency-weighted constant, not
any constant.

That is a harder finding than "Bayes would help a bit". The thermal point, the cause class
and the slip count are the entire basis on which `data/current.json` claims one outage is
more likely to be met than another, and as currently combined they are worth less than
nothing. It is the same result §2 reached from the other side: the archive's covariates do
not reproduce what a dispatcher knows. Here they do not even pay for the variance they add.

Two things cause it, and they are the two knobs. Small buckets that clear `MIN_BASIS = 20`
by a hair are published at their own noisy rate with nothing pulling them back, which
spreads predictions to the extremes; and flat pooling drags the whole surface toward a
four-and-a-half-year average that §1 shows is not the current rate. The second is worth more
than the first: within the no-conditioning family alone, moving from `flat` to `90d` gains
0.00202 Brier here and 0.00218 on 2023–24, while adding the whole chain to the flat base rate
gains 0.00159 on 2023–24 and *loses* 0.00041 here. Recency is worth more than every covariate
in the chain combined, on both windows.

**The published probability understates CMTEB by 4.66pp**, and by 4.75pp on the 2023–24
window, so this is the surface's steady state and not a recent artifact. This is the
direction an accountability project must not lean by accident — it is a correction the repo
owes CMTEB, not a refinement.

What fails is the shipped *configuration*, not the chain. Add decay alone and production's
own backoff already clears the floor on the earlier window (`backoff@20, 180d`, +0.99%),
though not on the later one (−0.60%). `shrinkage κ=50, 180d` is the configuration that clears
it on both, and by the widest margin: **+0.50% skill on the later window and +2.00% on the
earlier one**, cutting the bias to −1.91pp and the calibration error from 6.48pp to 2.78pp.
That is a real improvement and a small one — the honest reading is that conditioning on what
this archive records earns roughly half a percent to two percent over a well-maintained
single number, and only once shrinkage and decay are both in place.

Where it earns that is visible in the reliability table: production's low-confidence buckets
are systematically pessimistic (predicts 25.9%, observes 34.4%) and its high-confidence
buckets systematically over-sure (predicts 73.8%, observes 54.3%) — small samples spread to
the extremes. Shrinkage pulls exactly those back.

| predicted | production n | production observed | chosen n | chosen observed |
|---|---|---|---|---|
| 10–20% | 3,017 | 33.0% | 1,589 | 31.3% |
| 20–30% | 16,523 | 34.4% | 9,007 | 35.1% |
| 30–40% | 25,242 | 42.5% | 25,679 | 38.0% |
| 40–50% | 18,887 | 46.0% | 26,576 | **45.2%** |
| 50–60% | 7,642 | 49.3% | 9,769 | **53.1%** |
| 60–70% | 2,589 | 56.0% | 1,921 | 52.2% |
| 70–80% | 591 | 54.3% | 405 | 50.9% |

The chosen configuration's 40–50% and 50–60% bins — 36,345 of its 74,952 predictions — land
within 0.2pp of the frequency they claim (45.0% predicted / 45.2% observed, 53.3% / 53.1%).
Production's corresponding bins are 1.1pp low and 4.5pp high, in opposite directions, which
is the kind of error the bias column sums and the calibration error hides. Neither
configuration is well calibrated above 60%: production overstates there on 3,277
predictions, the chosen one on 2,332. Production also makes 364 predictions below 10% and
97 above 80%, observing 28.3% and 68.0%; the chosen configuration makes none below 10% and
six above 80% — the cliff-free chain declining to claim what it cannot support.

Both knobs contribute and they compose — decay alone and shrinkage alone each beat
production, and together they beat either. **One caveat on that decomposition:** with a
finite half-life the counts are weighted sums, but `hardBackoff` still tests `n >= 20`
against them, so a bucket with 60 raw estimates spread over three years falls under the
threshold and backs off to a coarser level. `backoff@20, 180d` is therefore partly recency
and partly an accidental shrinkage-like effect. The chosen model uses no threshold at all,
so the headline stands; the clean statement is that shrinkage alone beats production
(0.24466 vs 0.24732) and decay improves it further, not that the two are cleanly separable
in the `backoff@20` rows.

`90d` is too aggressive once the chain is in play — `backoff@20, 90d` is the worst row in
the whole grid on this window (0.24788) — but it is the best half-life for the
no-conditioning baseline and the best on bias everywhere. The trade-off between tracking the
drift and keeping the sample is real, and it moves with how thin the buckets are: the
un-conditioned rate can afford to forget faster than a per-thermal-point one. 180d sits at
the knee for the chain on both windows.

## What this hands the build effort

1. **The on-time trend needs a companion series.** Published alone it reads as improvement
   and the improvement is not there. Either the fixed-horizon restoration rate or the
   median posted lead, on the same chart, makes the deadline inflation visible. This is the
   §1 finding and it is independent of everything else here.
2. **`shrinkage κ=50, 180d` is a restatement, not a refinement.** It moves every published
   `on_time_probability` upward by about 2.7pp on average, and per ADR 0002's precedent the
   whole set of affected surfaces republishes in one step and gets dated. Sizing that delta
   surface by surface is the next measurement, in the shape of `identity-model-delta`.
3. **Decide whether the per-outage probability is worth publishing at all.** Today's version
   has negative skill: a recency-weighted all-history rate beats it on both windows, on
   every metric, while being one number with a basis anyone can check. Fixing it recovers
   +0.5% to +2.0% over that number — real, and small enough that "43% of estimates in the
   last 180 days were met" may be the more defensible surface
   under [ADR 0003](../../adr/0003-claim-only-what-the-record-positively-shows.md). That is
   a decision, and it should be taken deliberately rather than inherited from the fact that
   the chain already exists.
4. **Do not build a "when will it end" predictor that replaces CMTEB's estimate.** It would
   be worse. What the archive supports is a *confidence* attached to their number.
5. **The publishing form is a decision, not a measurement.** "80% of comparable outages were
   back within 34 hours" is a claim about the record and sits inside
   [ADR 0003](../../adr/0003-claim-only-what-the-record-positively-shows.md); "your heat
   returns at 3pm" is a claim beyond it. Whether the reader-facing surface carries a second
   deadline at all, and at what quantile, belongs in a `Decide…` issue alongside
   [#66](https://github.com/FlorinPopaCodes/termoficare-data/issues/66) and
   [#67](https://github.com/FlorinPopaCodes/termoficare-data/issues/67), not in this file.

## Re-running

From the repo root. `WORK` holds the two flat tables every model reads.

```sh
export WORK=/tmp/end-prediction
mkdir -p "$WORK"
D=docs/research/outage-end-prediction
TZ=UTC deno run -A $D/prepare.ts              # one full re-derive, ~40s
TZ=UTC deno run -A $D/trend.ts                # §1: on-time vs lead vs duration
TZ=UTC deno run -A $D/speed.ts                # §1: fixed-horizon restoration rates
TZ=UTC deno run -A $D/predict.ts              # §2: 2025-01..2026-06, ~20 min
TZ=UTC deno run -A $D/predict.ts 2023-01 2024-12
TZ=UTC deno run -A $D/calibrate.ts            # §3: 2025-01..2026-06
TZ=UTC deno run -A $D/calibrate.ts 2023-01 2024-12
```

`prepare.ts` takes the foundation directories as arguments, so pinning to a commit is
`git archive <ref> data/observations data/snapshots | tar -x -C <dir>` and passing that dir.

- `prepare.ts` — one re-derive → `episodes.csv`, `postings.csv`
- `data.ts` — loading and time helpers
- `hazard.ts` — Kaplan-Meier on a parameterised grid; conditional survival and quantiles
- `trend.ts`, `speed.ts` — §1
- `predict.ts` — §2
- `calibrate.ts` — §3
