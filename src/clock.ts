// Naive Bucharest wall-clock ISO 8601 -- one clock across the whole dataset.
// Not ambient-TZ-dependent: converts via Europe/Bucharest regardless of the host's TZ.

import { DateTime } from "luxon";

const FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

// October's DST fall-back repeats an hour of wall-clock time; the ~4 snapshots/year
// that land in it get a duplicate snapshot_ts. Accepted, not worked around.
export function bucharestTimestamp(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: "Europe/Bucharest" }).toFormat(FORMAT);
}

// Inverse of bucharestTimestamp: a naive Bucharest wall-clock string back to the instant
// it names. October's fall-back hour is ambiguous and resolves to one of its two
// instants (accepted, matching bucharestTimestamp's accepted duplicate).
export function bucharestToInstant(ts: string): Date {
  return DateTime.fromFormat(ts, FORMAT, { zone: "Europe/Bucharest" }).toJSDate();
}
