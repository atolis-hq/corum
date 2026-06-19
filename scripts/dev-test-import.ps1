# dev-test-import.ps1
# Builds corum, initialises a fresh temp graph, imports the petstore spec,
# prints all generated APIEndpoint YAML files, then starts the web UI.
# Run repeatedly -- the temp dir is wiped on each run.
#
# Usage:
#   .\scripts\dev-test-import.ps1
#   .\scripts\dev-test-import.ps1 -Spec path\to\spec.yaml
#   .\scripts\dev-test-import.ps1 -Spec path\to\spec.yaml -Segment 1
#   .\scripts\dev-test-import.ps1 -Port 4000
#   .\scripts\dev-test-import.ps1 -SkipBuild
#   .\scripts\dev-test-import.ps1 -NoWeb

param(
    [string]$Spec    = "$PSScriptRoot\..\docs\spec-examples\openapi\petstore.openapi.3.0.yaml",
    [int]$Segment    = 0,
    [int]$Port       = 0,
    [switch]$SkipBuild,
    [switch]$NoWeb
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$TestDir     = Join-Path $ProjectRoot "tmp\dev-test-import"
$Corum       = "node `"$ProjectRoot\dist\src\bin\corum.js`""

# -- Build --------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "[1/4] Building..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    npm run build
    if (-not $?) { Write-Error "Build failed"; exit 1 }
    Pop-Location
} else {
    Write-Host "[1/4] Skipping build (-SkipBuild)" -ForegroundColor DarkGray
}

# -- Init ---------------------------------------------------------------------
Write-Host ""
Write-Host "[2/4] Setting up test directory: $TestDir" -ForegroundColor Cyan
if (Test-Path $TestDir) { Remove-Item $TestDir -Recurse -Force }
New-Item -ItemType Directory -Path $TestDir | Out-Null

Push-Location $TestDir
Invoke-Expression "$Corum init"
if (-not $?) { Write-Error "corum init failed"; Pop-Location; exit 1 }
Pop-Location

# -- Import -------------------------------------------------------------------
$SpecResolved = Resolve-Path $Spec
Write-Host ""
Write-Host "[3/4] Importing: $SpecResolved" -ForegroundColor Cyan

Push-Location $TestDir
Invoke-Expression "$Corum import openapi '$SpecResolved' --segment $Segment"
if (-not $?) { Write-Error "Import failed"; Pop-Location; exit 1 }
Pop-Location

# -- Inspect ------------------------------------------------------------------
Write-Host ""
Write-Host "[4/4] Generated APIEndpoint files:" -ForegroundColor Cyan

$endpoints = Get-ChildItem "$TestDir\.corum\graph\components" -Recurse -Filter "*.yaml" |
    Where-Object { $_.DirectoryName -like "*APIEndpoints*" } |
    Sort-Object FullName

if ($endpoints.Count -eq 0) {
    Write-Host "  (none found - check warnings above)" -ForegroundColor Yellow
} else {
    foreach ($f in $endpoints) {
        Write-Host ""
        Write-Host "--- $($f.Name) ---" -ForegroundColor DarkCyan
        Get-Content $f.FullName
    }
}

Write-Host ""
Write-Host "Graph directory: $TestDir\.corum\graph" -ForegroundColor DarkGray

# -- Web UI -------------------------------------------------------------------
if (-not $NoWeb) {
    Write-Host ""
    Write-Host "Starting web UI (Ctrl+C to stop)..." -ForegroundColor Cyan
    $portFlag = if ($Port -gt 0) { " --port $Port" } else { "" }
    Push-Location $TestDir
    Invoke-Expression "$Corum web$portFlag"
    Pop-Location
}
