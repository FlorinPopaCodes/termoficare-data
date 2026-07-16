import { assertEquals } from "@std/assert";
import { generateReadme } from "./readme.ts";

Deno.test("generateReadme renders one heatmap section per year in order", () => {
  const expected = `# Termoficare Bucuresti - Flat Data

Automated tracking of Bucharest district heating system status using [GitHub Flat Data](https://githubnext.com/projects/flat-data).

## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## Commit Activity

### 2026
![2026 Heatmap](images/heatmap-2026.svg)

### 2025
![2025 Heatmap](images/heatmap-2025.svg)

## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  assertEquals(generateReadme([2026, 2025]), expected);
});

Deno.test("generateReadme with no years still renders the static scaffold", () => {
  const out = generateReadme([]);
  assertEquals(out.includes("## Commit Activity"), true);
  assertEquals(out.includes("![") , false);
});
