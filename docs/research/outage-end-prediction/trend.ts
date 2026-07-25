// Is the system getting better, or are the estimates getting longer?
//
//   WORK=... TZ=UTC deno run -A trend.ts [utility] [first-month-of-year] [last-month-of-year]
//
// Puts the published on-time rate next to two things it does not publish: how far ahead
// CMTEB posts its deadlines, and how long outages actually last. An on-time rate can rise
// because outages resolve faster or because the deadlines moved further out; only the
// three series together say which.

import { hours, loadEpisodes, loadPostings, median, quantile } from "./data.ts";

const only = Deno.args[0];
const postings = loadPostings();
const episodes = loadEpisodes();

interface Row {
  month: string;
  utility: string;
  n: number;
  onTime: number;
  leadFromPost: number;
  leadFromStart: number;
  nClosed: number;
  p50: number;
  p90: number;
}

const byMonth = new Map<string, {
  hits: number;
  n: number;
  leadPost: number[];
  leadStart: number[];
  durations: number[];
}>();

const bucket = (key: string) => {
  let b = byMonth.get(key);
  if (b === undefined) {
    b = { hits: 0, n: 0, leadPost: [], leadStart: [], durations: [] };
    byMonth.set(key, b);
  }
  return b;
};

for (const p of postings) {
  const b = bucket(`${p.posted_ts.slice(0, 7)} ${p.utility}`);
  b.n++;
  if (p.hit) b.hits++;
  b.leadPost.push(hours(p.posted_ts, p.estimated_restore));
  b.leadStart.push(hours(p.episode_first_seen_ts, p.estimated_restore));
}

for (const e of episodes) {
  if (e.first_absent_ts === null) continue;
  bucket(`${e.first_seen_ts.slice(0, 7)} ${e.utility}`)
    .durations.push(hours(e.first_seen_ts, e.first_absent_ts));
}

const rows: Row[] = [...byMonth.entries()]
  .map(([key, b]) => {
    const [month, utility] = key.split(" ");
    const durations = [...b.durations].sort((x, y) => x - y);
    return {
      month,
      utility,
      n: b.n,
      onTime: b.n === 0 ? NaN : b.hits / b.n,
      leadFromPost: b.leadPost.length === 0 ? NaN : median(b.leadPost),
      leadFromStart: b.leadStart.length === 0 ? NaN : median(b.leadStart),
      nClosed: durations.length,
      p50: durations.length === 0 ? NaN : quantile(durations, 0.5),
      p90: durations.length === 0 ? NaN : quantile(durations, 0.9),
    };
  })
  .filter((r) => (only === undefined || r.utility === only) && r.n >= 20)
  .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

const f = (x: number, d = 1) => (Number.isNaN(x) ? "—" : x.toFixed(d));
console.log(
  "| month | util | estimates | on-time | lead from posting | lead from start | closed | p50 | p90 |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.month} | ${r.utility} | ${r.n} | ${(r.onTime * 100).toFixed(1)}% | ` +
      `${f(r.leadFromPost)}h | ${f(r.leadFromStart)}h | ${r.nClosed} | ${f(r.p50)}h | ${
        f(r.p90)
      }h |`,
  );
}

// Yearly rollup: the same three series at an altitude where a trend is readable, over the
// same months of each year -- heating is seasonal and the archive's last year stops in
// July, so a plain calendar rollup would compare unlike periods.
const FROM_MONTH = Number(Deno.args[1] ?? 1);
const TO_MONTH = Number(Deno.args[2] ?? 7);
console.log(`\n### Yearly, months ${FROM_MONTH}-${TO_MONTH} of each year\n`);
console.log(
  "| year | util | estimates | on-time | lead from posting (p50) | closed | p50 duration | p90 |",
);
console.log("|---|---|---|---|---|---|---|---|");
const byYear = new Map<string, Row[]>();
for (const r of rows) {
  const m = Number(r.month.slice(5, 7));
  if (m < FROM_MONTH || m > TO_MONTH || r.month < "2022") continue;
  const key = `${r.month.slice(0, 4)} ${r.utility}`;
  const list = byYear.get(key);
  if (list === undefined) byYear.set(key, [r]);
  else list.push(r);
}
for (const [key, list] of [...byYear.entries()].sort()) {
  const [year, utility] = key.split(" ");
  const n = list.reduce((a, r) => a + r.n, 0);
  const onTime = list.reduce((a, r) => a + r.onTime * r.n, 0) / n;
  const nClosed = list.reduce((a, r) => a + r.nClosed, 0);
  console.log(
    `| ${year} | ${utility} | ${n} | ${(onTime * 100).toFixed(1)}% | ` +
      `${f(median(list.map((r) => r.leadFromPost)))}h | ${nClosed} | ` +
      `${f(median(list.filter((r) => !Number.isNaN(r.p50)).map((r) => r.p50)))}h | ` +
      `${f(median(list.filter((r) => !Number.isNaN(r.p90)).map((r) => r.p90)))}h |`,
  );
}
