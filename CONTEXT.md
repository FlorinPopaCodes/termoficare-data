# Termoficare Data

Automated tracking of Bucharest's district-heating system: scrapes the CMTEB status page, keeps the raw history as flat data, and derives outage records and visualizations from it.

## Language

### Scraping

**Snapshot**:
One scrape of the CMTEB status page at a point in time. A snapshot is usable when it parsed cleanly (including "no disruptions listed"); an errored snapshot carries no evidence either way.

**Observation**:
One disruption row read from a single snapshot: a thermal point × service entry with its affected blocks, cause, and estimated restore time.

**Blind day**:
A calendar day with no usable snapshot — the system's state that day is unknown. Distinct from a day verified to have zero episodes.
_Avoid_: gap day, missing day

### Outages

**Utility**:
One of the two tracked services: INC (heating) or ACC (domestic hot water).

**Incident**:
A contiguous run of the same sector + thermal point + service disruption across consecutive usable snapshots. A scrape-level artifact: a change in service wording splits one real-world disruption into multiple incidents.

**Episode**:
The canonical outage unit: one or more incidents at the same sector + thermal point + utility, bridged across short gaps. When prose says "outage", it means an episode.
_Avoid_: failure (reserved for scrape health), disruption

**Outage**:
Everyday synonym for Episode, acceptable in reader-facing prose (README, issue titles). Never a distinct entity.

**Active day**:
A Bucharest-local calendar day on which an episode was observed present — the days from its first to its last sighting. Days between the last sighting and the first observed absence are not active.

### Scrape health

**Failure**:
The scraper or pipeline breaking (stale page, zero-parse, workflow error). Never used for heating or hot-water disruptions — those are episodes.
