param(
  [string]$SiteUrl = "http://127.0.0.1:8766/update.html",
  [string]$BqlPython = "",
  [ValidateSet('bql','polars-bloomberg')][string]$Provider = 'bql',
  [switch]$SupportedRuntimeConfirmed
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Get-Command python -ErrorAction Stop
if (-not $BqlPython) { $BqlPython = $python.Source }
$runtime = (Get-Command $BqlPython -ErrorAction Stop).Source
$token = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$bridgeArgs = @("`"$(Join-Path $PSScriptRoot 'bloomberg_bridge.py')`"", "--token", $token, "--bql-python", "`"$runtime`"")
$bridgeArgs += @('--provider', $Provider)
if ($SupportedRuntimeConfirmed) { $bridgeArgs += "--supported-runtime-confirmed" }
$process = Start-Process -FilePath $python.Source -ArgumentList $bridgeArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 2
  Start-Process "$SiteUrl#bbg-token=$token"
  Write-Host "BQL diagnostic started. Keep this window open; Ctrl+C stops the bridge."
  Wait-Process -Id $process.Id
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
}
