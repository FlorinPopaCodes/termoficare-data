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

### Estimates

**Estimate**:
A restoration deadline CMTEB posts for an ongoing episode. An episode may carry several estimates in sequence; each posted estimate is a separate claim, scored on its own.
_Avoid_: estimation, ETA

**Slip**:
The supersession of a posted estimate by a newer one while the episode is still ongoing. An episode's slip count is how many estimates preceded the current one.
_Avoid_: prolongation, extension

**Hit**:
An estimate whose episode was observed restored at or before the estimated time. Anything else — including restoration first confirmed after the deadline — is a **miss**; there is no grace period. "On time" is the reader-facing synonym.

**On-time rate**:
The share of hits among a group of estimates whose outcomes are known. The basis of a published on-time probability is the rate over comparable history; the reliability trend is the rate over each posting month, split by utility.

**Pending**:
Said of an estimate whose outcome is not yet knowable because its episode is still ongoing. Pending estimates are what make a period's on-time rate provisional.

**Provisional**:
Said of a period's on-time rate while any estimate posted in that period belongs to a still-ongoing episode — the rate can still move as outcomes land.

**Cause class**:
One of a small fixed taxonomy of outage-cause families (breakdown repair, missing supply parameters, hydraulic balancing, planned works, maneuvers/tests, other) derived from the free-text cause.
_Avoid_: issue type

**On-time probability**:
The share of comparable past estimates that were hit, published for an active outage's current estimate together with the size of its basis. Comparable means same thermal point, cause class, and slip count, widening to coarser groupings when history is thin.

### Scrape health

**Failure**:
The scraper or pipeline breaking (stale page, zero-parse, workflow error). Never used for heating or hot-water disruptions — those are episodes.
