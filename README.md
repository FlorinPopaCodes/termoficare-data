# Termoficare Bucuresti - Flat Data

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

### 2024
![2024 Heatmap](images/heatmap-2024.svg)

### 2023
![2023 Heatmap](images/heatmap-2023.svg)

### 2022
![2022 Heatmap](images/heatmap-2022.svg)

### 2021
![2021 Heatmap](images/heatmap-2021.svg)

## View Data

Once this repository is made public, use [Flat Viewer](https://flatgithub.com/FlorinPopaCodes/termoficare-data) to browse the data interactively.

## How It Works

This repository uses the [Flat GitHub Action](https://github.com/githubocto/flat) to periodically fetch the heating status page and commit any changes to this repository.
