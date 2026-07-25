# `zone_raw` block-token grammar and street-label drift

Research findings for [#53](https://github.com/FlorinPopaCodes/termoficare-data/issues/53).
Direct analogue of [html-variants.md](https://github.com/FlorinPopaCodes/termoficare-data/blob/research/html-variants/docs/research/html-variants.md),
for the affected-zones text rather than the page markup.

**Headline:** after folding the thermal-point name variants, **97.2% of
(street, block) addresses resolve to exactly one thermal point**, and blocks
essentially do not migrate between thermal points — 42 cases city-wide over
4.5 years. Address→PT resolution can be a static lookup; it does not need to be
time-dependent.

## Method

Full scan, no sampling. All 56 monthly CSVs under `data/observations/`,
**2,185,379 observations**, 2021-12-19 → 2026-07-25, collapsed to
**8,691 distinct `(sector, pt_name, zone_raw)`** keys carrying observation
counts and the set of days each was live. Every share below is
**observation-weighted** — the distinct-string basis used during charting has no
time axis and over-weights rare strings.

Corpus shape: 8,251 distinct `zone_raw`, 1,732 distinct raw `pt_name`,
1,245 distinct raw street strings, 18,845 bullet segments.

## 1. The grammar

    zone_raw   := segment ( "•" segment )*
    segment    := TYPE " " street " - " blocklist
    blocklist  := token ( ("," | ";") token )*
    token      := [prefix] block-identifier

Verified, not assumed:

- **Every** one of the 8,691 keys contains `•`. No un-bulleted variant exists.
- **Every** one of the 18,845 segments begins with one of ten street-type tokens —
  a genuinely closed set, zero exceptions:
  `Str` 11,904 · `Ale` 2,528 · `Bld` 2,062 · `Şos` 1,022 · `Cal` 685 ·
  `Int` 363 · `Drm` 121 · `Prl` 70 · `Spl` 69 · `Pţa` 21.
- **` - ` (spaced hyphen) separates street from block list**, and occurs exactly
  once in 18,304 segments. The exceptions are benign:
  - 521 segments have **zero** — they end in a dangling `-` with the block list
    missing (`Str Popa Lazăr -`).
  - 20 segments have **two** — an ` - instituţie` suffix
    (`Str Izvor - Nr. 13-15 - instituţie`).

  Splitting on the **first** ` - ` is correct in every case; no street name in the
  corpus contains a spaced hyphen.
- Both `,` and `;` appear as block separators, sometimes in the same corpus week
  (see §5).

## 2. Block-token taxonomy

Prefixes stripped before classification (`bl.`, `bl`, `Bl.`, `BL.`, `imob.`,
`imobil`, `Nr.`, `nr.`, `no.`), longest-first — `imobil 3` must not be eaten by
the `imob` alternative, and `imob.Nr.56` carries two prefixes.

Over **24,669,893 observation-weighted token instances**:

| ✓ | class | distinct | obs-weight | share | examples |
|---|---|---:|---:|---:|---|
| R | `simple_number` | 21,594 | 12,523,590 | 50.76% | `2`, `3`, `1`, `5` |
| R | `letter_block` | 20,334 | 9,418,238 | 38.18% | `A1`, `A2`, `B`, `C` |
| R | `alpha_num_block` | 2,010 | 626,285 | 2.54% | `OD1`, `OD5`, `PC9` |
| – | `other_unparsed` | 1,635 | 543,988 | 2.21% | `3IRTA`, `SERBANESCU 12-14` |
| – | `institution_named` | 526 | 244,529 | 0.99% | `Gradinita nr.224`, `Camin C7 (Bl.T29)` |
| R | `hyphen_compound` | 421 | 224,422 | 0.91% | `17-18`, `20-I`, `404-405` |
| R | `number_qualifier` | 285 | 216,106 | 0.88% | `4Bis`, `29Bis`, `5E PRIM` |
| R | `block_plus_stair` | 588 | 191,835 | 0.78% | `3A SC.B`, `1 SC.D`, `T50 sc.2` |
| – | `MISSING` (dangling `-`) | 521 | 144,501 | 0.59% | — |
| R | `alnum_block` | 381 | 143,466 | 0.58% | `5A1`, `35B2`, `41BC` |
| – | `bare_name` | 271 | 132,961 | 0.54% | `TEI`, `STAR`, `ARMONIA` |
| R | `block_slash` | 989 | 112,055 | 0.45% | `K/4/1`, `MIIB8/2`, `M1/2` |
| R | `multi_block_plus` | 153 | 102,903 | 0.42% | `14D+14E`, `7A+7B`, `15+16` |
| – | `prefix_only` | 276 | 27,836 | 0.11% | `bl.`, `BL.`, `Imobil` |
| – | `missing_comma_artifact` | 16 | 12,598 | 0.05% | `16 63`, `70 72`, `204 205` |
| – | `stray_punctuation` | 2 | 4,580 | 0.02% | `. 44`, `. 56` |

**Resolvable to a block identifier: 95.50% of token volume.** The 4.50%
remainder is 1.53% institutional (§4), 0.59% dangling block lists, 0.11%
prefix-with-no-value, 0.07% data-entry damage, and a 2.21% `other_unparsed`
residue across 692 distinct cores — mostly composite estate labels
(`3IRTA`, `64ABC`, `5E PRIM`, `A1Prim`, `L109bis`, `Plomba 12`) that are stable
strings and could be matched literally rather than parsed.

Two classes deserve attention when building the index:

- **`number_qualifier`** — `4Bis`, `52Bis`, `19NOU`, `12 Nord`. These are real,
  distinct blocks; `4` and `4Bis` are different buildings. Do not normalize the
  suffix away.
- **`missing_comma_artifact`** — 16 cores like `16 63` and `70 72` are two block
  numbers with the comma omitted at data entry. Splitting them recovers real
  blocks; leaving them produces a phantom.

## 3. Street-label drift, and whether blocks move between thermal points

### 3.1 Street labels do drift, but modestly

On a normalized basis (diacritics folded, ` - Partial` stripped) there are
**10,216 (sector, PT, block) triples**; **615 (6.0%)** ever carry more than one
street label. Of the two-label cases, **214 are clean hand-offs** (the old label
never returns) and **365 are interleaved** (both labels remain in use).

Of the 615, **96 are street-*type*-only drift** — same name, different prefix
(`Str Tohani` → `Ale Tohani`) — and **519 are genuine name changes**. Street-type
must therefore be ignored when matching, not just street name.

Clean hand-offs by month: **2022-02 (91)**, 2022-04 (31), 2023-07 (20),
2022-07 (9), 2022-11 (9), 2022-03 (8). So this is **not one bulk relabel** —
it is two waves in early 2022 plus a smaller 2023-07 wave and a continuing
trickle.

The renames are municipal decommunization, not CMTEB bookkeeping:

| block | old label | new label | boundary |
|---|---|---|---|
| `1 Dimitrov` O12/O13/O14 | `Bld Dimitrov Gheorghe` | `Bld Ferdinand I` | 2022-02-16 |
| `3 Tineretului` 69A | `Str Cuza Vodă` | `Str V. V. Stanciu` | 2022-02-03 |
| `1 Teiul Doamnei` 25 | `Str Rondul Bisericii` | `Str Petre Antonescu` | 2022-02-16 |
| `6 Zona I` A17 | `Str Lt. Col. Dumitru Petrescu` | `Str Turnu Măgurele` | 2022-02-08 |

### 3.2 Correction to the map's worked example

The map records both `6 Aviatiei` blocks as relabels. Only one is:

| block | label | live range | obs |
|---|---|---|---|
| `20A` | `Str Liliacului` | 2021-12-21 .. **2022-04-01** | 418 |
| `20A` | `Str G-ral Ştefan Burileanu` | **2022-04-04** .. 2026-07-25 | 5,933 |
| `20F` | `Str Zăgazului` | 2021-12-21 .. 2022-04-01 | 418 |
| `20F` | `Str Smaranda Brăescu` | **2021-12-21** .. 2026-07-25 | 6,351 |

`20A` is a clean hand-off at the 2022-04 boundary, as the map says. **`20F` is
not** — `Str Smaranda Brăescu` runs from the very first day and `Str Zăgazului`
runs alongside it until 2022-04. That is the interleaved pattern, not a
migration, and it is the more common of the two (365 vs 214).

### 3.3 Blocks do **not** meaningfully move between thermal points

This is the question the address model hangs on, and the raw answer is badly
misleading. Measured three ways:

| PT identity used | (street, block) addresses | resolve to exactly 1 PT |
|---|---:|---:|
| raw `pt_name` | 9,698 | 2,568 (**26.5%**) |
| + fold ` - Partial`, diacritics | 9,656 | 8,731 (**90.4%**) |
| + fold all name variants (§3.4), ignore street type | 9,535 | 9,269 (**97.2%**) |

The 26.5% figure is an artifact of thermal-point *naming*, not of buildings
changing supplier. Almost every apparent "migration" at the raw level is a PT
alias: `D Chibrit` vs `D Chibrit - Partial`, `2 Lânăriei` vs `2 Lanariei`,
`4' Pantelimon` vs `4 Pantelimon`, `SC 6/2` vs `SC 6/2 - MODULE TERMICE`.

At full folding only **266 addresses (2.8%)** touch more than one PT, and of
those only **42 are time-disjoint** — a genuine migration, one PT handing a block
to another. The other 224 are concurrent: the same address served by two PTs in
overlapping periods, concentrated on long arteries where a block label repeats
(`Bld Iuliu Maniu` bl `3` sits under both `1 Placare` and `1 Veteranilor`).

**Consequence: address→PT resolution can be a static lookup.** A time-dependent
index would buy 42 addresses out of 9,535 and cost a time dimension on every
lookup. Better to resolve to the current PT and, for the 224 concurrent cases,
carry a small candidate list rather than pretend to a single answer.

### 3.4 Thermal-point name variant families

Falls out of the above and is an input to
[Decide the thermal-point identity model](https://github.com/FlorinPopaCodes/termoficare-data/issues/55).
**1,732 raw names fold to 1,028 identities**; 587 folded groups cover more than
one raw spelling:

| groups | variation | example |
|---:|---|---|
| 530 | ` - Partial` only | `D Chibrit` / `D Chibrit - Partial` |
| 23 | ` - Partial` + diacritics | `2 Lanariei` / `2 Lânăriei` / `2 Lanariei - Partial` |
| 15 | ` - Module Termice` + Partial | `SC 6/2` / `SC 6/2 - MODULE TERMICE` / … (4 spellings) |
| 9 | `-T` suffix + `MILITARI - ` prefix + Partial | `1 Placare` / `1Placare` / `1Placare-T` / `MILITARI - 1 Placare` (8 spellings) |
| 6 | apostrophe + Partial | `2-1 Mai` / `2’-1 Mai` |
| 2 | `MILITARI - ` prefix + Partial | `3A Placare` / `MILITARI - 3A Placare` |
| 1 | spacing | `Bl. 100` / `Bl.100` |
| 1 | case | `MAPN` / `MApN` |

So ` - Partial` is the dominant variant axis but **not the only one** — the map's
~1,170 figure counts Partial-folding alone; folding diacritics, apostrophes,
casing, the `-T` suffix, the `MILITARI - ` prefix and ` - Module Termice` brings
it to **1,028**. Whatever identity rule #55 picks has to handle six axes, not one.

**Sector is not a stable attribute of a thermal point.** 74 of 1,732 raw names
appear under more than one sector — `Ct B1 Dimitrov` under 1, 2 and 3;
`Ct Viilor - Partial` under 1, 4 and 5; `Tribunal` under 3 and 5. Any key that
includes sector will split these.

## 4. Block-label collisions

3,403 distinct block labels citywide. The bare numbers are heavily reused:

| label | distinct streets | distinct PTs |
|---|---:|---:|
| `2` | 129 | 212 |
| `3` | 127 | 215 |
| `1` | 109 | 202 |
| `6` | 94 | 162 |
| `4` | 91 | 167 |

**65.5%** of block labels (2,230 of 3,403) appear on only one street, but those
are the long-tail estate codes (`OD18`, `MIIB8/2`). The high-volume labels — plain
small integers, 50.76% of all token volume — collide heavily.

**A block label alone is never a key.** The lookup key is `(street, block)`, which
resolves to a single PT 97.2% of the time. Sector does not help: of the 925
multi-PT addresses at the mid-folding level, 46.8% have all their candidate PTs
inside the *same* sector.

## 5. Scope: institutions are separable

`institution_named` + `bare_name` = **1.53% of token volume** (526 + 271 distinct
cores). These are the no-digit and named entries — `Instituție`, `Policlinica
Teius`, `Liceul Mihai Eminescu`, `Comunitatea Musulmană`, `Unicredit Bank`,
`Cresa Sf. Stelian` — plus estate names used as block labels (`TEI`, `STAR`,
`ARMONIA`, `Casata`, `Perla`).

Confirmed: **dropping them costs no residential coverage.** They are a separate
population from the numbered blocks, not a mislabelled subset of them. Note the
boundary is fuzzy in one direction only — a handful of `bare_name` entries are
surnames (`Ioniţă`, `Decu Aurel`, `Lungu Smaranda`), likely single-family
buildings, which the flats-only scope excludes anyway.

## 6. The 2022-03 format flapping is not what it looked like

The charting note flagged `5 Aviatiei` alternating between `bl.`-style and
`;`-style over 2022-03-19 → 2022-03-21, with three hypotheses: two CMTEB editors,
a page alternating between sources, or a parser artifact. **None of them.**

Over 2022-03-15 → 2022-03-25 the PT has 99 rows: 77 `bl.`-and-comma, 16
bare-and-semicolon, 6 neither. Splitting by content rather than by date shows
they are **different outages**:

- `bl.`-style rows list `Str Cpt. Alexandru Şerbănescu` + `Str Siriului`.
- `;`-style rows list `Str Bujorului` and `Str Maior Cocovici` — a disjoint set of
  streets.

Only 2 of the 33 snapshots in the flapping window carry more than one row for
this PT, and in both the two rows are **byte-identical duplicates**. So the styles
never coexist within one entry; they belong to successive, separately-authored
disruption entries at the same thermal point.

**The style travels with the data-entry event, not with the PT and not with the
date.** Both styles are in use in the same week elsewhere in the corpus. A parser
cannot switch format on PT, on date, or on an era boundary — it must accept every
form unconditionally.

**Data-quality note:** exact duplicate rows within a single snapshot exist
(`5 Aviatiei` at `2022-03-19T07:00:01`). Anything counting rows per snapshot
should dedupe.

## 7. What this settles, and what it hands on

Settled:

- The grammar is regular and fully specified (§1); a parser needs one closed set
  of 10 street types, a first-` - ` split, and `[,;]` tokenization.
- 95.50% of block-token volume is resolvable to a block identifier (§2).
- The address key is `(street, block)`, street-type-insensitive, and it resolves
  to one PT 97.2% of the time (§3.3, §4).
- Resolution does **not** need a time dimension — 42 real migrations citywide (§3.3).
- Institutions are 1.53% of volume and cleanly separable (§5).
- Format style is per-entry and unpredictable; parse permissively (§6).

Handed on:

- **To [#55](https://github.com/FlorinPopaCodes/termoficare-data/issues/55) (identity model):** PT naming varies on **six** axes, not just
  ` - Partial`; full folding gives 1,028 identities, not ~1,170. Sector is not
  stable per PT (74 names span sectors) — a `(sector, pt_name)` key splits them.
- **To [#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56) (address→PT model):** a static `(street, block)` → PT lookup is
  viable at 97.2%; the residue is 224 genuinely-ambiguous addresses needing a
  candidate list and 42 historical migrations that can be resolved to their
  current PT.
