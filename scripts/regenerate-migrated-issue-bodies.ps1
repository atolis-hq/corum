param(
    [string]$Repo = "atolis-hq/corum"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
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

$updated = New-Object System.Collections.Generic.List[object]

foreach ($entry in $titleMap.GetEnumerator() | Sort-Object Key) {
    if ($entry.Key -in $excluded) { continue }

    $relativePath = "docs/tasks/$($entry.Key)"
    $rawContent = (git show "HEAD:$relativePath" | Out-String).TrimEnd("`r", "`n")
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read $relativePath from HEAD"
    }

    $body = Get-Body -RelativePath $relativePath -RawContent $rawContent
    $search = "$($entry.Value) in:title"
    $issueJson = gh issue list --repo $Repo --state all --search $search --limit 10 --json number,title
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to locate issue for $($entry.Value)"
    }

    $matches = $issueJson | ConvertFrom-Json | Where-Object { $_.title -eq $entry.Value }
    if (@($matches).Count -ne 1) {
        throw "Expected one issue match for '$($entry.Value)', found $(@($matches).Count)"
    }

    $issueNumber = $matches[0].number
    $tmpBodyPath = Join-Path $env:TEMP ("corum-issue-regenerate-" + [guid]::NewGuid().ToString() + ".md")
    try {
        Write-Utf8NoBomFile -Path $tmpBodyPath -Content $body
        gh issue edit $issueNumber --repo $Repo --body-file $tmpBodyPath | Out-Null

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to update issue #$issueNumber"
        }

        $updated.Add([pscustomobject]@{
            Number = $issueNumber
            Title = $entry.Value
        }) | Out-Null
    }
    finally {
        if (Test-Path -LiteralPath $tmpBodyPath) {
            Remove-Item -LiteralPath $tmpBodyPath -ErrorAction SilentlyContinue
        }
    }
}

$updated | ConvertTo-Json -Depth 3
