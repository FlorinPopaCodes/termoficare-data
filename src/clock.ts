// Naive Bucharest wall-clock ISO 8601 -- one clock across the whole dataset.
// Not ambient-TZ-dependent: reads Europe/Bucharest via Intl regardless of the host's TZ.

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23", // hour12: false can render midnight as "24", not "00"
});

// October's DST fall-back repeats an hour of wall-clock time; the ~4 snapshots/year
// that land in it get a duplicate snapshot_ts. Accepted, not worked around.
export function bucharestTimestamp(instant: Date): string {
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${
    get("second")
  }`;
}
