import { assertEquals } from "@std/assert";
import { generateReadme } from "./readme.ts";

Deno.test("generateReadme renders outage maps per year in order", () => {
  const expected = `# Termoficare Bucuresti - Flat Data

[![Scrape health](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FFlorinPopaCodes%2Ftermoficare-data%2Fmain%2Fdata%2Fhealth.json)](https://github.com/FlorinPopaCodes/termoficare-data/issues?q=is%3Aissue+label%3Ascrape-health)

Automated tracking of Bucharest district heating system status, kept as [flat data](https://githubnext.com/projects/flat-data) in git.

## Outages

Two utilities are tracked: **heating** (INC) and **domestic hot water** (ACC). Each map covers one year of one utility. Every cell is one day, and its color shows how many outages were active that day: near-black means none were observed, and the yellow-to-red scale deepens as the count rises. The scale is shared across all years of a utility, so equal color means equal severity in any year. Grey cells are days with no usable data — the system's state that day is unknown, which is not the same as a day with zero outages.

### 2026

![2026 heating outages](images/episodes-inc-2026.svg)

![2026 hot water outages](images/episodes-acc-2026.svg)

## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## View Data

Use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

A **scraper**, a machine outside GitHub Actions because CMTEB blocks GitHub's IP ranges ([ADR 0004](docs/adr/0004-scraping-runs-outside-github-actions.md)), fetches the heating status page every 15 minutes and commits any changes to this repository. GitHub Actions then derives the outage datasets daily and watches scrape health.

To run a scraper, give the machine push access to this repository and a \`gh\` login that can write repository variables, then schedule:

- \`SCRAPER_NAME=<name> deno task scrape\` every 15 minutes
- \`deno task registry\` once a day, from a separate clone so the two never share a working tree
`;

  assertEquals(
    generateReadme(["episodes-inc-2026.svg", "episodes-acc-2026.svg", "heatmap-2026.svg"]),
    expected,
  );
});

Deno.test("generateReadme discovers outage years/utilities from imageFiles alone", () => {
  const out = generateReadme([
    "episodes-inc-2025.svg",
    "episodes-acc-2025.svg",
    "episodes-inc-2023.svg", // 2023 has no ACC map
    "heatmap-2025.svg", // ignored: not an episode file
    "episodes-inc-2025.png", // ignored: wrong extension
    "notes.txt", // ignored: stray name
  ]);

  const outageSection = out.slice(out.indexOf("## Outages"), out.indexOf("## Data Source"));
  assertEquals(
    outageSection,
    `## Outages

Two utilities are tracked: **heating** (INC) and **domestic hot water** (ACC). Each map covers one year of one utility. Every cell is one day, and its color shows how many outages were active that day: near-black means none were observed, and the yellow-to-red scale deepens as the count rises. The scale is shared across all years of a utility, so equal color means equal severity in any year. Grey cells are days with no usable data — the system's state that day is unknown, which is not the same as a day with zero outages.

### 2025

![2025 heating outages](images/episodes-inc-2025.svg)

![2025 hot water outages](images/episodes-acc-2025.svg)

### 2023

![2023 heating outages](images/episodes-inc-2023.svg)

`,
  );
});

Deno.test("generateReadme with no images still renders the static scaffold", () => {
  const out = generateReadme([]);
  assertEquals(out.includes("## Outages"), true);
  assertEquals(out.includes("![Scrape health]"), true);
  assertEquals(/outages\]/.test(out), false);
});

Deno.test("generateReadme adds the estimate-reliability section only when the trend image exists", () => {
  const out = generateReadme(["on-time-trend.svg"]);
  const section = out.slice(out.indexOf("## Estimate reliability"), out.indexOf("## Data Source"));

  assertEquals(section.includes("![On-time trend](images/on-time-trend.svg)"), true);
  assertEquals(section.includes("provisional"), true);
  assertEquals(generateReadme([]).includes("Estimate reliability"), false);
});

Deno.test("generateReadme adds the outage-duration section only when the trend image exists", () => {
  const out = generateReadme(["duration-trend.svg"]);
  const section = out.slice(out.indexOf("## Outage duration"), out.indexOf("## Data Source"));

  assertEquals(section.includes("![Duration trend](images/duration-trend.svg)"), true);
  assertEquals(section.includes("provisional"), true);
  assertEquals(generateReadme([]).includes("Outage duration"), false);
});
