# Address→thermal-point resolution

How a resident gets from the address they know to the thermal point that serves them. Resolves
[#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56), and re-measures the headline
figure that ticket inherited from
[#53](https://github.com/FlorinPopaCodes/termoficare-data/issues/53).

**Headline: a static `(street, block)` index resolves 97.71% of addresses to exactly one thermal
point, and only 13 addresses out of 10,283 ever change thermal point.** The inherited 97.2% was an
upper bound computed under an over-fold; it survives re-measurement, but only because the model
gains a step ADR 0002 does not currently have. Without that step the figure is **94.47%**.

## How it was measured

Full scan of all 56 monthly CSVs under `data/observations/`, 2021-12-19 → 2026-07-25, no sampling.
Thermal-point identity is `wideCanonicalName` from
[the identity-model harness](../identity-model-delta/identity.ts) — ADR 0002 as amended by
[#64](https://github.com/FlorinPopaCodes/termoficare-data/issues/64), the reference implementation
of the decided pipeline. `zone_raw` parsing is [`address.ts`](address.ts); the scan and the
alias-table derivation are [`measure.ts`](measure.ts).

The address basis is **10,283 `(street, block)` pairs**, against #53's 9,535. The corpus is the
same; the difference is the token policy (below) and a reconstructed institution filter, since #53's
script was never committed. **Read the rungs against each other, not against #53's absolute
counts.**

## 1. The inherited figure was right by coincidence

#53 measured resolution under a fold that merged the prime marker, the `-T` suffix and the
`MILITARI` prefix — which [ADR 0002](../../adr/0002-thermal-point-identity-by-canonical-name.md)
established are disambiguators, not aliases, placing those pairs 0.3–13 km apart on CMTEB's own map.
Over-folding inflates resolution _by construction_: an address on a Titan street resolved to the
merged Titan+Militari identity and so never registered as touching two points.

| rung                                | resolves to exactly 1 point | migrations | concurrent |
| ----------------------------------- | --------------------------: | ---------: | ---------: |
| settled model, shorthand unresolved |                      94.47% |        354 |        208 |
| + per-address shorthand resolution  |                      97.60% |         44 |        200 |
| + alias table (the decided model)   |                  **97.71%** |     **13** |        222 |
| _#53's over-fold, for reference_    |                    _97.60%_ |       _43_ |      _201_ |

The over-fold and the correct model land in the same place because folding the `MILITARI` prefix and
`-T` papered over the **pre-2022-07 shorthand era** for free. ADR 0002 retains those qualifiers, so
the shorthand is now exposed, and the 3.13pp gap between the first two rungs is entirely it. Closing
that gap is a prerequisite for the address model, not a refinement of it.

## 2. The shorthand rule has to be per-address

ADR 0002 resolves a shorthand label when exactly one registry name contains it. On the address
corpus that leaves 7 labels ambiguous — and **a per-label majority vote actively mis-assigns them**.
`9 Placare` votes 26–19 for `9 Placare-T`, but the Mohorului, Crainicului and Valea Lungă blocks
demonstrably continue under `MILITARI - 9 Placare`. The bare `N Placare` labels **blend both
estates**, so no single winner per label can be right.

Resolving per address instead — a shorthand at this address folds into the one candidate also seen
at this address, else the one on this street — resolves **324 of 374 occurrences on same-address
evidence and 36 more on same-street, leaving 14**. All five blended labels resolve cleanly. The
address index is a better shorthand oracle than the registry is.

Of 20 shorthand labels in the address corpus, **15 resolve the same way everywhere and 5 blend**:

| label       | Titan addresses | Militari addresses |
| ----------- | --------------: | -----------------: |
| `2 Placare` |              28 |                 15 |
| `3 Placare` |              10 |                 12 |
| `7 Placare` |              12 |                 17 |
| `8 Placare` |              10 |                 18 |
| `9 Placare` |              26 |                 19 |

ADR 0002's spacing rule — `1Placare` is the Titan point, `1 Placare` the Militari one — holds
wherever the unspaced form exists (1, 4, 5, 6). For 2, 3, 7, 8 and 9 **CMTEB only ever published the
spaced form**, using it for both estates. The ADR is not wrong there; it is silent.

**`modul termic`, [#61](https://github.com/FlorinPopaCodes/termoficare-data/issues/61)'s worst case
at 84 registry candidates, has 0 addresses in this corpus.** It never appears with a parseable
residential block list, so it drops out of the address index entirely.

### What separates the blended labels

Only the street. Measured against every field available on the observation:

- **Sector fails.** It splits 3 of the 5 — `8 Placare` sector 3 carries 9 Titan addresses _and_ 16
  Militari ones. This is independent confirmation of ADR 0002's decision to demote sector out of
  identity.
- **Street succeeds completely**: all **37 `(label, street)` keys are clean, zero split**.

## 3. The alias table

[`pt_aliases.csv`](pt_aliases.csv) — **54 rows, 17 keyed on the label alone and 37 on
`(label, street)`**. Derived by `measure.ts`, not hand-written.

The table is **frozen, not a maintenance surface**: every `N Placare` label stops between 2022-06-16
and 2022-06-21, and none has reappeared in the four years since. The five still-live shorthand
labels (`Stirbei Voda`, `Plavat`, `Dageco`, `Spitalul Militar`, `Gradinita Nr.268`) each have
exactly one registry candidate and need no street.

It also carries a **third alias class** that ADR 0002's substring rule cannot reach: a corpus label
absent from the registry whose use stops exactly when a registry-present near-twin starts.

| alias         | canonical    | switches   | addresses |
| ------------- | ------------ | ---------- | --------: |
| `Saboani`     | `Sabaoani`   | 2023-05-11 |        26 |
| `5 Oltenitei` | `5 Oltenita` | 2022-02-10 |         6 |

`saboani` is not a substring of `sabaoani`, so containment never finds it. Note this cannot be
generalised into a spelling rule: `2 Oltenitei` **is** a distinct registry point 0.5 km from
`5 Oltenita`.

Applying the table costs `derive.ts` the street list from `zone_raw` — the split on the first spaced
hyphen in each `•` segment, not the block grammar. Blocks and `snapshot_ts` still play no part in
identity.

## 4. Resolution does not need a time dimension

**13 addresses out of 10,283 (0.13%)** are served by one thermal point and later another — a third
of #53's 42, because two of its "migrations" were the misspelling pairs above and most of the rest
were the shorthand era.

```
compozitorilor / bl f11       6/8 [2021-12..2023-01] -> 4/8 [2023-03..2026-07]
doamna ghica / bl 15          7 Doamna Ghica -> 1 Colentina Socului   2022-02
gheorghe sincai / bl 3        Sincai -> 4 Lanariei                    2022-02
secuilor / bl b47             9 Brancoveanu -> 19 Dolhasca            2022-02
stefan cel mare / bl 1        Aleea Circului -> Spitalul Clinic Colentina
pantelimon / bl 69            4' Pantelimon -> 4 Pantelimon    (one day, 2024-04)
wolfgang amadeus mozart / bl 4  CT Floreasca -> CT Mozart      (one day, 2026-07)
rahovei / bl scara 1          4 Rahova -> 6 Rahova       (two isolated single days)
```

Several are single-day appearances that read as data entry rather than a building changing supplier.
A time-dependent index would buy 13 addresses and cost a date parameter on all 10,283.

## 5. Street-label drift

Under the settled model, **501 of 10,202 `(point, block)` triples (4.9%)** carry more than one
street name — and they split **339 interleaved to 162 clean hand-offs**. Both labels stay in use for
two cases in three.

This is why the decision absorbs drift silently rather than narrating it: "your block was listed
under Str Liliacului until April 2022" is **false for the majority**. The map's own worked example
got this wrong — it recorded `6 Aviatiei` bl `20F` as a relabel, but `Str Smaranda Brăescu` runs
from day one _alongside_ `Str Zăgazului`.

Making historical labels searchable is nearly free: of **1,129 distinct street names, only 12 exist
solely as a retired label** — `Rondul Bisericii`, `Dimitrov Gheorghe`, `Ion Băieşu`, `Unităţii`,
`Veveriţei`, `Voiniceni`, `Sf. Nicolae Tei`, `Barbat Voievod`, `Gura Humorului`,
`Paharnicul Turturea`, `Fălciu`, `Galaţi`. Every other old label is still in live use somewhere, so
indexing all of them costs 12 rows.

Clean hand-offs cluster at 2022-02 (74) and 2022-04 (27) — municipal decommunization renames, not
CMTEB bookkeeping. Street _type_ drifts too (98 `(point, block, name)` triples carry more than one),
so matching ignores it.

## 6. Corrections to #53

**§5 is wrong that dropping the no-digit token class costs no residential coverage.** The class is
dominated by single-letter block labels, which are ordinary residential buildings:

| token | observations | thermal points |
| ----- | -----------: | -------------: |
| `b`   |       66,379 |             37 |
| `c`   |       63,515 |             29 |
| `a`   |       35,742 |             16 |
| `f`   |       23,339 |             11 |
| `g`   |       20,866 |              9 |

Indexing them adds **400 addresses**. The genuinely institutional tokens are separable —
`institutie` (38,113 observations), `parohie`, `policlinica`, `cresa sf. stelian`, and 113 distinct
institution phrases.

**Two grammar claims verified across the full corpus**, both holding: **zero** of the 6,849,152
segments begin with a street-type token outside the closed set of ten, and **2.11%** of segments are
dangling — a street named with its block list missing. Those still say _this point serves this
street_, so they feed the street index.

**Data-quality note:** rows with an empty `pt_name` exist (2026-02-03, sector 6). They carry zones
but no thermal point, so they cannot enter the index.

## 7. The decided model

- **Key** is `(street, block)`, street-type-insensitive. A block token indexes if it bears a digit
  or is a single letter, unless it is on the institution stop-list. Block suffixes are never
  normalized away — `4` and `4Bis` are different buildings.
- **Every street label a block has carried is a search alias.** Drift is never narrated.
- **Lookup returns a list**, always: length 1 for 97.71% of addresses, 2–4 for the 222 concurrent
  cases (219 carry two candidates, 15 carry three, one carries four), and a time-disjoint pair with
  date spans for the 13 migrations. Candidate records are shown separately, never merged — a union
  overstates and an intersection understates.
- **A miss is an outcome, not a failure.** The index covers only addresses that have had a published
  outage, and it is saturated: 91.3% of addresses were seen by 2022-04 and only 1.4% first appeared
  in the last 12 months. But saturation is not coverage. Per
  [ADR 0003](../../adr/0003-claim-only-what-the-record-positively-shows.md) a clean record cannot be
  distinguished from an unpublished outage or a blind day, so a miss says no outage has been
  _published_ for this address and offers the street's thermal points as context — never that this
  is good news.
- **A separate street→PT index** (1,182 streets) serves the miss path and the dangling segments.

## What this hands on

- **To ADR 0002:** a fourth pipeline step, the alias table, and the correction that its spacing rule
  is silent rather than decisive for `2/3/7/8/9 Placare`.
- **To [#58](https://github.com/FlorinPopaCodes/termoficare-data/issues/58):** the street index, the
  candidate-list presentation, and the miss-path copy.
- **Unmeasured here:** what the alias table costs on published figures. It changes identity, and ADR
  0002 requires that fold to land before the first published on-time figure.
