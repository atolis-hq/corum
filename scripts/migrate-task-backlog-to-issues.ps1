param(
    [string]$Repo = "atolis-hq/corum"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$tasksDir = Join-Path $repoRoot "docs\tasks"
$excluded = @("index.md", "mcpwritetools.md", "renaminganddeletion.md")

$titleMap = @{
    "agentskills.md" = "Agent Skills"
    "bdd.md" = "BDD Pack"
    "cliconfig.md" = "CLI Config File"
    "codeextraction.md" = "Code Extraction (Derived Layer)"
    "collaboration.md" = "Collaboration"
    "componentspage.md" = "Components Page"
    "customui.md" = "Custom UI"
    "darkmode.md" = "Dark Mode"
    "dashboard.md" = "Dashboard"
    "deliveryview.md" = "Delivery View"
    "editmode.md" = "Edit Mode"
    "filewatcher.md" = "File Watcher"
    "githubactionstemplate.md" = "GitHub Actions Template"
    "graphvisualiser.md" = "Graph Visualiser"
    "importers.md" = "Importers"
    "linter.md" = "Linter"
    "nodereviewworkflow.md" = "Node Review Workflow"
    "openapi-gaps.md" = "OpenAPI Adapter: Known Representation Gaps"
    "search.md" = "Search"
    "semanticmatching.md" = "Semantic Matching"
    "uitweaks.md" = "UI Tweaks"
    "unmappedfields.md" = "Unmapped Fields & Unlinked Nodes"
    "userjourneys.md" = "User Journeys"
}

function Get-DefaultSummary {
    param([string[]]$Lines)

    foreach ($line in $Lines) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        if ($trimmed -match '^\>\s*\*\*Design done:\*\*') { continue }
        if ($trimmed -match '^\-\s+') { continue }

        $summary = $trimmed -replace '^\#+\s*', ''
        $summary = $summary -replace '^\>\s*', ''
        return $summary.Trim()
    }

    return "Migrated backlog item from docs/tasks."
}

function Get-Body {
    param(
        [string]$Title,
        [string]$RelativePath,
        [string]$RawContent
    )

    $lines = $RawContent -split "`r?`n"
    $summary = Get-DefaultSummary -Lines $lines
    $today = Get-Date -Format "yyyy-MM-dd"

    @(
        "## Summary"
        ""
        $summary
        ""
        "## Outcome"
        ""
        "Deliver the capability or clarification described in the notes below."
        ""
        "## Notes"
        ""
        "Migrated from the task backlog. Detail has been preserved for later refinement."
        ""
        $RawContent
        ""
        "## Source context"
        ""
        "- Original file: ``$RelativePath``"
        "- Migrated on: ``$today``"
    ) -join "`n"
}

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$taskFiles = Get-ChildItem -LiteralPath $tasksDir -Filter *.md |
    Where-Object { $_.Name -notin $excluded } |
    Sort-Object Name

if (-not $taskFiles) {
    Write-Host "No task files to migrate."
    exit 0
}

$created = New-Object System.Collections.Generic.List[object]

foreach ($taskFile in $taskFiles) {
    $title = $titleMap[$taskFile.Name]
    if (-not $title) {
        throw "No title mapping found for $($taskFile.Name)."
    }

    $rawContent = Get-Content -LiteralPath $taskFile.FullName -Raw
    $relativePath = "docs/tasks/$($taskFile.Name)"
    $body = Get-Body -Title $title -RelativePath $relativePath -RawContent $rawContent

    $tmpBodyPath = Join-Path $env:TEMP ("corum-issue-" + [guid]::NewGuid().ToString() + ".md")
    try {
        Write-Utf8NoBomFile -Path $tmpBodyPath -Content $body

        $createOutput = gh issue create `
            --repo $Repo `
            --title $title `
            --label enhancement `
            --body-file $tmpBodyPath

        if ($LASTEXITCODE -ne 0) {
            throw "gh issue create failed for $relativePath"
        }

        $issueUrl = ($createOutput | Select-Object -Last 1).Trim()
        if ([string]::IsNullOrWhiteSpace($issueUrl) -or $issueUrl -notmatch '/issues/(\d+)$') {
            throw "Could not parse created issue URL for $relativePath. Output: $createOutput"
        }

        $issueNumber = $Matches[1]
        Remove-Item -LiteralPath $taskFile.FullName

        $created.Add([pscustomobject]@{
            File = $relativePath
            IssueNumber = $issueNumber
            IssueUrl = $issueUrl
            Title = $title
        }) | Out-Null

        Write-Host "Migrated $relativePath -> #$issueNumber"
    }
    finally {
        if (Test-Path -LiteralPath $tmpBodyPath) {
            Remove-Item -LiteralPath $tmpBodyPath -ErrorAction SilentlyContinue
        }
    }
}

$created | ConvertTo-Json -Depth 3
