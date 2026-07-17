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

// Inverse of bucharestTimestamp: a naive Bucharest wall-clock string back to the instant
// it names. Two fixed-point iterations absorb the DST-dependent offset; October's
// fall-back hour is ambiguous and resolves to one of its two instants (accepted, matching
// bucharestTimestamp's accepted duplicate).
export function bucharestToInstant(ts: string): Date {
  const wallMs = Date.parse(ts + "Z");
  let guess = new Date(wallMs);
  for (let i = 0; i < 2; i++) {
    const renderedMs = Date.parse(bucharestTimestamp(guess) + "Z");
    guess = new Date(guess.getTime() + (wallMs - renderedMs));
  }
  return guess;
}
