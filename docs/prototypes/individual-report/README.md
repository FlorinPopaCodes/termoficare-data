# Prototype: the individual report

Throwaway. Three structurally different address pages over the same real data, so
[#58](https://github.com/FlorinPopaCodes/termoficare-data/issues/58) is decided by looking
rather than by describing. Nothing here is meant to be promoted; the decision is, the code
is not.

```
deno run --allow-read --allow-write --allow-run=git docs/prototypes/individual-report/prep.ts
deno run --allow-read --allow-write docs/prototypes/individual-report/render.ts
open docs/prototypes/individual-report/index.html
```

`prep.ts` takes ~2 min (two passes over all 56 monthly CSVs). `render.ts` is instant.
`index.html` is self-contained — no server, opens off the filesystem.

**← / → or the arrows switch variant. The dropdown switches address.** Six addresses, one
per case [#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56) defined, plus
one that is out right now so the live half of the page has something to say.

## The three variants

| | shape | leads with |
| --- | --- | --- |
| **A — Jurnal** | live banner, then the whole record as a reverse-chronological feed | what happened |
| **B — Fișă** | live strip, four stat tiles, month × year heatmaps, record behind a disclosure | the numbers |
| **C — Întrebări** | the resident's questions in order, one answer and one basis line each | the reader's question |

They disagree on purpose, on four things the ticket has to settle:

1. **Whose record is it.** A shows the thermal point's whole history; B clips it to the span
   that point actually served this block; C shows only the point serving it now and puts the
   retired one in a footnote. Visible on **Doamna Ghica bl. 15**, where the retired point kept
   having outages for four years after the block left it.
2. **Whether an on-time _rate_ may appear.** A never states one — only per-episode verdicts
   ("termenul de 22 iun 2026 a trecut neonorat"). B states it as a percentage beside the city
   figure. C states it as a count of misses. All three are readings of the same
   [ADR 0001](../../adr/0001-strict-estimate-scoring.md) scoring;
   [ADR 0003](../../adr/0003-claim-only-what-the-record-positively-shows.md) is what makes the
   choice non-obvious.
3. **How 2–4 concurrent candidates are presented.** A stacks the records; B puts them behind
   tabs; C refuses to answer until the reader picks one. **Doamna Ghica bl. 3** carries three.
4. **How loud "we only know what CMTEB published" is.** A: a basis line under each record.
   B: a basis line under the tiles. C: its own closing section, `Ce nu putem spune`.

## What the data is

Real, and not what the site publishes today. Identity is
[ADR 0002](../../adr/0002-thermal-point-identity-by-canonical-name.md) as amended by
[#64](https://github.com/FlorinPopaCodes/termoficare-data/issues/64), **plus the alias table
from [#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56)** — the fold
[#71](https://github.com/FlorinPopaCodes/termoficare-data/issues/71) and
[#72](https://github.com/FlorinPopaCodes/termoficare-data/issues/72) will land. So every
figure is a preview of post-fold numbers.

`prep.ts` reuses the real derivation (`src/derive.ts`) rather than re-implementing episode
bridging: it rewrites each observation's `(sector, pt_name)` to the decided identity and
feeds the rewritten stream to `deriveDatasets`. Two checks fell out of that and are worth
recording:

- The address index reproduces
  [`docs/research/address-resolution/`](../../research/address-resolution/README.md) exactly
  — **10,205 addresses, 1,182 streets**.
- Applying the alias table to the corpus gives **1,036 identities**, which is exactly the
  per-PT page count [#64](https://github.com/FlorinPopaCodes/termoficare-data/issues/64)
  predicted as `1,058 − 22` and
  [#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56) then doubted, on the
  grounds that the subtraction assumed a fold ADR 0002 does not perform. Computed rather than
  subtracted, the two agree. This is the identity count only — the published delta is still
  [#72](https://github.com/FlorinPopaCodes/termoficare-data/issues/72)'s to measure.

Colors are the `dataviz` reference palette; the ACC/INC pair was run through its validator
and passes every gate in both modes. Each utility keeps one hue everywhere on the page —
chip, heatmap, duration bar — so color follows the entity rather than the chart.

## Things the prototype surfaced that no variant fixes

- **The index keys are diacritic-folded, so the page has no display form for a street name.**
  Every heading here reads `Dorobantilor`, not `Dorobanților`. The fold is deliberate in
  [#56](https://github.com/FlorinPopaCodes/termoficare-data/issues/56) (it is what makes
  spelling variants searchable) but it means a display name has to come from somewhere else.
- **The street→PT list on the miss page is often unusable.** On `unirii` it reads `V.s.sud`,
  `Vsnord`, `Tribunal`, `E1`, `C.c.`, `P. M.` — institutional and cryptic labels offered to a
  resident as "one of these serves you". The miss path is a first-class page, but this is not
  yet a first-class answer.
- **A feed at real density is very long.** 146 episodes is an ordinary address; the heaviest
  in the corpus has 436. Variant A truncates at 120 and says so.
- **`10 Vitan` shows 29 outages in 12 months against a city mean of 27.7.** The comparison is
  arithmetically fine and rhetorically loaded, and only variant B makes it.
