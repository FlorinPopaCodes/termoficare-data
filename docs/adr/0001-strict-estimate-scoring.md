# Strict scoring of restoration estimates

When scoring whether a posted restoration estimate was hit, we require the episode to be observed restored at or before the estimated time — no grace window, and every posted estimate is scored, not just each episode's final one. This makes the published hit rate look brutal: CMTEB serially prolongs estimates, so nearly every superseded estimate scores as a miss, and restorations first confirmed after the deadline count against it too. That is deliberate: the number is an accountability metric, and the strict rule is the only one that needs no tuning parameter and no caveat when published.

## Considered options

- **Grace window** (hit if restored within N hours after the deadline) — friendlier to CMTEB, but N is arbitrary and every published number would need the "within N hours" caveat.
- **Lenient observation rule** (miss only if the episode was *seen* past the deadline) — gives the benefit of the observation gap to CMTEB, silently inflating the hit rate by up to a scrape interval.
- **Final estimates only** — conditions on information unavailable at prediction time (a live estimate isn't known to be final), producing survivorship-biased, overly optimistic probabilities.
