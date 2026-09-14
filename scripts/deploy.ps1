<#
.SYNOPSIS
  Deploys one Promethean CCaaS Toolbox tool's web resources to a Dataverse environment.

.DESCRIPTION
  Reads deploy.config.json for the target environment (org URL + solution) and the tool's
  web resource list, builds (unless -SkipBuild), stages non-webpack files (html/css), bumps
  the cache-busting "?v=" query string automatically, PATCHes each web resource's content by
  looking its GUID up live by name (never trusts a GUID from a previous run — webresourceset
  names are immutable but GUIDs aren't something to hardcode), publishes, and verifies by
  reading the live content back.

  Requires the Azure CLI (`az`) to be logged in with access to the target environment.

.PARAMETER Tool
  Key of the tool in deploy.config.json's "tools" object, e.g. "routingtester".

.PARAMETER Environment
  Key of the environment in deploy.config.json's "environments" object. Defaults to the
  config's "defaultEnvironment".

.PARAMETER SkipBuild
  Skip "npm run build" (use the existing dist/ output as-is).

.PARAMETER CreateIfMissing
  If a configured web resource doesn't exist yet in the target environment, create it and add
  it to the environment's solution instead of failing. Use this the first time a new tool is
  deployed; leave it off for routine redeploys so a typo'd name can't silently create a stray
  component instead of failing loudly.

.EXAMPLE
  pwsh ./scripts/deploy.ps1 -Tool routingtester

.EXAMPLE
  pwsh ./scripts/deploy.ps1 -Tool nexttool -CreateIfMissing
#>
param(
  [Parameter(Mandatory = $true)][string]$Tool,
  [string]$Environment,
  [switch]$SkipBuild,
  [switch]$CreateIfMissing
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $repoRoot "deploy.config.json"
if (-not (Test-Path $configPath)) { throw "deploy.config.json not found at $configPath" }
$config = Get-Content $configPath -Raw | ConvertFrom-Json

if (-not $Environment) { $Environment = $config.defaultEnvironment }
$envConfig = $config.environments.$Environment
if (-not $envConfig) { throw "Unknown environment '$Environment'. Known: $($config.environments.PSObject.Properties.Name -join ', ')" }

$toolConfig = $config.tools.$Tool
if (-not $toolConfig) { throw "Unknown tool '$Tool'. Known: $($config.tools.PSObject.Properties.Name -join ', ')" }

$org = $envConfig.url
Write-Output "Deploying '$Tool' ($($toolConfig.displayName)) to '$Environment' ($org)"

if (-not $SkipBuild) {
  Write-Output "--- npm run build ---"
  Push-Location $repoRoot
  try { npm run build; if ($LASTEXITCODE -ne 0) { throw "npm run build failed" } }
  finally { Pop-Location }
}

foreach ($item in $toolConfig.stage) {
  $from = Join-Path $repoRoot $item.from
  $to = Join-Path $repoRoot $item.to
  New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
  Copy-Item -Path $from -Destination $to -Force
  Write-Output "Staged $($item.from) -> $($item.to)"
}

# Cache-busting is automatic: every deploy stamps a fresh version, so nobody has to remember to
# bump a "?v=" by hand (this project got burned by stale-cache confusion before adopting this).
$buildVersion = Get-Date -Format "yyyyMMddHHmmss"
foreach ($wr in $toolConfig.webResources) {
  if (-not $wr.cacheBust) { continue }
  $path = Join-Path $repoRoot $wr.path
  $content = Get-Content $path -Raw
  $content = [regex]::Replace($content, '(\.css|\.js)(\?v=[^"'']*)?(?=["''])', { param($m) "$($m.Groups[1].Value)?v=$buildVersion" })
  Set-Content -Path $path -Value $content -NoNewline
  Write-Output "Stamped cache-buster ?v=$buildVersion into $($wr.path)"
}

Write-Output "--- authenticating ---"
$token = az account get-access-token --resource $org --query accessToken -o tsv
if (-not $token) { throw "Failed to get an access token for $org — check 'az login' and that this account has access." }
$headers = @{ Authorization = "Bearer $token"; "OData-MaxVersion" = "4.0"; "OData-Version" = "4.0"; Accept = "application/json"; "Content-Type" = "application/json" }

$updatedIds = @()
foreach ($wr in $toolConfig.webResources) {
  $lookup = Invoke-RestMethod -Uri "$org/api/data/v9.2/webresourceset?`$select=webresourceid&`$filter=name eq '$($wr.name)'" -Headers $headers -Method Get
  $id = $null
  if ($lookup.value.Count -gt 0) {
    $id = $lookup.value[0].webresourceid
  } elseif ($CreateIfMissing) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot $wr.path))
    $b64 = [Convert]::ToBase64String($bytes)
    $createBody = @{ name = $wr.name; displayname = $wr.displayName; webresourcetype = $wr.type; content = $b64 } | ConvertTo-Json
    $createResp = Invoke-WebRequest -Uri "$org/api/data/v9.2/webresourceset" -Headers ($headers + @{Prefer = "return=representation" }) -Method Post -Body $createBody
    $id = ($createResp.Content | ConvertFrom-Json).webresourceid
    Write-Output "Created $($wr.name) -> $id"
    $addBody = @{ ComponentId = $id; ComponentType = 61; SolutionUniqueName = $envConfig.solutionUniqueName; AddRequiredComponents = $false } | ConvertTo-Json
    Invoke-RestMethod -Uri "$org/api/data/v9.2/AddSolutionComponent" -Headers $headers -Method Post -Body $addBody | Out-Null
    Write-Output "Added $($wr.name) to solution $($envConfig.solutionUniqueName)"
  } else {
    throw "Web resource '$($wr.name)' does not exist in $Environment yet. Re-run with -CreateIfMissing to create it and add it to the solution, or create it manually first."
  }

  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot $wr.path))
  $b64 = [Convert]::ToBase64String($bytes)
  $patchBody = @{ content = $b64 } | ConvertTo-Json
  Invoke-RestMethod -Uri "$org/api/data/v9.2/webresourceset($id)" -Headers $headers -Method Patch -Body $patchBody
  Write-Output "Updated $($wr.name) -> $id"
  $updatedIds += $id
}

Write-Output "--- publishing ---"
$xmlParts = ($updatedIds | ForEach-Object { "<webresource>{$_}</webresource>" }) -join ""
$parameterXml = "<importexportxml><webresources>$xmlParts</webresources></importexportxml>"
$publishBody = @{ ParameterXml = $parameterXml } | ConvertTo-Json
Invoke-RestMethod -Uri "$org/api/data/v9.2/PublishXml" -Headers $headers -Method Post -Body $publishBody | Out-Null
Write-Output "Published."

Write-Output "--- verifying ---"
foreach ($id in $updatedIds) {
  $live = Invoke-RestMethod -Uri "$org/api/data/v9.2/webresourceset($id)?`$select=name,content" -Headers $headers -Method Get
  $expectedBytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot ($toolConfig.webResources | Where-Object { $_.name -eq $live.name }).path))
  $liveBytes = [Convert]::FromBase64String($live.content)
  if ($liveBytes.Length -ne $expectedBytes.Length) { throw "Verification failed for $($live.name): live content length ($($liveBytes.Length)) does not match uploaded length ($($expectedBytes.Length))." }
  Write-Output "Verified $($live.name) ($($liveBytes.Length) bytes)"
}

Write-Output ""
Write-Output "Done. '$Tool' is live in '$Environment' at $org — hard-refresh to see changes."
