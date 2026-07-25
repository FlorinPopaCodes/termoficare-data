# Address→thermal-point resolution

How a resident gets from the address they know to the thermal point that serves them. Resolves
[#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56), and re-measures the headline
figure that ticket inherited from
[#53](https://github.com/FlorinPopaCodes/termoficare-data/issues/53).

**Headline: a static `(street, block)` index resolves 97.78% of addresses to exactly one thermal
point, and only 11 addresses out of 10,205 ever change thermal point.** The inherited 97.2% was an
upper bound computed under an over-fold; it survives re-measurement, but only because the model
gains a step ADR 0002 does not currently have. Without that step the figure is **94.36%**.

## How it was measured

Full scan of all 56 monthly CSVs under `data/observations/`, 2021-12-19 → 2026-07-25, no sampling.
Thermal-point identity is `wideCanonicalName` from
[the identity-model harness](../identity-model-delta/identity.ts) — ADR 0002 as amended by
[#64](https://github.com/FlorinPopaCodes/termoficare-data/issues/64), the reference implementation
of the decided pipeline. `zone_raw` parsing is [`address.ts`](address.ts); the scan and the
alias-table derivation are [`measure.ts`](measure.ts).

The address basis is **10,205 `(street, block)` pairs**, against #53's 9,535. The corpus is the
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
| settled model, shorthand unresolved |                      94.36% |        352 |        224 |
| + per-address shorthand resolution  |                      97.47% |         42 |        216 |
| + alias table (the decided model)   |                  **97.78%** |     **11** |        216 |
| _#53's over-fold, for reference_    |                    _97.47%_ |       _41_ |      _217_ |

The over-fold and the correct model land in the same place because folding the `MILITARI` prefix and
`-T` papered over the **pre-2022-07 shorthand era** for free. ADR 0002 retains those qualifiers, so
the shorthand is now exposed, and the 3.11pp gap between the first two rungs is entirely it. Closing
that gap is a prerequisite for the address model, not a refinement of it.

The over-fold lands _exactly_ on the per-address rung (97.47%, 41 vs 42 migrations) — it is a
faithful stand-in for shorthand resolution and nothing more. The remaining 0.31pp the alias table
adds over both is the misspelling class in §3, which no fold reaches.

## 2. The shorthand rule has to be per-address

ADR 0002 resolves a shorthand label when exactly one registry name contains it. On the address
corpus that leaves 7 labels ambiguous — and **a per-label majority vote actively mis-assigns them**.
`9 Placare` votes 26–19 for `9 Placare-T`, but the Mohorului, Crainicului and Valea Lungă blocks
demonstrably continue under `MILITARI - 9 Placare`. The bare `N Placare` labels **blend both
estates**, so no single winner per label can be right.

Resolving per address instead — a shorthand at this address folds into the one candidate also seen
at this address, else the one on this street — resolves **324 of 374 occurrences on same-address
evidence and 39 more on same-street, leaving 11**. All five blended labels resolve cleanly. The
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

One precondition, checked rather than assumed. A street-scoped lookup takes the observation's street
list, so if a single observation named streets belonging to _different_ estates, the answer would
depend on which street came first in `zone_raw` — an arbitrary tiebreak filing an estate's blocks 10
km away, and one no aggregate figure here would expose, since the row still resolves to exactly one
point. Of the **44 distinct `zone_raw` strings that touch a street-scoped key, zero name streets
with different targets.** The blended labels never mix estates within one observation, so the lookup
is order-independent. Any consumer of the table inherits this precondition and should re-check it if
the corpus grows.

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

**11 addresses out of 10,205 (0.11%)** are served by one thermal point and later another — a quarter
of #53's 42, because two of its "migrations" were the misspelling pairs above and most of the rest
were the shorthand era.

```
compozitorilor / bl f11       6/8 [2021-12..2023-01] -> 4/8 [2023-03..2026-07]
valea prahovei / bl 8s14      6/8 -> 4/8                             2022-02
doamna ghica / bl 15          7 Doamna Ghica -> 1 Colentina Socului   2022-02
gheorghe sincai / bl 3        Sincai -> 4 Lanariei                    2022-02
secuilor / bl b47             9 Brancoveanu -> 19 Dolhasca            2022-02
stefan cel mare / bl 1        Aleea Circului -> Spitalul Clinic Colentina  2022-02
resita / bl a5                1 Zona IV -> 4 Vifornita                2022-04
lugojana / bl 50              1 Matei Ambrozie [..2022-11] -> 16 Racari [2025-01..]
nicolae grigorescu / bl 6     sc.3C3/1 -> 3 C5/1        (2022-11, then one day 2023-01)
pantelimon / bl 69            4' Pantelimon -> 4 Pantelimon    (one day, 2024-04)
wolfgang amadeus mozart / bl 4  CT Floreasca -> CT Mozart      (one day, 2026-07)
```

Several are single-day appearances that read as data entry rather than a building changing supplier
— `sc.3C3/1` is not even a well-formed point name. A time-dependent index would buy 11 addresses and
cost a date parameter on all 10,205.

## 5. Street-label drift

Under the settled model, **495 of 9,908 `(point, block)` pairs (5.0%)** carry more than one street
name — and they split **335 interleaved to 160 clean hand-offs**. Both labels stay in use for two
cases in three.

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
dominated by single-letter block labels, which are ordinary residential buildings. On Bld Timişoara,
`bl A, B, C, D, E, F, G, H` is eight of them:

| token | observations | thermal points |
| ----- | -----------: | -------------: |
| `b`   |       47,016 |             26 |
| `c`   |       45,095 |             22 |
| `a`   |       35,691 |             15 |
| `f`   |       23,339 |             11 |
| `g`   |       20,866 |              9 |

Indexing them adds **123 addresses**. The genuinely institutional tokens are separable —
`institutie` (38,113 observations), `parohie`, `policlinica`, `cresa sf. stelian`, and 113 distinct
institution phrases.

**But a bare letter is not always a block, and volume alone cannot tell the difference.** A block's
staircases are enumerated as bare letters after it: in `Str Tineretului - bl. 19 sc.A, B, 37, 39`
the `B` is staircase B of block 19, not a block B. Read as a block it invents an address, and worse,
it collides — `Str C. Rădulescu-Motru - bl. 1, 35 sc.A+C, B, 37A` would file its `B` at the same
phantom address. Splitting single-letter tokens by what precedes them:

| context                                        | token instances | reading   |
| ---------------------------------------------- | --------------: | --------- |
| list has no numbered token (`bl. A, B, C`)     |         123,184 | block     |
| first building token of a mixed list (`K, K1`) |          38,017 | block     |
| after a plain numbered token (`121, 120, G`)   |         135,579 | block     |
| after a token bearing `sc.` (`19 sc.A, B`)     |          39,024 | staircase |

Counted after prefix stripping, so `bl. A` contributes its `A`, and weighted by occurrence — a
single-letter token in a `zone_raw` seen on 400 days counts 400 times. **11.6% of the 335,804
single-letter token instances are staircases.**

So the rule is positional, and sticky — in `bl. 71 sc. A, B, C` all three letters are staircases of
block 71, and the run only closes on the next token that names a building. Excluding them removes 78
phantom addresses and 2 spurious migrations, one of which (`rahovei / bl scara 1`) was an artifact
end to end.

**Two grammar claims verified across the full corpus**, both holding: **zero** of the 6,849,152
segments begin with a street-type token outside the closed set of ten, and **2.11%** of segments are
dangling — a street named with its block list missing. Those still say _this point serves this
street_, so they feed the street index.

A third class sits beside the dangling one: **2.44% of segments carry a block list that yields no
building at all** — named houses (`Str Castranova - Casa Ilie`), `Imobil`, `Bloc Turn`, and one
outright parse gap, `Str Băiculeşti - bl .A3`, where the stray space after `bl` leaves `.A3` and the
token is dropped (1,313 observations). These behave like dangling segments for indexing — the street
is still evidence — so **95.45% of segments yield at least one address**.

**Data-quality note:** rows with an empty `pt_name` exist (2026-02-03, sector 6). They carry zones
but no thermal point, so they cannot enter the index.

## 7. The decided model

- **Key** is `(street, block)`, street-type-insensitive. A block token indexes if it bears a digit
  or is a single letter, unless it is on the institution stop-list, is itself only a staircase
  reference, or is a bare letter continuing a staircase run. Block suffixes are never normalized
  away — `4` and `4Bis` are different buildings.
- **Every street label a block has carried is a search alias.** Drift is never narrated.
- **Lookup returns a list**, always: length 1 for 97.78% of addresses, 2–4 for the 216 concurrent
  cases (211 carry two candidates, 15 carry three, one carries four), and a time-disjoint pair with
  date spans for the 11 migrations. Candidate records are shown separately, never merged — a union
  overstates and an intersection understates.
- **A miss is an outcome, not a failure.** The index covers only addresses that have had a published
  outage, and it is saturated: 88.2% of addresses were seen by 2022-04 and only 2.0% first appeared
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
- **Known defects left unfixed**, for whoever implements: `Str Băiculeşti - bl .A3` loses its block
  to a stray space after `bl` (1,313 observations), and single letters must be classified by
  `parseZone`, never by `isBlockLabel` alone — the staircase rule is positional and the predicate
  cannot see position.
- **Unmeasured here:** what the alias table costs on published figures. It changes identity, and ADR
  0002 requires that fold to land before the first published on-time figure.
