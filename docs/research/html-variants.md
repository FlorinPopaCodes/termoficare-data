# HTML structural variants of `data/termoficare.html` across scrape history

Research for [#4](https://github.com/FlorinPopaCodes/termoficare-data/issues/4), part of the
[data-foundation wayfinder map](https://github.com/FlorinPopaCodes/termoficare-data/issues/3).

## Method

The scrape history is `data/termoficare.html`, touched by **26,587 commits** from
`2b7c3ae16` (2021-12-19T21:17:32) to `f3d265d49` (2026-07-15T17:52:59), authored by
`Archive Bot` / `flat-data` every ~15–120 min.

Two passes were run, both exhaustive (all 26,587 revisions, not sampled), using
`git cat-file --batch` streaming — cheap enough (~13–21s each) that sampling turned out to
be unnecessary for the structural question:

1. **Skeleton scan** — for every revision, extracted: number of `table.raport` blocks,
   each table's `class` attribute + header-cell text, presence of the `Eroare de conexiune`
   error string, presence of the `Nu există înregistrări` empty-state string, and whether
   `<meta charset="utf-8">` is self-closed (`/>`, old markup) or not (`>`, current markup).
   This produced the canonical list of **16 distinct structural signatures** (script:
   `skeleton_scan.py`, not checked in — scratch tooling).
2. **Vocabulary scan** — for every revision with at least one table, parsed every data row
   of the "Toate sectoarele" table and tallied: `Agentul termic afectat` values, whether
   `Zone afectate` always starts with `Punct termic:`, the bullet separator used in the
   street list, keyword hits in `Cauza`, and the shape of the `Data/ora estimării` cell.

55 additional point-in-time samples (first commit of each calendar month, Dec 2021 →
Jul 2026) were pulled with `git show` for human-readable spot checks and to confirm the
scan's regex against real markup; a handful of extra samples were pulled around the
smallest and largest blob sizes in the whole history to find garbage/error pages and the
largest-incident-count snapshot. Nothing was skipped — the exhaustive scans cover every
commit that touched the file.

## Headline finding: the column schema has never changed

Across all 26,587 revisions there is exactly **one** table markup and header set:

```html
<table class='table table-condensed table-hover raport'>
<tr>
    <th> Sector </th>
    <th> Zone afectate </th>
    <th> Agentul termic afectat </th>
    <th> Cauza / Descrierea intervenției </th>
    <th> Data/ora estimării punerii în funcțiune </th>
</tr>
```

No column was ever added, removed, renamed, or reordered. The parser needs exactly one
row-shape. Everything else that varies is (a) cosmetic markup style, and (b) which of the
7 possible `table.raport` blocks are present on a given snapshot — driven entirely by
which sectors currently have zero incidents.

## (a) Distinct table/column structures, with SHA + date range

Two **markup eras**, split by whether HTML5-void-element tags are self-closed:

| Era | Date range | Example commit | Marker |
|---|---|---|---|
| **Old (XHTML-style)** | 2021-12-19 → 2022-11-17 09:00 | `5ce1e7bd2` | `<meta charset="utf-8" />`, `<br/>` |
| **New (HTML5-style)** | 2022-11-17 10:00 → present (2026-07-15) | `f3d265d49` | `<meta charset="utf-8" >`, `<br>` |

Transition commit: **`7de26516eab1ef367fca92f75097b91a544f4958`** (2022-11-17 10:00:01
+0200) — a pure whitespace/self-close-tag rewrite (27 insertions / 30 deletions across
the whole boilerplate), not a content or column change. A parser using tag-agnostic
regex/HTML-parser matching won't even notice this boundary, but a naive `<br/>`-only
regex would silently drop rows before this commit.

Within each era, table *count* ranges 0–7 depending on how many sectors have incidents
that snapshot (see below) — that's not a column-structure variant, just row-cardinality.
Combining era × table-count gives the 16 raw signatures found by the scan; the ones that
matter for fixtures are collapsed in the "Recommended fixture list" section.

Table-count distribution (all eras combined, exhaustive count over 26,587 revisions):

| `table.raport` count | Meaning | Snapshots | % |
|---|---|---|---|
| 7 | all 6 sectors + "Toate sectoarele" have ≥1 row | 13,163 | 49.5% |
| 6 | 1 sector empty | 6,734 | 25.3% |
| 5 | 2 sectors empty | 3,533 | 13.3% |
| 4 | 3 sectors empty | 1,846 | 6.9% |
| 3 | 4 sectors empty | 998 | 3.8% |
| 2 | 5 sectors empty (only "Toate" + 1 sector table render) | 267 | 1.0% |
| 0, non-error | **all** sectors empty (system-wide zero incidents) | 42 | 0.16% |
| 0, error page | scrape captured a backend error, not the real page | 4 | 0.015% |

Key implication: **a sector tab with zero incidents does not render an empty `<table>`
with just a header row — the whole `<table>` element is omitted** and replaced with
`<div class='flag-galben'> Nu există înregistrări pentru sectorul N. </div>`. A parser
that assumes "always 7 tables" will break on 50% of snapshots.

## (b) Is "Toate sectoarele" a union of the per-sector tables?

**Yes — verified as an exact multiset union with zero exceptions**, checked across 57
samples (all 55 monthly samples + the largest-incident snapshot + current), including
the biggest observed snapshot (39 rows, 2023-08-03T19:00 UTC+2, SHA `20e267f80`): row
count in "Toate sectoarele" always equals the sum of row counts across the per-sector
tables, and the multiset of `(Sector, Zone afectate, Agentul termic afectat, Cauza,
Data/ora estimării)` tuples is identical between the union table and the concatenation of
per-sector tables in every sample checked. No row was ever found only in "Toate" or only
in a per-sector tab.

**Recommendation for the parser**: parse only the first `table.raport` block
("Toate sectoarele", `id="ST"`) and read `Sector` from its own column. The other 6 tables
are a pure display convenience (Bootstrap tab panes) and can be ignored entirely —
this also sidesteps the whole "how many tables are present" problem, since the
"Toate sectoarele" table (or its `flag-galben` empty-state div) is *always* present,
even when every sector is at zero.

## (c) Zero-incident / empty snapshots

When a sector currently has no open incidents, its tab pane's `<table>` is entirely
replaced by:

```html
<div id="ST" class="tab-pane fade in active">
	<div class='flag-galben'> Nu există înregistrări pentru niciun sector. </div>    </div>
```

(for "Toate sectoarele" specifically — note the singular "niciun sector" wording), or

```html
<div id="S3" class="tab-pane fade">
	<div class='flag-galben'> Nu există înregistrări pentru sectorul 3. </div>
</div>
```

for an individual sector (note the per-sector message says "sectorul N", not "niciun
sector"). This banner string has been present verbatim since the very first commit
(2021-12-19); it never changed wording.

A genuine **system-wide zero-incident snapshot** (all `flag-galben`, zero `table.raport`
elements) happened 42 times across 4.5 years (0.16% of snapshots) — e.g. New Year's Day
2025: `1597cf670d7f3a6a61ee9d693b03cd65515024f1` (2025-01-01T01:00:01, 25,651 bytes, no
tables at all, six `flag-galben` divs). These are legitimate "nothing broken" states, not
errors — file size is smallish (~25–30 KB) but not tiny, because boilerplate + footer +
legend text is unchanged.

## (d) Error / maintenance / garbage pages

**4 out of 26,587 revisions (0.015%)** captured something other than real page content —
all are backend API failures leaking into the static HTML, not page redesigns or
maintenance banners:

| SHA | Date | Size | Content |
|---|---|---|---|
| `af150f8cb07380e5eb3783ae8ef0bd73f48d6210` | 2022-03-07T06:00:01 | 12,946 B (smallest file in history) | `Eroare de conexiune: Failed connect to avarii-api.cmteb.ro:443; No route to host` appended after `</html>` |
| `82c32eda0ccda89383437a4ba3923a14d9550826` | 2023-06-26T07:00:01 | 13,113 B | `Eroare de conexiune: Could not resolve host: avarii-api.cmteb.ro; Unknown error` |
| `3fc1572eedb7e80361d0af7f74afa98da72a621c` | 2025-08-10T07:00:01 | 13,472 B | same DNS-resolution error |
| `4635103e92b7420c71f390caae3a8e4a8f5cb39c` | 2025-08-13T06:00:01 | 13,472 B | same DNS-resolution error |

In all four cases the outer page (nav, footer, meta) rendered fine but the incident
data was sourced from a separate internal API (`avarii-api.cmteb.ro`) that the page
proxies/embeds server-side, and that backend was unreachable at scrape time. The
signature is unmistakable and cheap to detect: **file size <15 KB and zero
`table.raport` elements and zero `flag-galben` divs** (as opposed to a genuine
empty-incidents page, which is ~25–30 KB because the full footer/legend still renders).
No case of a CMTEB-side maintenance page, HTTP error page, or full page redesign was
found anywhere in the 26,587-revision history — the page's outer chrome (nav, hero,
footer, cookie modal) is otherwise remarkably stable for 4.5 years.

## (e) "Zone afectate" cell formats over time

Format is **100% consistent** across all 467,518 data rows ever scraped:

```
Punct termic: <strong>{PT NAME}</strong> -- {N} blocuri/imobile<br>&bull; {street 1}<br>&bull; {street 2}<br>...
```

- `Punct termic:` prefix: present in every single row (467,518/467,518) — zero exceptions.
- Street-list separator: `&bull;` in every row that has one — no alternate separator
  (comma-list, semicolon, `<li>`) ever observed.
- `PT NAME` free text varies (e.g. `2'-1 Mai`, `bloc 1, bloc 2 (cod PT: 50039)`,
  `SC.1Dudesti - Partial`, sometimes trailing ` - Partial` to indicate partial outage of
  that PT's service area) — this is genuinely free text from CMTEB's asset naming, not
  worth trying to structure further at the foundation layer (per issue #3's "out of
  scope": street/block explosion is a downstream concern).
- **Edge case — negative block counts**: 20 rows across history (e.g.
  `-6 blocuri/imobile` on `af84517098`/2026-02-06, `-1 blocuri/imobile` on
  `1e8978c5a3`/2025-04-16) — a CMTEB data-entry bug, not a scrape artifact (same value
  repeats identically across many consecutive 15-min scrapes, so it's baked into their
  source data for hours at a time). A parser using `\d+` for the block count will simply
  fail to match these rows; decide explicitly whether to coerce to `abs()`, null, or skip.

## (f) "Data/ora estimării" timestamp format and drift

Format is **`DD.MM.YYYY HH:MM`** (e.g. `19.12.2021 23:00`) in 466,660 / 467,518 rows
(99.8%) — no format drift across the whole 4.5-year history, no ISO-8601, no timezone
suffix, no seconds component, ever.

**Edge case — literal `Nedefinit`**: 858 rows (0.18%) contain the literal string
`Nedefinit` ("undefined") instead of a timestamp — meaning CMTEB has not yet given an
estimated fix time for that incident. First seen `2022-02-15` (`eb87d333c`), still
occurring as of the most recent scrape (`dc8032ca3c`, 2026-07-09) — this is a
long-standing, ongoing value, not a one-off. **The observation schema must treat this
column as nullable/optional, not always-parseable-as-datetime.**

No timezone is present in the raw string; the source is CMTEB's Bucharest-local time
(EET/EEST, UTC+2/+3) inferred from the scrape's own commit timestamps, which are
consistently `+0200`/`+0300` — worth confirming explicitly in the schema ticket rather
than assumed here.

## (g) Planned-works vs unplanned-outage distinction

The page has **never** had a separate table, tab, or section for planned maintenance vs
unplanned breakdowns — it's a single "avarii" (incidents) feed, confirmed by the page's
own static banner text (`anunță oprirea agentului termic, pentru remedierea avariilor
apărute în rețeaua termoficare`), unchanged since the first commit.

However, the `Agentul termic afectat` and free-text `Cauza` columns let you *infer* the
distinction:

`Agentul termic afectat` is a closed 6-value enum, stable for the entire history
(counts over all 467,518 rows):

| Value | Count | % |
|---|---|---|
| `Oprire ACC` | 249,120 | 53.3% |
| `Oprire ACC/INC` | 78,330 | 16.8% |
| `Deficienta ACC` | 43,156 | 9.2% |
| `Deficienta INC` | 35,811 | 7.7% |
| `Deficienta ACC/INC` | 32,243 | 6.9% |
| `Oprire INC` | 28,858 | 6.2% |

(ACC = apă caldă de consum / domestic hot water, INC = încălzire / heating — this
distinction is confirmed by the page's own legend text, also unchanged since 2021.)

`Cauza` free text keyword hits (not mutually exclusive, same row can match several):

| Keyword | Rows | Reading |
|---|---|---|
| `remediere avarie` | 212,046 | unplanned breakdown repair |
| `lucrari de` / `lucrări de` | 35,606 | planned works (modernizare, înlocuire conductă, etc.) |
| `revizie` | 16,299 | scheduled inspection/maintenance |
| `programat` | 1,102 | explicitly "scheduled" |
| `deficien` | 304 | (rare — `Cauza` itself restating a deficiency, distinct from the `Agentul termic afectat` enum value) |

**Recommendation**: don't build a planned/unplanned boolean at the foundation layer from
this free text — it's a downstream classification problem (keyword lists will drift and
miss cases). Store `Agentul termic afectat` as a closed enum column and `Cauza` as raw
text; let a later derivation layer build a planned/unplanned heuristic if needed.

## Recommended regression-test fixture corpus

One fixture per row, each earning its place for a distinct reason a naive parser would
mishandle:

| # | SHA | Date | Why it's a fixture |
|---|---|---|---|
| 1 | `2b7c3ae1606c849186fe89572845fb6606222c60` | 2021-12-19T21:17:32 | Very first scrape ever; old (self-closed) markup era; baseline sanity check. |
| 2 | `5ce1e7bd26a27a1f1958b20e79e4f37c5abcb20b` | 2022-11-17T09:00:01 | Last snapshot of the old-markup era, immediately before the markup rewrite. |
| 3 | `7de26516eab1ef367fca92f75097b91a544f4958` | 2022-11-17T10:00:01 | First snapshot of the new-markup era — the transition commit itself. |
| 4 | `09c484cfca826fcbd6aa7ebe7fffccea2e00ec04` | 2026-07-15T08:01:42 | Current/most-recent shape, 7 tables, full sector spread — "happy path". |
| 5 | `1597cf670d7f3a6a61ee9d693b03cd65515024f1` | 2025-01-01T01:00:01 | Genuine system-wide zero-incident snapshot — zero `table.raport`, six `flag-galben` divs. Must not be parsed as an error. |
| 6 | `af150f8cb07380e5eb3783ae8ef0bd73f48d6210` | 2022-03-07T06:00:01 | Smallest file in history (12,946 B) — `avarii-api` connection error ("No route to host") captured mid-scrape. Must be detected and rejected/retried, not parsed as zero-incidents. |
| 7 | `82c32eda0ccda89383437a4ba3923a14d9550826` | 2023-06-26T07:00:01 | Same error class, different message ("Could not resolve host") and different era spacing (over a year after fixture 6) — confirms the error class recurs and the detection rule generalizes. |
| 8 | `20e267f80181f8438b0f8c17aa97b5a0400d60e0` | 2023-08-03T19:00:01 | Largest incident count observed (39 rows in "Toate sectoarele", 281,390 B) — stresses row-count handling and the union-table assumption under load. |
| 9 | `6ca5d0e5a9a962345cc7377ce365855325f3ce50` | 2022-08-01T00:00:01 | All 7 tables present (every sector has ≥1 incident) with only 24 rows — a "normal busy day" mid-size fixture distinct from the extreme in #8. |
| 10 | `af84517098d776ba9f7a3fc32153eec9ebd81e1a` (or `1e8978c5a3dd7c5423f544dab4a4e1f7a0453fad`) | 2026-02-06T16:04:50 (or 2025-04-16T14:00:01) | Negative `blocuri/imobile` count (`-6`, `-1`) — data-quality edge case in `Zone afectate`, breaks a naive `\d+` block-count regex. |
| 11 | `eb87d333c5f2f0dc355cde108230c211d32470f6` (or `dc8032ca3c8ea79ba226e867286674ff96aa535e`) | 2022-02-15T12:00:01 (or 2026-07-09T11:33:16) | `Data/ora estimării` = literal `Nedefinit` instead of a parseable timestamp — must make the column nullable. |

Fixtures 1–4 anchor the two markup eras and the boundary between them; 5–7 anchor the
"nothing to report" and "scrape failed" edge cases that a naive implementation is most
likely to conflate; 8–9 anchor row-count extremes; 10–11 anchor per-cell data-quality
edge cases inside an otherwise well-formed row. This set is deliberately small (11
fixtures) because the exhaustive scan found only 16 raw structural signatures total and
the column schema never changed — there's no long tail of additional table/column shapes
to cover.

## What was not exhaustively checked

- The **per-sector tab tables** (tables 1–6) were spot-checked against the union claim
  on 57 samples, not all 26,587 revisions — the union scan is O(rows²) per revision and
  wasn't worth running at full scale given zero exceptions across the sample and the
  static boilerplate confirming they're rendered from the same underlying incident list
  as "Toate sectoarele" (same PHP tab-content block, same JSON source per the
  `<!-- start: continut fisier JSON -->` comment in the markup).
- Non-incident parts of the page (nav menu, footer contact info, the SCADA-coverage
  paragraph's "836 din totalul celor 1027 puncte termice" sentence) were not scanned for
  drift — out of scope for the observation schema, and the wayfinder map already scopes
  street/block detail out of the foundation dataset.
- Commit-timestamp timezone handling (`+0200` vs `+0300` DST transitions in the scrape
  history vs. the `Data/ora estimării` cell's implied local time) was noted but not
  resolved — the map's "Not yet specified" section already flags this as its own
  decision.
