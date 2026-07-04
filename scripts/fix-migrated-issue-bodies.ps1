param(
    [string]$Repo = "atolis-hq/corum",
    [int]$StartIssue = 60,
    [int]$EndIssue = 82
)

$ErrorActionPreference = "Stop"

function Repair-Body {
    param([string]$Body)

    $repaired = $Body -replace '(?ms)\n``md\r?\n', "`n"
    $repaired = $repaired -replace '(?ms)\r?\n``\r?\n\r?\n## Source context', "`n`n## Source context"
    return $repaired
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

foreach ($issueNumber in $StartIssue..$EndIssue) {
    $issueJson = gh issue view $issueNumber --repo $Repo --json number,title,body,url
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch issue #$issueNumber"
    }

    $issue = $issueJson | ConvertFrom-Json
    $repairedBody = Repair-Body -Body $issue.body

    if ($repairedBody -eq $issue.body) {
        continue
    }

    $tmpBodyPath = Join-Path $env:TEMP ("corum-issue-repair-" + [guid]::NewGuid().ToString() + ".md")
    try {
        Write-Utf8NoBomFile -Path $tmpBodyPath -Content $repairedBody
        gh issue edit $issueNumber --repo $Repo --body-file $tmpBodyPath | Out-Null

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to update issue #$issueNumber"
        }

        $updated.Add([pscustomobject]@{
            Number = $issue.number
            Title = $issue.title
            Url = $issue.url
        }) | Out-Null
    }
    finally {
        if (Test-Path -LiteralPath $tmpBodyPath) {
            Remove-Item -LiteralPath $tmpBodyPath -ErrorAction SilentlyContinue
        }
    }
}

$updated | ConvertTo-Json -Depth 3
