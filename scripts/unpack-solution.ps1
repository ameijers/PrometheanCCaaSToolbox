<#
.SYNOPSIS
    Unpacks the exported Power Platform solution into readable files, so each
    new version shows in Git as a real diff (Site Map, app, version, web resources).

.DESCRIPTION
    Runs `pac solution unpack` on the unmanaged solution zip and writes the
    result to power_platform_solution/src. The built tool files inside the
    solution (bundle.js, index.html, style.css) are removed afterwards: they're
    generated from tools/*/src, which is already in Git. Their settings files
    (*.data.xml: name, display name, type) are kept.

    The folder is for reading changes. The zip in power_platform_solution stays
    the file to import.

.PARAMETER ZipFile
    The unmanaged solution zip. Default: the newest *.zip in
    power_platform_solution that isn't a *_managed.zip.

.EXAMPLE
    pwsh ./scripts/unpack-solution.ps1
    pwsh ./scripts/unpack-solution.ps1 -ZipFile power_platform_solution/PrometheanCCaaSToolbox_1_0_0_25.zip
#>
param(
    [string]$ZipFile
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$solutionDir = Join-Path $repo 'power_platform_solution'
$target = Join-Path $solutionDir 'src'

if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
    throw "The Power Platform CLI (pac) isn't installed. See https://learn.microsoft.com/power-platform/developer/cli/introduction"
}

function Get-ZipVersion([string]$path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $reader = New-Object IO.StreamReader($zip.GetEntry('solution.xml').Open())
        $xml = [xml]$reader.ReadToEnd()
        $reader.Close()
        return [version]$xml.ImportExportXml.SolutionManifest.Version
    } finally { $zip.Dispose() }
}

if (-not $ZipFile) {
    # The highest version inside the zip, not the file name or date: a fresh clone gives every file the same date.
    $latest = Get-ChildItem $solutionDir -Filter *.zip |
        Where-Object { $_.Name -notlike '*_managed.zip' } |
        Sort-Object { Get-ZipVersion $_.FullName } -Descending |
        Select-Object -First 1
    if (-not $latest) { throw "No unmanaged solution zip found in $solutionDir." }
    $ZipFile = $latest.FullName
}
$ZipFile = (Resolve-Path $ZipFile).Path
if ((Split-Path $ZipFile -Leaf) -like '*_managed.zip') {
    throw "Unpack the unmanaged zip. The managed one has the same content, marked as managed."
}

Write-Host "Unpacking $(Split-Path $ZipFile -Leaf) into power_platform_solution/src"

# Start from an empty folder, so a component removed from the solution also disappears here.
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
pac solution unpack --zipfile $ZipFile --folder $target --packagetype Unmanaged
if ($LASTEXITCODE -ne 0) { throw "pac solution unpack failed." }

# Remove the built tool files; keep their *.data.xml settings.
$webResources = Join-Path $target 'WebResources'
if (Test-Path $webResources) {
    Get-ChildItem $webResources -Recurse -File |
        Where-Object { $_.Name -notlike '*.data.xml' } |
        Remove-Item -Force
}

$version = ([xml](Get-Content (Join-Path $target 'Other/Solution.xml') -Raw)).ImportExportXml.SolutionManifest.Version
Write-Host "Done: solution version $version."
Write-Host ''
Write-Host 'Changes since the last commit:'
git -C $repo status --short -- power_platform_solution/src
