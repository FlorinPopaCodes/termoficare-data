# Thermal-point identity by canonical name

A thermal point is identified by its canonical name alone, and sector is not part of that identity. CMTEB publishes 1,732 distinct `pt_name` strings for roughly 1,061 physical installations, varying the same name by diacritics, casing, whitespace, a ` - Partial` or ` - Module Termice` qualifier, and — before 2022-07 — unqualified shorthand. Keying episodes on the raw `(sector, pt_name)` pair, as the derivation originally did, therefore splits single installations into several and counts them separately in every published figure.

Canonicalization is an ordered pipeline anchored on exact matches, never a generic split on the last ` - `:

1. Strip a trailing qualifier only by exact match against a closed list — ` - Partial`, ` - Module Termice`, ` - MODULE TERMICE`.
2. Fold diacritics and casing.
3. Collapse internal whitespace runs and trim.

Both the suffix list and that step order are calibrated to the observations corpus, where the only qualifier spellings are ` - Module Termice` and ` - MODULE TERMICE` and no label is whitespace-padded. Neither holds for the map registry, which spells the same suffix four ways — including unspaced (`SC 4/3 -MODULE TERMICE`) and truncated (`SC.2Catelu-module`) — and pads 172 of its 951 names with leading or trailing whitespace. Since trimming runs last, an exact suffix match fails on a padded name, and a leading space defeats the `MILITARI - ` prefix too. **Joining the registry to the outage record therefore requires trimming before canonicalization, and a suffix list widened to the registry's spellings.** Applying that wider list to the observations corpus would change nothing, but it has not been measured there, so it is not part of this decision.

Three things that look like noise are retained, because they distinguish genuinely different installations. The **prime** marker is one: CMTEB's own [system map](https://cmteb.ro/harta_stare_sistem_termoficare_bucuresti.php) places `1/7` and `1/7'` 0.64 km apart, and `2-1 Mai` and `2’-1 Mai` 1.57 km apart, across 11 such pairs each carrying over a thousand observations on both sides. The **estate qualifiers** `-T` (Titan) and `MILITARI - ` are another: the two Placare estates reuse the numbers 1–9 and sit 10–13 km apart. **Whitespace is collapsed but never deleted**, because the shorthand inherits its spacing from the canonical name — `1Placare` is the Titan point, `1 Placare` the Militari one.

Sector is excluded because it is unreliable and because CMTEB does not treat it as identity. Its map registry carries name and coordinates and no sector field at all. Of the 66 canonical identities that have appeared under more than one sector, the 51 present on that map land on **exactly one point each**, with no exceptions — including the six `Ct …` cases whose ` - Partial` row was filed under a different sector from its base, which a sector-keyed fold could never merge. Sector survives as a reported attribute (most recent label wins) and as a coarser basis level for on-time probability.

Because canonicalization changes which incidents bridge into one episode, it applies at the observation→key seam in `derive.ts`, before incidents are built — a reporting layer merging already-built episode records cannot re-run the bridge and so cannot reproduce the durations. `data/observations/` stays untouched as the raw archive, so the fold is revisable by re-deriving. Sector leaves the `episode_id` and `incident_id` digests, so all ids churn and every derived artifact and image is republished in one step.

The revision moves every published surface in the same direction — against CMTEB. Folding ` - Partial` alone lowers the all-history on-time rate 0.43pp with 1,057 estimates flipping hit→miss and none the other way, raises duration percentiles, and changes a third to a half of heatmap day-cells. The full model folds more and drops sector, so its delta is larger and not yet measured. This is the direction an accountability metric should not lean by accident, which is why the fold lands before any on-time figure is published rather than as a later correction.

## Considered options

- **Keep `(sector, pt_name)` as the key** — no change to the derivation, but knowingly leaves 57 physical thermal points split in two on any ranking, and makes the six cross-sector ` - Partial` rows unmergeable by construction.
- **Fold all six naming axes** catalogued during research, reaching 1,028 identities — merges the 11 prime pairs and the two Placare estates, installations up to 13 km apart, and inflates address→thermal-point resolution rates by construction.
- **Sector as a tiebreaker on an exception list** of ambiguous names — correct on both sets, but buys a hand-curated list needing revision whenever CMTEB coins a name, to disambiguate 0.07% of observation volume.
- **Fold in the reporting layer only**, leaving `data/derived/` as published — cannot reproduce the result, because bridging is gap-sensitive and merging finished episodes does not re-run it.
- **Treat ` - Partial` as folded for aggregates but distinct for address-level reporting** — two interlocking rules where one suffices. The affected blocks live in `zone_raw`, which folding leaves untouched, so `Partial` is an attribute of the observation and address-level reporting loses nothing.
