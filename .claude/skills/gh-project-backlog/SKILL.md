---
name: gh-project-backlog
description: Use when listing or summarizing GitHub Project backlog items with the gh CLI, especially when you need current iteration items, backlog-only items, or the board's existing sort order.
---

# GH Project Backlog

## Overview

Use `gh project item-list` as the source of truth for project items. It returns items in the project's current order, so preserve that order unless the user explicitly asks for a different sort.

The command that produced the backlog list was:

```bash
gh project item-list 2 --owner atolis-hq --format json
```

For project metadata, use:

```bash
gh project view 2 --owner atolis-hq --format json
```

## Requirements

- `gh` must be authenticated with `read:project`
- Project number and owner must be known

If auth fails with missing scope, run:

```bash
gh auth refresh -s read:project
```

## Quick Use

### Full project item dump

```bash
gh project item-list <project-number> --owner <owner> --format json
```

### Current iteration backlog in PowerShell

This keeps the project's existing order and filters to the earliest iteration start date present in the data.

```powershell
$items = (gh project item-list 2 --owner atolis-hq --format json | ConvertFrom-Json).items
$currentStart = ($items | Where-Object { $_.iteration } | Sort-Object { [datetime]$_.iteration.startDate } | Select-Object -First 1).iteration.startDate
$items |
  Where-Object { $_.status -eq 'Backlog' -and $_.iteration -and $_.iteration.startDate -eq $currentStart } |
  Select-Object @{N='Number';E={$_.content.number}}, @{N='Title';E={$_.title}}
```

### Backlog-only items in current project order

```powershell
(gh project item-list 2 --owner atolis-hq --format json | ConvertFrom-Json).items |
  Where-Object { $_.status -eq 'Backlog' } |
  Select-Object @{N='Number';E={$_.content.number}}, @{N='Title';E={$_.title}}
```

## Output Guidance

- Prefer issue number plus title
- Mention the iteration title when filtering by iteration
- Call out when items are excluded because their status is `Done`
- Do not re-sort unless asked; the API output order is the board order used in the responses above

## Common Mistakes

- Using `gh issue list` instead of `gh project item-list`; issue list does not know project fields like `status` or `iteration`
- Re-sorting by issue number, which destroys project priority/order
- Forgetting `read:project` scope
- Assuming "current iteration" means latest date; verify from the board data or user context
