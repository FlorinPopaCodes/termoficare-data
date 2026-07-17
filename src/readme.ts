// README generation. Pure module — no I/O. Given the years with data, produces
// the repository README with one heatmap section per year.

export function generateReadme(years: number[]): string {
  let readme = `# Termoficare Bucuresti - Flat Data

[![Scrape health](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FFlorinPopaCodes%2Ftermoficare-data%2Fmain%2Fdata%2Fhealth.json)](https://github.com/FlorinPopaCodes/termoficare-data/issues?q=is%3Aissue+label%3Ascrape-health)

Automated tracking of Bucharest district heating system status using [GitHub Flat Data](https://githubnext.com/projects/flat-data).

## Data Source

- **URL**: https://www.cmteb.ro/functionare_sistem_termoficare.php
- **Update frequency**: Every 15 minutes
- **Format**: Raw HTML

## Commit Activity

`;

  for (const year of years) {
    readme += `### ${year}\n![${year} Heatmap](images/heatmap-${year}.svg)\n\n`;
  }

  readme += `## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
`;

  return readme;
}
