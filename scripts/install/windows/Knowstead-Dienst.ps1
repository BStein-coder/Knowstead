<#
.SYNOPSIS
  Knowstead steuern: starten, beenden, neu starten, Zustand und Protokoll anzeigen (Windows).

.DESCRIPTION
  Erkennt, ob Knowstead als geplante Aufgabe (\Knowstead\Knowstead) oder als Windows-Dienst (NSSM) eingerichtet ist.
  Beendet wird immer geordnet – offene Bearbeitungsstände werden vorher geschrieben.

.EXAMPLE
  .\Knowstead-Dienst.cmd status
.EXAMPLE
  .\Knowstead-Dienst.cmd restart
.EXAMPLE
  .\Knowstead-Dienst.cmd log -Follow
#>
param(
  [Parameter(Position = 0)][ValidateSet('start', 'stop', 'restart', 'status', 'log')][string]$Action = 'status',
  [switch]$Follow,
  [int]$Lines = 60
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$TaskPath = '\Knowstead\'
$TaskName = 'Knowstead'
$ServiceName = 'Knowstead'

function Read-KnowsteadEnv {
  $values = @{}
  $file = Join-Path $Root '.env'
  if (-not (Test-Path -LiteralPath $file)) { return $values }
  foreach ($line in [IO.File]::ReadAllLines($file, [Text.Encoding]::UTF8)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $value = $Matches[2].Trim()
      if ($value -match "^'(.*)'$" -or $value -match '^"(.*)"$') { $value = $Matches[1] } else { $value = ($value -replace '\s+#.*$', '') }
      $values[$Matches[1]] = $value
    }
  }
  return $values
}

$envValues = Read-KnowsteadEnv
$port = 3000
if ($envValues.ContainsKey('PORT')) { $port = [int]$envValues['PORT'] }
$dataDir = Join-Path $Root 'data'
if ($envValues.ContainsKey('DATA_DIR')) { $dataDir = $envValues['DATA_DIR'] }
$logFile = Join-Path $dataDir 'logs\knowstead.log'
if ($envValues.ContainsKey('LOG_FILE') -and $envValues['LOG_FILE']) {
  $logFile = $envValues['LOG_FILE']
  if (-not [IO.Path]::IsPathRooted($logFile)) { $logFile = Join-Path $dataDir $logFile }
}
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)

function Test-Health {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch { return $false }
}

function Invoke-Cli([string[]]$Arguments) {
  if (-not $node) { throw 'Node.js wurde nicht gefunden.' }
  Push-Location $Root
  try {
    & $node.Source --disable-warning=ExperimentalWarning server\src\cli.ts @Arguments | Out-Host
    return $LASTEXITCODE
  } finally { Pop-Location }
}

function Stop-Knowstead {
  if ($service -and $service.Status -eq 'Running') {
    Write-Host 'Windows-Dienst »Knowstead« wird beendet …'
    Stop-Service -Name $ServiceName -Force
  }
  $code = Invoke-Cli @('stop', '--timeout', '60')
  if ($code -ne 0) { throw 'Knowstead ließ sich nicht beenden – siehe Meldung oben.' }
}

function Start-Knowstead {
  if ($service) {
    Write-Host 'Windows-Dienst »Knowstead« wird gestartet …'
    Start-Service -Name $ServiceName
  } elseif ($task) {
    Write-Host 'Geplante Aufgabe \Knowstead\Knowstead wird gestartet …'
    Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
  } else {
    throw 'Für Knowstead ist kein Autostart eingerichtet – Knowstead-Installation.cmd ausführen oder start.cmd verwenden.'
  }
  for ($i = 0; $i -lt 120; $i++) {
    if (Test-Health) { Write-Host "Knowstead läuft (http://localhost:$port)." -ForegroundColor Green; return }
    Start-Sleep -Milliseconds 500
  }
  throw "Knowstead antwortet nicht. Protokoll: $logFile"
}

switch ($Action) {
  'start' { Start-Knowstead }
  'stop' { Stop-Knowstead }
  'restart' { Stop-Knowstead; Start-Knowstead }
  'log' {
    if (-not (Test-Path -LiteralPath $logFile)) { throw "Kein Protokoll unter $logFile" }
    if ($Follow) { Get-Content -LiteralPath $logFile -Tail $Lines -Wait -Encoding UTF8 } else { Get-Content -LiteralPath $logFile -Tail $Lines -Encoding UTF8 }
  }
  default {
    $mode = 'kein Autostart'
    if ($service) { $mode = "Windows-Dienst »Knowstead« ($($service.Status))" }
    elseif ($task) { $mode = "geplante Aufgabe \Knowstead\Knowstead ($($task.State))" }
    Write-Host "Betriebsart:  $mode"
    Write-Host ("Erreichbar:   {0}" -f $(if (Test-Health) { "ja, http://localhost:$port" } else { 'nein' }))
    Write-Host "Protokoll:    $logFile"
    Write-Host ''
    [void](Invoke-Cli @('status'))
  }
}
