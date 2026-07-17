import { assertEquals } from "@std/assert";
import { generateReadme } from "./readme.ts";

Deno.test("generateReadme renders outages then commit activity per year in order", () => {
  const expected = `# Termoficare Bucuresti - Flat Data

[![Scrape health](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FFlorinPopaCodes%2Ftermoficare-data%2Fmain%2Fdata%2Fhealth.json)](https://github.com/FlorinPopaCodes/termoficare-data/issues?q=is%3Aissue+label%3Ascrape-health)

Automated tracking of Bucharest district heating system status using [GitHub Flat Data](https://githubnext.com/projects/flat-data).

## Outages

Two utilities are tracked: **heating** (INC) and **domestic hot water** (ACC). Each map covers one year of one utility. Every cell is one day, and its color shows how many outages were active that day: near-black means none were observed, and the yellow-to-red scale deepens as the count rises. The scale is shared across all years of a utility, so equal color means equal severity in any year. Grey cells are days with no usable data — the system's state that day is unknown, which is not the same as a day with zero outages.

### 2026

![2026 heating outages](images/episodes-inc-2026.svg)

![2026 hot water outages](images/episodes-acc-2026.svg)

## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## Commit Activity

### 2026
![2026 Heatmap](images/heatmap-2026.svg)

## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  assertEquals(
    generateReadme([2026], ["episodes-inc-2026.svg", "episodes-acc-2026.svg", "heatmap-2026.svg"]),
    expected,
  );
});

Deno.test("generateReadme discovers outage years/utilities from imageFiles alone", () => {
  const out = generateReadme([], [
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

Deno.test("generateReadme with no years and no images still renders the static scaffold", () => {
  const out = generateReadme([], []);
  assertEquals(out.includes("## Outages"), true);
  assertEquals(out.includes("## Commit Activity"), true);
  assertEquals(out.includes("![Scrape health]"), true);
  assertEquals(/!\[\d{4} Heatmap\]/.test(out), false);
  assertEquals(/outages\]/.test(out), false);
});
