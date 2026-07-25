# Claim only what the published record positively shows

The public report asserts only what the observation record positively contains, and never
treats the absence of a record as evidence about the world. The dataset is a history of what
CMTEB *published*, not of what happened, so a thermal point with a clean record has three
indistinguishable explanations: it genuinely had no outage, its outage was never published, or
the days in question were never observed. All three are measured and none is marginal — the
[registry](https://cmteb.ro/harta_stare_sistem_termoficare_bucuresti.php) capture found 127 of
the outage record's canonical identities absent from CMTEB's own map and 17 mapped thermal
points never once published as down, and coverage carries 4 blind days in 2022, 11 in 2023, 4
in 2024 and 2 each in 2025 and 2026, with 2021 observed for only 13 of December's 31 days.

The consequence that shapes the report is that **the reliability scorecard publishes its worst
end only**. The two ends are not symmetric. A worst ranking rests on positive records —
published outages carrying durations, cause text and missed deadlines — so every row can be
defended by pointing at the observations behind it. A best ranking rests on absence, which is
exactly what the record cannot resolve, and would likely be topped by the 17 thermal points
about which nothing is known at all. For the same reason 2021 is published as a heatmap but
never as a number in a year-over-year comparison: the image encodes unobserved days as grey and
so states its own limits, while a year-level statistic drawn from 13 observed days does not.

The same rule produces the report's refusals, each of them an inference the record does not
carry: no causation beyond the cause text CMTEB itself posts, no blame for a specific failure,
no weather correlation, no claim about the network's physical condition, and no claim that any
thermal point is reliable.

This narrows what [ADR 0001](0001-strict-estimate-scoring.md) licenses. That decision publishes
a deliberately brutal, caveat-free on-time number as an accountability metric; this one bounds
how far that accountability reaches. A missed deadline is an observed act and is fair to publish
without softening. Everything downstream of an act nobody recorded is not.

The cost is accepted rather than avoided: a worst-only ranking is naming-and-shaming with no
counterweight, and hands CMTEB the reply that the report publishes only failures. That is
survivable in a way the alternative is not. A single unsupportable claim discredits every other
figure on the page, while a missing counterweight only makes the page less generous — and a
report that declines to name winners, and says on its methodology page why, spends that
awkwardness on credibility rather than losing it.

## Considered options

- **Best end with an eligibility floor** — rank reliability only among thermal points carrying
  enough published outages to have a real denominator. Excludes the never-reported and keeps a
  counterweight, but the surviving denominator still cannot separate "few outages" from "few
  published outages", so it dresses the same unsupportable claim in a threshold. It also asks a
  reader to hold a subtlety that will not survive being quoted.
- **Both ends, with a caption explaining the gap** — carries the same defect, and puts the load
  on the one element most likely to be cut when a figure is reproduced.
- **No ranking at all** — zero exposure, but discards the scorecard that charting established as
  the public report's spine, and leaves the press nothing to lead with.
- **Treat absence from the registry as evidence of no service**, which would let a best ranking
  stand — rejected on the registry's own numbers: it is the *less* complete of the two CMTEB
  surfaces, carrying no row whatsoever for three institutions the status page simultaneously
  reported down.
