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
.EXAMPLE
  .\Knowstead-Dienst.cmd status -Language en
#>
param(
  [Parameter(Position = 0)][ValidateSet('start', 'stop', 'restart', 'status', 'log')][string]$Action = 'status',
  [switch]$Follow,
  [int]$Lines = 60,
  # Sprache der Meldungen: de oder en – sonst KNOWSTEAD_LANG, sonst die Anzeigesprache von Windows
  [ValidateSet('', 'de', 'en')][string]$Language = ''
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$TaskPath = '\Knowstead\'
$TaskName = 'Knowstead'
$ServiceName = 'Knowstead'

$script:Lang = $Language
if (-not $script:Lang) { $script:Lang = [string]$env:KNOWSTEAD_LANG }
if (-not $script:Lang) { $script:Lang = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName }
if ($script:Lang -like 'de*') { $script:Lang = 'de' } else { $script:Lang = 'en' }

# Text in der gewählten Sprache: T 'deutsch' 'english'
function T([string]$De, [string]$En) {
  if ($script:Lang -eq 'en') { return $En }
  return $De
}

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
  if (-not $node) { throw (T 'Node.js wurde nicht gefunden.' 'Node.js was not found.') }
  Push-Location $Root
  try {
    & $node.Source --disable-warning=ExperimentalWarning server\src\cli.ts @Arguments | Out-Host
    return $LASTEXITCODE
  } finally { Pop-Location }
}

function Stop-Knowstead {
  if ($service -and $service.Status -eq 'Running') {
    Write-Host (T 'Windows-Dienst »Knowstead« wird beendet …' 'Stopping the Windows service Knowstead …')
    Stop-Service -Name $ServiceName -Force
  }
  $code = Invoke-Cli @('stop', '--timeout', '60')
  if ($code -ne 0) { throw (T 'Knowstead ließ sich nicht beenden – siehe Meldung oben.' 'Knowstead could not be stopped – see the message above.') }
}

function Start-Knowstead {
  if ($service) {
    Write-Host (T 'Windows-Dienst »Knowstead« wird gestartet …' 'Starting the Windows service Knowstead …')
    Start-Service -Name $ServiceName
  } elseif ($task) {
    Write-Host (T 'Geplante Aufgabe \Knowstead\Knowstead wird gestartet …' 'Starting the scheduled task \Knowstead\Knowstead …')
    Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
  } else {
    throw (T 'Für Knowstead ist kein Autostart eingerichtet – Knowstead-Installation.cmd ausführen oder start.cmd verwenden.' 'No autostart is set up for Knowstead – run Knowstead-Installation.cmd or use start.cmd.')
  }
  for ($i = 0; $i -lt 120; $i++) {
    if (Test-Health) { Write-Host (T "Knowstead läuft (http://localhost:$port)." "Knowstead is running (http://localhost:$port).") -ForegroundColor Green; return }
    Start-Sleep -Milliseconds 500
  }
  throw (T "Knowstead antwortet nicht. Protokoll: $logFile" "Knowstead does not respond. Log: $logFile")
}

switch ($Action) {
  'start' { Start-Knowstead }
  'stop' { Stop-Knowstead }
  'restart' { Stop-Knowstead; Start-Knowstead }
  'log' {
    if (-not (Test-Path -LiteralPath $logFile)) { throw (T "Kein Protokoll unter $logFile" "No log at $logFile") }
    if ($Follow) { Get-Content -LiteralPath $logFile -Tail $Lines -Wait -Encoding UTF8 } else { Get-Content -LiteralPath $logFile -Tail $Lines -Encoding UTF8 }
  }
  default {
    $mode = (T 'kein Autostart' 'no autostart')
    if ($service) { $mode = (T "Windows-Dienst »Knowstead« ($($service.Status))" "Windows service Knowstead ($($service.Status))") }
    elseif ($task) { $mode = (T "geplante Aufgabe \Knowstead\Knowstead ($($task.State))" "scheduled task \Knowstead\Knowstead ($($task.State))") }
    Write-Host (T "Betriebsart:  $mode" "Runs as:      $mode")
    Write-Host ((T 'Erreichbar:   {0}' 'Reachable:    {0}') -f $(if (Test-Health) { (T "ja, http://localhost:$port" "yes, http://localhost:$port") } else { (T 'nein' 'no') }))
    Write-Host (T "Protokoll:    $logFile" "Log:          $logFile")
    Write-Host ''
    [void](Invoke-Cli @('status'))
  }
}
