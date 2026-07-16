// Naive local Bucharest timestamps. Pure — formatBucharest takes a Date in, no I/O.
// "Naive" per decision #5: no UTC offset in the output, DST handled by the IANA zone.

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatBucharest(date: Date): string {
  const parts = FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${
    get("second")
  }`;
}

export function nowBucharest(): string {
  return formatBucharest(new Date());
}
