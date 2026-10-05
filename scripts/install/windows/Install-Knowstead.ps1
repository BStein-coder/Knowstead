<#
.SYNOPSIS
  Knowstead installieren, aktualisieren oder den Autostart entfernen (Windows).

.DESCRIPTION
  Ohne Parameter startet ein grafischer Assistent, der alle Angaben abfragt: Datenverzeichnis,
  Erreichbarkeit (Reverse-Proxy), Autostart als geplante Aufgabe oder Dienst (NSSM), Firewall,
  Virenscanner-Ausnahme und Zusatzprogramme (Tesseract, LibreOffice). Danach richtet er alles ein,
  prüft die Installation und öffnet die Ersteinrichtung im Browser.

  Mit -Unattended läuft dasselbe ohne Rückfragen – nicht angegebene Werte stammen aus der vorhandenen
  .env bzw. aus den Standardwerten. Das eignet sich auch für Updates: neue Programmdateien einspielen,
  dann "Knowstead-Installation.cmd -Unattended" ausführen.

.PARAMETER Unattended
  Ohne Oberfläche und Rückfragen ausführen.
.PARAMETER DataDir
  Datenverzeichnis (lokales Laufwerk, außerhalb des Programmordners), z. B. D:\KnowsteadDaten.
.PARAMETER Port
  Port des Servers (Standard 3000).
.PARAMETER BaseUrl
  Öffentliche Adresse, z. B. https://knowstead.firma.de.
.PARAMETER Access
  LocalProxy  = Reverse-Proxy auf diesem Server (Knowstead lauscht nur auf 127.0.0.1) – empfohlen
  RemoteProxy = Reverse-Proxy auf einem anderen Rechner (-ProxyAddress angeben)
  Direct      = direkt im Netzwerk ohne Proxy (nur für Tests, kein HTTPS)
.PARAMETER Service
  Task = Autostart als geplante Aufgabe (ohne Zusatzsoftware), Nssm = Windows-Dienst mit NSSM, None = kein Autostart.
.PARAMETER InstallTesseract
  Texterkennung: Tesseract mit winget installieren, falls es fehlt (UB-Mannheim.TesseractOCR), fehlende
  Sprachdaten ergänzen und die Texterkennung einschalten.
.PARAMETER OcrLanguages
  Sprachen der Texterkennung als Tesseract-Kürzel, z. B. deu+eng (Standard) oder deu+eng+fra.
.PARAMETER InstallLibreOffice
  Office-Vorschau: LibreOffice mit winget installieren, falls es fehlt (TheDocumentFoundation.LibreOffice),
  und die Vorschau für Word-, Excel-, PowerPoint- und Visio-Dateien einschalten.
.PARAMETER Uninstall
  Autostart, Firewall-Regel und Virenscanner-Ausnahmen entfernen. Programm und Daten bleiben erhalten.
.PARAMETER SelfTest
  Oberfläche aufbauen und jede Seite als Bild in diesen Ordner speichern, ohne etwas zu verändern.

.EXAMPLE
  .\Knowstead-Installation.cmd
.EXAMPLE
  .\Knowstead-Installation.cmd -Unattended -DataDir D:\KnowsteadDaten -BaseUrl https://knowstead.firma.de -Access LocalProxy
.EXAMPLE
  .\Knowstead-Installation.cmd -Unattended -InstallTesseract -InstallLibreOffice
.EXAMPLE
  .\Knowstead-Installation.cmd -Unattended -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Unattended,
  [string]$DataDir,
  [int]$Port = 0,
  [string]$BaseUrl,
  [ValidateSet('', 'LocalProxy', 'RemoteProxy', 'Direct')][string]$Access = '',
  [string]$ProxyAddress,
  [ValidateSet('', 'Task', 'Nssm', 'None')][string]$Service = '',
  [string]$NssmPath,
  [switch]$NoFirewall,
  [switch]$NoDefenderExclusion,
  [string]$TesseractPath,
  [string]$LibreOfficePath,
  [switch]$InstallTesseract,
  [switch]$InstallLibreOffice,
  [string]$OcrLanguages,
  [switch]$SkipPrepare,
  [switch]$Uninstall,
  [switch]$NoBrowser,
  [switch]$NoElevate,
  # Nur für Tests: abweichende .env (der Autostart nutzt immer die .env im Programmordner)
  [string]$EnvPath,
  [string]$SelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$TaskPath = '\Knowstead\'
$TaskName = 'Knowstead'
$ServiceName = 'Knowstead'
$FirewallRule = 'Knowstead'
$AccentColor = $null
$script:Gui = $null
$script:Scale = 1.0
$ContentWidth = 560
$script:LogLines = New-Object System.Collections.Generic.List[string]
$script:DoneEvent = $null
# Lief Knowstead, bevor der Assistent es angehalten hat? 'Service', 'Task' oder leer – siehe Restore-Knowstead
$script:WasRunning = ''
# Hinweise zu den Zusatzprogrammen: Sie halten die Installation nicht auf und stehen am Ende noch einmal
$script:Notes = New-Object System.Collections.Generic.List[string]

# ------------------------------------------------------------------------------------------------
#  Grundlagen
# ------------------------------------------------------------------------------------------------

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Log([string]$Text) {
  $script:LogLines.Add($Text)
  if ($script:Gui) {
    $box = $script:Gui.LogBox
    $box.AppendText($Text + [Environment]::NewLine)
    [System.Windows.Forms.Application]::DoEvents()
  } else {
    Write-Host $Text
  }
}

function Update-Ui {
  if ($script:Gui) { [System.Windows.Forms.Application]::DoEvents() }
}

function Get-NodeInfo {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  $version = (& $cmd.Source --version 2>$null)
  if (-not $version) { return $null }
  $major = [int](($version -replace '^v', '').Split('.')[0])
  return [pscustomobject]@{ Path = $cmd.Source; Version = $version.Trim(); Major = $major }
}

function Update-PathFromRegistry {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Read-KnowsteadEnv([string]$File) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $File)) { return $values }
  foreach ($line in [IO.File]::ReadAllLines($File, [Text.Encoding]::UTF8)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $value = $Matches[2].Trim()
      if ($value -match "^'(.*)'$" -or $value -match '^"(.*)"$') { $value = $Matches[1] } else { $value = ($value -replace '\s+#.*$', '') }
      $values[$Matches[1]] = $value
    }
  }
  return $values
}

function Get-ExistingInstall {
  $envFile = Join-Path $Root '.env'
  $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    Env = (Read-KnowsteadEnv $envFile)
    HasEnv = (Test-Path -LiteralPath $envFile)
    Task = $task
    ServiceObj = $svc
  }
}

function Find-Program([string[]]$Candidates, [string]$CommandName) {
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return ''
}

function Find-Tesseract {
  return Find-Program @("$env:ProgramFiles\Tesseract-OCR\tesseract.exe", "${env:ProgramFiles(x86)}\Tesseract-OCR\tesseract.exe") 'tesseract.exe'
}

function Find-LibreOffice {
  return Find-Program @("$env:ProgramFiles\LibreOffice\program\soffice.exe", "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe") 'soffice.exe'
}

function Test-Winget {
  return [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
}

# Sprachen, die ein installiertes Tesseract kennt (»osd« – Schrift- und Lageerkennung – ist keine Sprache)
function Get-TesseractLanguages([string]$Path) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Path
    $psi.Arguments = '--list-langs'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $text = $proc.StandardOutput.ReadToEnd() + "`n" + $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
  } catch {
    return @()
  }
  return @($text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[a-z_]{3,20}$' -and $_ -ne 'osd' })
}

function Find-Nssm {
  return Find-Program @("$env:ProgramFiles\nssm\win64\nssm.exe", 'C:\Tools\nssm\nssm.exe', "$env:ProgramFiles\nssm\nssm.exe") 'nssm.exe'
}

function Get-HostName {
  try { return [System.Net.Dns]::GetHostEntry('').HostName.ToLower() } catch { return $env:COMPUTERNAME.ToLower() }
}

function Get-DefaultBaseUrl([string]$AccessMode, [int]$PortValue) {
  $name = Get-HostName
  if ($AccessMode -eq 'Direct') { return "http://${name}:$PortValue" }
  return "https://$name"
}

function Get-LocalServiceAccount {
  # Name des Kontos »Lokaler Dienst« in der Sprache des Systems (NT-AUTORITÄT\LOKALER DIENST …)
  return (New-Object Security.Principal.SecurityIdentifier('S-1-5-19')).Translate([Security.Principal.NTAccount]).Value
}

function Get-JsonValue($Object, [string]$Name) {
  # Optionale Felder aus JSON lesen, ohne dass der Strict-Modus bei fehlenden Eigenschaften abbricht
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

function ConvertTo-ProcessArgument([string]$Value) {
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', { param($m) ($m.Groups[1].Value * 2) + '\"' })
  $escaped = [regex]::Replace($escaped, '(\\+)$', { param($m) $m.Groups[1].Value * 2 })
  return '"' + $escaped + '"'
}

# ------------------------------------------------------------------------------------------------
#  Einstellungen zusammenstellen
# ------------------------------------------------------------------------------------------------

function New-InstallOptions {
  $existing = Get-ExistingInstall
  $envValues = $existing.Env
  $opts = [ordered]@{}
  $opts.DataDir = $DataDir
  if (-not $opts.DataDir) { if ($envValues.ContainsKey('DATA_DIR')) { $opts.DataDir = $envValues['DATA_DIR'] } else { $opts.DataDir = Join-Path (Split-Path $Root -Qualifier) 'KnowsteadDaten' } }
  $opts.Port = $Port
  if ($opts.Port -le 0) { if ($envValues.ContainsKey('PORT')) { $opts.Port = [int]$envValues['PORT'] } else { $opts.Port = 3000 } }
  $opts.Access = $Access
  if (-not $opts.Access) {
    $hostValue = ''; if ($envValues.ContainsKey('HOST')) { $hostValue = $envValues['HOST'] }
    $trust = ''; if ($envValues.ContainsKey('TRUST_PROXY')) { $trust = $envValues['TRUST_PROXY'] }
    if ($hostValue -eq '127.0.0.1' -or -not $existing.HasEnv) { $opts.Access = 'LocalProxy' }
    elseif ($trust -and $trust -ne 'false' -and $trust -ne 'loopback') { $opts.Access = 'RemoteProxy' }
    else { $opts.Access = 'Direct' }
  }
  $opts.ProxyAddress = $ProxyAddress
  if (-not $opts.ProxyAddress -and $opts.Access -eq 'RemoteProxy' -and $envValues.ContainsKey('TRUST_PROXY')) { $opts.ProxyAddress = $envValues['TRUST_PROXY'] }
  $opts.BaseUrl = $BaseUrl
  if (-not $opts.BaseUrl) { if ($envValues.ContainsKey('BASE_URL')) { $opts.BaseUrl = $envValues['BASE_URL'] } else { $opts.BaseUrl = Get-DefaultBaseUrl $opts.Access $opts.Port } }
  $opts.Service = $Service
  if (-not $opts.Service) {
    if ($existing.ServiceObj) { $opts.Service = 'Nssm' }
    elseif ($existing.Task -or -not $existing.HasEnv) { $opts.Service = 'Task' }
    elseif ($envValues.ContainsKey('KNOWSTEAD_SERVICE') -and $envValues['KNOWSTEAD_SERVICE'] -eq 'task') { $opts.Service = 'Task' }
    else { $opts.Service = 'None' }
  }
  $opts.NssmPath = $NssmPath
  if (-not $opts.NssmPath) { $opts.NssmPath = Find-Nssm }
  $opts.Firewall = -not $NoFirewall
  $opts.DefenderExclusion = -not $NoDefenderExclusion
  $opts.TesseractPath = $TesseractPath
  $opts.LibreOfficePath = $LibreOfficePath
  $opts.InstallTesseract = [bool]$InstallTesseract
  $opts.InstallLibreOffice = [bool]$InstallLibreOffice
  $opts.OcrLanguages = $OcrLanguages
  if (-not $opts.OcrLanguages) { $opts.OcrLanguages = 'deu+eng' }
  # Installation gewünscht: Was schon da ist, wird genutzt statt neu installiert
  if ($opts.InstallTesseract -and -not $opts.TesseractPath) { $opts.TesseractPath = Find-Tesseract }
  if ($opts.InstallLibreOffice -and -not $opts.LibreOfficePath) { $opts.LibreOfficePath = Find-LibreOffice }
  $opts.UseTesseract = [bool]$TesseractPath -or $opts.InstallTesseract
  $opts.UseLibreOffice = [bool]$LibreOfficePath -or $opts.InstallLibreOffice
  $opts.SkipPrepare = [bool]$SkipPrepare
  $opts.Existing = $existing
  return $opts
}

function Test-InstallOptions($opts) {
  $errors = New-Object System.Collections.Generic.List[string]
  if (-not $opts.DataDir) { $errors.Add('Bitte ein Datenverzeichnis angeben.') }
  elseif ($opts.DataDir.StartsWith('\\')) { $errors.Add('Das Datenverzeichnis muss auf einem lokalen Laufwerk liegen (keine Netzfreigabe).') }
  elseif (-not [IO.Path]::IsPathRooted($opts.DataDir)) { $errors.Add('Bitte einen vollständigen Pfad für das Datenverzeichnis angeben, z. B. D:\KnowsteadDaten.') }
  if ($opts.Port -lt 1 -or $opts.Port -gt 65535) { $errors.Add('Der Port muss zwischen 1 und 65535 liegen.') }
  $uri = $null
  if (-not [Uri]::TryCreate($opts.BaseUrl, [UriKind]::Absolute, [ref]$uri) -or ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https')) {
    $errors.Add('Die Adresse muss mit http:// oder https:// beginnen, z. B. https://knowstead.firma.de.')
  }
  if ($opts.Access -eq 'RemoteProxy') {
    $ip = $null
    if (-not $opts.ProxyAddress -or -not [System.Net.IPAddress]::TryParse(($opts.ProxyAddress -split '/')[0], [ref]$ip)) {
      $errors.Add('Bitte die IP-Adresse des Reverse-Proxys angeben (z. B. 10.0.0.5).')
    }
  }
  if ($opts.Service -eq 'Nssm' -and (-not $opts.NssmPath -or -not (Test-Path -LiteralPath $opts.NssmPath))) {
    $errors.Add('Für den Windows-Dienst wird nssm.exe benötigt – bitte den Pfad angeben (https://nssm.cc/download) oder die geplante Aufgabe wählen.')
  }
  # Fehlt das Programm und soll es installiert werden, steht der Pfad erst nach der Installation fest
  $installOcr = $opts.InstallTesseract -and -not $opts.TesseractPath
  $installOffice = $opts.InstallLibreOffice -and -not $opts.LibreOfficePath
  if ($opts.UseTesseract -and -not $installOcr -and (-not $opts.TesseractPath -or -not (Test-Path -LiteralPath $opts.TesseractPath))) { $errors.Add("Tesseract wurde nicht gefunden: $($opts.TesseractPath)") }
  if ($opts.UseLibreOffice -and -not $installOffice -and (-not $opts.LibreOfficePath -or -not (Test-Path -LiteralPath $opts.LibreOfficePath))) { $errors.Add("LibreOffice wurde nicht gefunden: $($opts.LibreOfficePath)") }
  if ($opts.UseTesseract -and $opts.OcrLanguages -notmatch '^[a-z_]{3,20}(\+[a-z_]{3,20}){0,5}$') { $errors.Add('Sprachen der Texterkennung (Tesseract) bitte als Kürzel angeben, z. B. deu+eng.') }
  if (($installOcr -or $installOffice) -and -not (Test-Winget)) {
    $errors.Add('Für die Installation von Tesseract oder LibreOffice wird winget benötigt (App-Installer aus dem Microsoft Store) – oder die Programme von Hand installieren und den Pfad angeben.')
  }
  return $errors
}

function Get-EnvSettings($opts) {
  switch ($opts.Access) {
    'LocalProxy' { return @{ Host = '127.0.0.1'; TrustProxy = 'loopback' } }
    'RemoteProxy' { return @{ Host = '0.0.0.0'; TrustProxy = $opts.ProxyAddress } }
    default { return @{ Host = '0.0.0.0'; TrustProxy = 'false' } }
  }
}

function Get-InstallPlan($opts) {
  $net = Get-EnvSettings $opts
  $plan = New-Object System.Collections.Generic.List[string]
  $plan.Add("Programmordner:      $Root")
  $plan.Add("Datenverzeichnis:    $($opts.DataDir)")
  $plan.Add("Adresse:             $($opts.BaseUrl)")
  $plan.Add("Port:                $($opts.Port) (lauscht auf $($net.Host))")
  switch ($opts.Access) {
    'LocalProxy' { $plan.Add('Zugriff:             über einen Reverse-Proxy auf diesem Server (HTTPS)') }
    'RemoteProxy' { $plan.Add("Zugriff:             über den Reverse-Proxy $($opts.ProxyAddress)") }
    default { $plan.Add('Zugriff:             direkt im Netzwerk (ohne HTTPS – nur für Tests)') }
  }
  $plan.Add('')
  $plan.Add('Schritte:')
  if ($opts.Existing.Task -or $opts.Existing.ServiceObj) { $plan.Add('  • laufenden Knowstead-Server geordnet beenden') }
  $plan.Add('  • Konfiguration (.env) schreiben – bisherige Datei wird gesichert, Serverschlüssel bleibt')
  if ($opts.SkipPrepare) { $plan.Add('  • Abhängigkeiten und Oberfläche: übersprungen') } else { $plan.Add('  • Abhängigkeiten installieren und Oberfläche bauen (beim ersten Mal einige Minuten)') }
  $plan.Add('  • Probestart und Prüfung der Installation')
  switch ($opts.Service) {
    'Task' { $plan.Add('  • Autostart als geplante Aufgabe »\Knowstead\Knowstead« (Konto »Lokaler Dienst«, Neustart bei Fehlern)') }
    'Nssm' { $plan.Add("  • Windows-Dienst »Knowstead« mit NSSM ($($opts.NssmPath))") }
    default { $plan.Add('  • kein Autostart – Start von Hand mit start.cmd') }
  }
  if ($opts.Service -ne 'None') { $plan.Add('  • Rechte: Lesen auf den Programmordner, Ändern auf das Datenverzeichnis für das Dienstkonto') }
  if ($opts.Firewall -and $opts.Access -ne 'LocalProxy') {
    if ($opts.Access -eq 'RemoteProxy') { $plan.Add("  • Firewall: Port $($opts.Port) nur für $($opts.ProxyAddress) öffnen") } else { $plan.Add("  • Firewall: Port $($opts.Port) im Domänen- und privaten Netzwerk öffnen") }
  }
  if ($opts.DefenderExclusion) { $plan.Add('  • Microsoft Defender: Datenbankdateien vom Echtzeit-Scan ausnehmen') }
  if ($opts.InstallTesseract -and -not $opts.TesseractPath) { $plan.Add("  • Tesseract mit winget installieren (UB-Mannheim.TesseractOCR), Sprachdaten $($opts.OcrLanguages) ergänzen, Texterkennung einschalten") }
  elseif ($opts.UseTesseract) { $plan.Add("  • Texterkennung mit Tesseract einschalten ($($opts.TesseractPath))") }
  if ($opts.InstallLibreOffice -and -not $opts.LibreOfficePath) { $plan.Add('  • LibreOffice mit winget installieren (TheDocumentFoundation.LibreOffice), Office-Vorschau einschalten') }
  elseif ($opts.UseLibreOffice) { $plan.Add("  • Office-Vorschau mit LibreOffice einschalten ($($opts.LibreOfficePath))") }
  if ($opts.Service -ne 'None') { $plan.Add('  • Knowstead starten und Erreichbarkeit prüfen') }
  return $plan
}

# ------------------------------------------------------------------------------------------------
#  Ausführen
# ------------------------------------------------------------------------------------------------

function Set-Progress([int]$Percent, [string]$Status) {
  if ($script:Gui) {
    $script:Gui.Progress.Value = [Math]::Max(0, [Math]::Min(100, $Percent))
    $script:Gui.Status.Text = $Status
    Update-Ui
  } else {
    Write-Host ''
    Write-Host "== $Status" -ForegroundColor Cyan
  }
}

$StepProgress = @{ node = 8; config = 12; dirs = 16; prepare = 20; test = 70; extras = 78; doctor = 82 }

function Invoke-NodeScript([string]$NodePath, [string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodePath
  $psi.Arguments = (($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $proc = [System.Diagnostics.Process]::Start($psi)
  $out = $proc.StandardOutput.ReadLineAsync()
  $err = $proc.StandardError.ReadLineAsync()
  while ($out -or $err) {
    $busy = $false
    if ($out -and $out.IsCompleted) {
      $line = $out.Result
      if ($null -eq $line) { $out = $null } else { Receive-ScriptLine $line; $out = $proc.StandardOutput.ReadLineAsync() }
      $busy = $true
    }
    if ($err -and $err.IsCompleted) {
      $line = $err.Result
      if ($null -eq $line) { $err = $null } else { Write-Log $line; $err = $proc.StandardError.ReadLineAsync() }
      $busy = $true
    }
    if (-not $busy) { Update-Ui; Start-Sleep -Milliseconds 25 }
  }
  $proc.WaitForExit()
  return $proc.ExitCode
}

function Receive-ScriptLine([string]$Line) {
  $prefix = '@@KNOWSTEAD '
  if ($Line.StartsWith($prefix)) {
    $event = $Line.Substring($prefix.Length) | ConvertFrom-Json
    # In der Konsole schreibt der Installationskern die Schritte selbst – nur die Oberfläche braucht den Fortschritt
    if ($script:Gui -and $event.event -eq 'step' -and $StepProgress.ContainsKey([string](Get-JsonValue $event 'id'))) { Set-Progress $StepProgress[$event.id] $event.title }
    elseif ($event.event -eq 'done') { $script:DoneEvent = $event }
    return
  }
  Write-Log $Line
}

function Invoke-Checked([string]$Description, [scriptblock]$Action) {
  # -WhatIf: nur beschreiben, was geschehen würde
  if ($WhatIfPreference) {
    Write-Log "  (Probelauf) $Description"
    return
  }
  Write-Log "  ▸ $Description"
  & $Action
}

function Add-Note([string]$Text) {
  $script:Notes.Add($Text)
  Write-Log "  [!] $Text"
}

# Programm aus der Paketquelle von winget installieren. $true, wenn es danach vorhanden sein sollte.
function Install-WingetPackage([string]$Id, [string]$Name) {
  $arguments = @('install', '--id', $Id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  if ($WhatIfPreference) {
    Write-Log "  (Probelauf) winget $($arguments -join ' ')"
    return $true
  }
  if (-not (Test-Winget)) {
    Write-Log "  [!] winget ist nicht vorhanden – $Name bitte von Hand installieren."
    return $false
  }
  Write-Log "  ▸ $Name mit winget installieren ($Id) – das kann einige Minuten dauern"
  Update-Ui
  $proc = Start-Process winget.exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  Update-PathFromRegistry
  # 0 = installiert; -1978335189 = bereits vorhanden und aktuell
  if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq -1978335189) { return $true }
  Write-Log "  [!] winget meldet Fehler $($proc.ExitCode) – $Name wurde nicht installiert."
  return $false
}

# Fehlende Sprachdaten nachladen. Der Installer von UB Mannheim bringt ohne Auswahl nur Englisch mit;
# die Dateien stammen aus dem Projekt selbst (github.com/tesseract-ocr/tessdata_fast).
function Add-TesseractLanguages([string]$Path, [string]$Languages) {
  $have = @(Get-TesseractLanguages $Path)
  $missing = @($Languages -split '\+' | Where-Object { $_ -match '^[a-z_]{3,20}$' -and ($have -notcontains $_) })
  if (-not $missing.Count) { return }
  $tessdata = Join-Path (Split-Path -Parent $Path) 'tessdata'
  foreach ($lang in $missing) {
    $url = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata"
    $target = Join-Path $tessdata "$lang.traineddata"
    if ($WhatIfPreference) {
      Write-Log "  (Probelauf) Sprachdaten laden: $url → $target"
      continue
    }
    try {
      Write-Log "  ▸ Sprachdaten »$lang« laden ($url)"
      Update-Ui
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile "$target.download" -UseBasicParsing
      if ((Get-Item -LiteralPath "$target.download").Length -lt 100KB) { throw 'Die Datei ist zu klein – vermutlich keine Sprachdaten.' }
      Move-Item -LiteralPath "$target.download" -Destination $target -Force
    } catch {
      Write-Log "  [!] Sprachdaten »$lang« ließen sich nicht laden: $($_.Exception.Message)"
      Write-Log "      Von Hand: $url herunterladen und nach $tessdata kopieren, danach die Sprachen unter Administration → KI & Dateien eintragen."
      Remove-Item -LiteralPath "$target.download" -Force -ErrorAction SilentlyContinue
    }
  }
}

# Zusatzprogramme installieren, bevor der Server angehalten wird – so lange läuft ein vorhandenes Knowstead weiter.
# Scheitert die Installation, geht es ohne die Zusatzfunktion weiter.
function Install-KnowsteadExtras($opts) {
  if ($opts.InstallTesseract -and -not $opts.TesseractPath) {
    Set-Progress 4 'Tesseract installieren'
    if (Install-WingetPackage 'UB-Mannheim.TesseractOCR' 'Tesseract') { $opts.TesseractPath = Find-Tesseract }
    if (-not $opts.TesseractPath) {
      if ($WhatIfPreference) { Write-Log '  (Probelauf) Danach: Texterkennung einschalten' }
      else { Add-Note 'Texterkennung: Tesseract wurde nicht installiert oder danach nicht gefunden – Knowstead wird ohne Texterkennung eingerichtet.' }
      $opts.UseTesseract = $false
    }
  }
  if ($opts.UseTesseract -and $opts.TesseractPath -and ($opts.InstallTesseract -or $OcrLanguages)) {
    Add-TesseractLanguages $opts.TesseractPath $opts.OcrLanguages
  }
  if ($opts.InstallLibreOffice -and -not $opts.LibreOfficePath) {
    Set-Progress 6 'LibreOffice installieren'
    if (Install-WingetPackage 'TheDocumentFoundation.LibreOffice' 'LibreOffice') { $opts.LibreOfficePath = Find-LibreOffice }
    if (-not $opts.LibreOfficePath) {
      if ($WhatIfPreference) { Write-Log '  (Probelauf) Danach: Office-Vorschau einschalten' }
      else { Add-Note 'Office-Vorschau: LibreOffice wurde nicht installiert oder danach nicht gefunden – Knowstead wird ohne Office-Vorschau eingerichtet.' }
      $opts.UseLibreOffice = $false
    }
  }
}

function Stop-Knowstead($NodePath, $opts) {
  $existing = $opts.Existing
  if (-not ($existing.Task -or $existing.ServiceObj)) { return }
  # Lief Knowstead? Dann wird es nach einem Fehlschlag wieder gestartet (Restore-Knowstead).
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') { $script:WasRunning = 'Service' }
  elseif ($task -and $task.State -eq 'Running') { $script:WasRunning = 'Task' }
  Invoke-Checked 'Laufenden Knowstead-Server geordnet beenden' {
    # NSSM zuerst: es sendet Strg+C und würde ein selbst beendetes Programm sofort neu starten
    if ($existing.ServiceObj -and $existing.ServiceObj.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force }
    $code = Invoke-NodeScript $NodePath @('--disable-warning=ExperimentalWarning', 'server\src\cli.ts', 'stop', '--timeout', '60')
    if ($code -ne 0) { throw 'Der laufende Server ließ sich nicht beenden.' }
    if ($existing.Task) { Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue }
  }
}

# Nach einem Fehlschlag: Lief Knowstead vorher, wird es wieder gestartet – ein Update soll kein stehendes Knowstead hinterlassen.
function Restore-Knowstead {
  $was = $script:WasRunning
  $script:WasRunning = ''
  if ($WhatIfPreference -or -not $was) { return }
  Write-Log ''
  Write-Log 'Die Einrichtung wurde nicht abgeschlossen. Knowstead lief vorher – es wird wieder gestartet.'
  try {
    if ($was -eq 'Service') { Start-Service -Name $ServiceName }
    else { Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName }
    Write-Log '  Knowstead wurde wieder gestartet.'
  } catch {
    Write-Log "  [!] Knowstead ließ sich nicht wieder starten: $($_.Exception.Message)"
  }
}

function Grant-Access([string]$Account, $opts) {
  Invoke-Checked "Rechte für $Account setzen" {
    # Vererbbare Rechte am Ordner genügen – icacls überträgt sie auf vorhandene Dateien
    $null = & icacls.exe $Root /grant '*S-1-5-19:(OI)(CI)RX' /C /Q
    if (-not (Test-Path -LiteralPath $opts.DataDir)) { New-Item -ItemType Directory -Force -Path $opts.DataDir | Out-Null }
    $null = & icacls.exe $opts.DataDir /grant '*S-1-5-19:(OI)(CI)M' /C /Q
    if ($LASTEXITCODE -ne 0) { throw "Rechte für das Datenverzeichnis ließen sich nicht setzen (icacls $LASTEXITCODE)." }
  }
}

function Register-KnowsteadTask([string]$NodePath, $opts) {
  $account = Get-LocalServiceAccount
  Grant-Access $account $opts
  Invoke-Checked 'Geplante Aufgabe \Knowstead\Knowstead einrichten (beim Systemstart, Konto »Lokaler Dienst«)' {
    $action = New-ScheduledTaskAction -Execute $NodePath -Argument '--disable-warning=ExperimentalWarning server\src\index.ts' -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType ServiceAccount -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Knowstead – Dokumentation und Wissen. Beenden mit: npm run cli -- stop' -Force | Out-Null
  }
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Log '  Hinweis: Ein Windows-Dienst »Knowstead« existiert zusätzlich – bitte nur eine Betriebsart verwenden.'
  }
}

function Register-KnowsteadNssm([string]$NodePath, $opts) {
  $nssm = $opts.NssmPath
  Grant-Access 'NT AUTHORITY\LocalService' $opts
  Invoke-Checked "Windows-Dienst »Knowstead« mit NSSM einrichten" {
    if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
      & $nssm install $ServiceName $NodePath '--disable-warning=ExperimentalWarning server\src\index.ts' | Out-Null
    }
    $logs = Join-Path $opts.DataDir 'logs'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    & $nssm set $ServiceName Application $NodePath | Out-Null
    & $nssm set $ServiceName AppParameters '--disable-warning=ExperimentalWarning server\src\index.ts' | Out-Null
    & $nssm set $ServiceName AppDirectory $Root | Out-Null
    & $nssm set $ServiceName DisplayName 'Knowstead – Dokumentation' | Out-Null
    & $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
    & $nssm set $ServiceName ObjectName 'NT AUTHORITY\LocalService' | Out-Null
    & $nssm set $ServiceName AppStderr (Join-Path $logs 'dienst-fehler.log') | Out-Null
    & $nssm set $ServiceName AppStopMethodConsole 15000 | Out-Null
    & $nssm set $ServiceName AppRestartDelay 5000 | Out-Null
  }
  if (Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Invoke-Checked 'Bisherige geplante Aufgabe entfernen' { Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false }
  }
}

function Set-KnowsteadFirewall($opts) {
  if (-not $opts.Firewall -or $opts.Access -eq 'LocalProxy') {
    if (Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue) {
      Invoke-Checked 'Nicht mehr benötigte Firewall-Regel »Knowstead« entfernen' { Remove-NetFirewallRule -DisplayName $FirewallRule }
    }
    return
  }
  $remote = 'Any'
  if ($opts.Access -eq 'RemoteProxy') { $remote = $opts.ProxyAddress }
  Invoke-Checked "Firewall-Regel »Knowstead«: Port $($opts.Port) für $remote" {
    Remove-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP -LocalPort $opts.Port -RemoteAddress $remote -Profile Domain, Private -Action Allow | Out-Null
  }
}

function Set-DefenderExclusion($opts) {
  if (-not $opts.DefenderExclusion) { return }
  if (-not (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) {
    Write-Log '  Microsoft Defender ist nicht verfügbar – bei einem anderen Virenscanner knowstead.db, knowstead.db-wal und knowstead.db-shm ausnehmen.'
    return
  }
  Invoke-Checked 'Datenbankdateien vom Echtzeit-Scan ausnehmen' {
    try {
      $files = @('knowstead.db', 'knowstead.db-wal', 'knowstead.db-shm') | ForEach-Object { Join-Path $opts.DataDir $_ }
      Add-MpPreference -ExclusionPath $files
    } catch {
      Write-Log "  Hinweis: Ausnahme ließ sich nicht setzen ($($_.Exception.Message)) – ggf. per Gruppenrichtlinie verwaltet."
    }
  }
}

function Start-Knowstead($opts) {
  switch ($opts.Service) {
    'Task' { Invoke-Checked 'Knowstead starten' { Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName } }
    'Nssm' { Invoke-Checked 'Knowstead starten' { Start-Service -Name $ServiceName } }
    default { return $false }
  }
  if ($WhatIfPreference) { return $true }
  $url = "http://127.0.0.1:$($opts.Port)/api/v1/health"
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -eq 200) { Write-Log "  Knowstead antwortet auf Port $($opts.Port)."; return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
    Update-Ui
  }
  throw "Knowstead ist nach dem Start nicht erreichbar. Protokoll: $(Join-Path $opts.DataDir 'logs\knowstead.log')"
}

function Invoke-KnowsteadInstall($opts) {
  $script:WasRunning = ''
  $script:Notes.Clear()
  try {
    return Invoke-KnowsteadInstallSteps $opts
  } catch {
    Restore-Knowstead
    throw
  }
}

function Invoke-KnowsteadInstallSteps($opts) {
  $node = Get-NodeInfo
  if (-not $node -or $node.Major -lt 24) { throw 'Node.js 24 oder neuer wird benötigt (https://nodejs.org/).' }
  $net = Get-EnvSettings $opts
  $script:LogLines.Clear()
  Set-Progress 3 'Vorbereiten'
  Write-Log "Knowstead-Installation – $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  foreach ($line in (Get-InstallPlan $opts)) { Write-Log $line }
  Write-Log ''

  Install-KnowsteadExtras $opts
  Stop-Knowstead $node.Path $opts

  $serviceHint = 'none'
  if ($opts.Service -eq 'Task') { $serviceHint = 'task' } elseif ($opts.Service -eq 'Nssm') { $serviceHint = 'nssm' }
  $arguments = @('scripts\install.mjs', '--json-progress', '--data-dir', $opts.DataDir, '--port', "$($opts.Port)", '--host', $net.Host, '--base-url', $opts.BaseUrl, '--trust-proxy', $net.TrustProxy, '--service', $serviceHint)
  if ($opts.Service -ne 'None') { $arguments += @('--log-file', 'logs\knowstead.log') }
  if ($opts.SkipPrepare) { $arguments += '--skip-prepare' }
  if ($opts.UseTesseract) {
    $arguments += @('--ocr-path', $opts.TesseractPath)
    # Sprachen nur übergeben, wenn sie gewählt oder gerade installiert wurden – sonst bleibt die Einstellung der Administration
    if ($opts.InstallTesseract -or $OcrLanguages) { $arguments += @('--ocr-languages', $opts.OcrLanguages) }
  }
  if ($opts.UseLibreOffice) { $arguments += @('--office-path', $opts.LibreOfficePath) }
  if ($EnvPath) { $arguments += @('--env-path', $EnvPath) }
  if ($WhatIfPreference) { $arguments += '--dry-run' }
  $script:DoneEvent = $null
  $code = Invoke-NodeScript $node.Path $arguments
  if ($code -ne 0) { throw 'Die Einrichtung ist fehlgeschlagen – Details stehen im Protokoll oben.' }

  Set-Progress 86 'Autostart, Firewall und Virenscanner'
  switch ($opts.Service) {
    'Task' { Register-KnowsteadTask $node.Path $opts }
    'Nssm' { Register-KnowsteadNssm $node.Path $opts }
    default {
      if (Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Invoke-Checked 'Geplante Aufgabe entfernen (kein Autostart gewünscht)' { Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false }
      }
    }
  }
  Set-KnowsteadFirewall $opts
  Set-DefenderExclusion $opts

  Set-Progress 94 'Knowstead starten'
  # Ab hier startet der Assistent Knowstead selbst – ein Fehlschlag soll keinen zweiten Start auslösen
  $script:WasRunning = ''
  $started = Start-Knowstead $opts
  $logDir = Join-Path $opts.DataDir 'logs'
  if (-not $WhatIfPreference) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir ("installation-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    [IO.File]::WriteAllLines($logFile, $script:LogLines, (New-Object Text.UTF8Encoding($true)))
    Write-Log "Protokoll gespeichert: $logFile"
  }
  Set-Progress 100 'Fertig'
  $setupUrl = "http://localhost:$($opts.Port)/setup"
  $needsSetup = $true
  if ($script:DoneEvent -and $null -ne (Get-JsonValue $script:DoneEvent 'needsSetup')) { $needsSetup = [bool]$script:DoneEvent.needsSetup }
  # Hinweise des Assistenten und des Installationskerns zu den Zusatzprogrammen
  $warnings = New-Object System.Collections.Generic.List[string]
  foreach ($note in $script:Notes) { $warnings.Add($note) }
  if ($script:DoneEvent) { foreach ($w in @(Get-JsonValue $script:DoneEvent 'warnings')) { if ($w) { $warnings.Add([string]$w) } } }
  return [pscustomobject]@{ Started = $started; SetupUrl = $setupUrl; LocalUrl = "http://localhost:$($opts.Port)"; NeedsSetup = $needsSetup; Checks = $(if ($script:DoneEvent) { $script:DoneEvent.checks } else { @() }); Warnings = $warnings.ToArray() }
}

function Invoke-KnowsteadUninstall {
  $opts = New-InstallOptions
  $node = Get-NodeInfo
  if ($node) { Stop-Knowstead $node.Path $opts }
  if ($opts.Existing.Task) { Invoke-Checked 'Geplante Aufgabe \Knowstead\Knowstead entfernen' { Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false } }
  if ($opts.Existing.ServiceObj) {
    $nssm = $opts.NssmPath
    Invoke-Checked 'Windows-Dienst »Knowstead« entfernen' {
      if ($nssm -and (Test-Path -LiteralPath $nssm)) { & $nssm remove $ServiceName confirm | Out-Null } else { & sc.exe delete $ServiceName | Out-Null }
    }
  }
  if (Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue) { Invoke-Checked 'Firewall-Regel »Knowstead« entfernen' { Remove-NetFirewallRule -DisplayName $FirewallRule } }
  if (Get-Command Remove-MpPreference -ErrorAction SilentlyContinue) {
    Invoke-Checked 'Virenscanner-Ausnahmen entfernen' {
      try { Remove-MpPreference -ExclusionPath (@('knowstead.db', 'knowstead.db-wal', 'knowstead.db-shm') | ForEach-Object { Join-Path $opts.DataDir $_ }) } catch { }
    }
  }
  Write-Log "Autostart entfernt. Programmordner ($Root) und Datenverzeichnis ($($opts.DataDir)) bleiben unverändert."
}

# ------------------------------------------------------------------------------------------------
#  Grafischer Assistent
# ------------------------------------------------------------------------------------------------

function Initialize-WinForms {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  if (-not ('Knowstead.Dpi' -as [type])) {
    Add-Type -Namespace Knowstead -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  }
  [void][Knowstead.Dpi]::SetProcessDPIAware()
  [System.Windows.Forms.Application]::EnableVisualStyles()
  # Schriften skalieren mit der Anzeigeeinstellung (z. B. 150 %), feste Maße rechnet S() um
  $graphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
  $script:Scale = $graphics.DpiX / 96
  $graphics.Dispose()
  $script:ContentWidth = S 560
  $script:AccentColor = [System.Drawing.ColorTranslator]::FromHtml('#2563eb')
}

function S([double]$Pixels) {
  return [int][Math]::Round($Pixels * $script:Scale)
}

function New-Font([float]$Size = 9.75, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular) {
  return New-Object System.Drawing.Font('Segoe UI', $Size, $Style)
}

function New-Label([string]$Text, [float]$Size = 9.75, [switch]$Bold, [switch]$Muted, [int]$Bottom = 8) {
  $label = New-Object System.Windows.Forms.Label
  # »&« ist hier Text (»KI & Dateien«), kein Tastenkürzel
  $label.UseMnemonic = $false
  $label.Text = $Text
  $label.AutoSize = $true
  $label.MaximumSize = New-Object System.Drawing.Size($script:ContentWidth, 0)
  $style = [System.Drawing.FontStyle]::Regular
  if ($Bold) { $style = [System.Drawing.FontStyle]::Bold }
  $label.Font = New-Font $Size $style
  if ($Muted) { $label.ForeColor = [System.Drawing.Color]::FromArgb(90, 98, 112) }
  $label.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S $Bottom))
  return $label
}

function New-Page([string]$Title, [string]$Intro) {
  $page = New-Object System.Windows.Forms.FlowLayoutPanel
  $page.Dock = 'Fill'
  $page.FlowDirection = 'TopDown'
  $page.WrapContents = $false
  $page.AutoScroll = $true
  $page.Padding = New-Object System.Windows.Forms.Padding((S 28), (S 22), (S 20), (S 10))
  $page.Controls.Add((New-Label $Title 14 -Bold -Bottom 6))
  if ($Intro) { $page.Controls.Add((New-Label $Intro -Muted -Bottom 16)) }
  return $page
}

function Add-Field($Page, [string]$Caption, $Control, [string]$Help) {
  $Page.Controls.Add((New-Label $Caption 9 -Bold -Bottom 3))
  $Control.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 4))
  $Page.Controls.Add($Control)
  if ($Help) { $Page.Controls.Add((New-Label $Help 8.75 -Muted -Bottom 12)) } else { $Control.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 12)) }
}

function New-TextBox([string]$Value, [int]$Width = 0) {
  if ($Width -le 0) { $Width = $script:ContentWidth }
  $box = New-Object System.Windows.Forms.TextBox
  $box.Text = $Value
  $box.Width = $Width
  $box.Font = New-Font
  return $box
}

function New-PathRow([string]$Value, [string]$Mode, [string]$Filter) {
  $row = New-Object System.Windows.Forms.FlowLayoutPanel
  $row.FlowDirection = 'LeftToRight'
  $row.WrapContents = $false
  $row.AutoSize = $true
  $box = New-TextBox $Value ($ContentWidth - (S 110))
  $button = New-Object System.Windows.Forms.Button
  $button.Text = 'Durchsuchen …'
  $button.Width = S 100
  $button.Height = $box.Height + 2
  $button.Margin = New-Object System.Windows.Forms.Padding((S 8), 0, 0, 0)
  $button.Font = New-Font 9
  $button.Tag = $box
  if ($Mode -eq 'folder') {
    $button.Add_Click({
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.SelectedPath = $this.Tag.Text
        if ($dialog.ShowDialog() -eq 'OK') { $this.Tag.Text = $dialog.SelectedPath }
      })
  } else {
    $button.Add_Click({
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Filter = 'Programme (*.exe)|*.exe'
        if ($this.Tag.Text) { $dialog.FileName = $this.Tag.Text }
        if ($dialog.ShowDialog() -eq 'OK') { $this.Tag.Text = $dialog.FileName }
      })
  }
  $box.Margin = New-Object System.Windows.Forms.Padding(0)
  $row.Controls.Add($box)
  $row.Controls.Add($button)
  $row.Tag = $box
  return $row
}

function New-RadioGroup([object[]]$Choices, [string]$Selected) {
  $group = New-Object System.Windows.Forms.FlowLayoutPanel
  $group.FlowDirection = 'TopDown'
  $group.WrapContents = $false
  $group.AutoSize = $true
  $group.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 10))
  foreach ($choice in $Choices) {
    $radio = New-Object System.Windows.Forms.RadioButton
    $radio.Text = $choice[1]
    $radio.Tag = $choice[0]
    $radio.AutoSize = $true
    $radio.Font = New-Font 9.75 ([System.Drawing.FontStyle]::Bold)
    $radio.Checked = ($choice[0] -eq $Selected)
    $radio.Margin = New-Object System.Windows.Forms.Padding(0, (S 4), 0, 0)
    $group.Controls.Add($radio)
    if ($choice.Count -gt 2 -and $choice[2]) {
      $help = New-Label $choice[2] 8.75 -Muted -Bottom 4
      $help.Margin = New-Object System.Windows.Forms.Padding((S 18), 0, 0, (S 4))
      $help.MaximumSize = New-Object System.Drawing.Size(($ContentWidth - (S 20)), 0)
      $group.Controls.Add($help)
    }
  }
  return $group
}

function Get-RadioValue($Group) {
  foreach ($control in $Group.Controls) {
    if ($control -is [System.Windows.Forms.RadioButton] -and $control.Checked) { return [string]$control.Tag }
  }
  return ''
}

function New-CheckBox([string]$Text, [bool]$Checked) {
  $box = New-Object System.Windows.Forms.CheckBox
  $box.Text = $Text
  $box.Checked = $Checked
  $box.AutoSize = $true
  $box.Font = New-Font
  $box.Margin = New-Object System.Windows.Forms.Padding(0, (S 2), 0, (S 6))
  return $box
}

function New-LinkLabel([string]$Text, [string]$Url) {
  $link = New-Object System.Windows.Forms.LinkLabel
  $link.Text = $Text
  $link.AutoSize = $true
  $link.Font = New-Font 9
  $link.Tag = $Url
  $link.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 10))
  $link.Add_LinkClicked({ Start-Process $this.Tag })
  return $link
}

function Show-Wizard {
  Initialize-WinForms
  $opts = New-InstallOptions
  $existing = $opts.Existing
  $node = Get-NodeInfo
  $ui = @{}

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Knowstead – Installation'
  $form.ClientSize = New-Object System.Drawing.Size((S 860), (S 660))
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.Font = New-Font
  $form.BackColor = [System.Drawing.Color]::White
  $form.AutoScaleMode = 'None'

  $header = New-Object System.Windows.Forms.Panel
  $header.Dock = 'Top'
  $header.Height = S 76
  $header.BackColor = $AccentColor
  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Knowstead installieren'
  $title.ForeColor = [System.Drawing.Color]::White
  $title.Font = New-Font 16 ([System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point((S 24), (S 7))
  $subtitle = New-Object System.Windows.Forms.Label
  $version = (Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $subtitle.Text = "Dokumentation und Wissen · Version $version"
  $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(219, 234, 254)
  $subtitle.Font = New-Font 9
  $subtitle.AutoSize = $true
  $subtitle.Location = New-Object System.Drawing.Point((S 26), (S 45))
  $header.Controls.Add($title)
  $header.Controls.Add($subtitle)

  $nav = New-Object System.Windows.Forms.Panel
  $nav.Dock = 'Left'
  $nav.Width = S 216
  $nav.BackColor = [System.Drawing.Color]::FromArgb(243, 246, 251)

  $footer = New-Object System.Windows.Forms.Panel
  $footer.Dock = 'Bottom'
  $footer.Height = S 58
  $footer.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
  $back = New-Object System.Windows.Forms.Button
  $next = New-Object System.Windows.Forms.Button
  $cancel = New-Object System.Windows.Forms.Button
  foreach ($b in @($back, $next, $cancel)) { $b.Size = New-Object System.Drawing.Size((S 116), (S 32)); $b.Font = New-Font 9.75; $footer.Controls.Add($b) }
  $back.Text = '< Zurück'; $back.Location = New-Object System.Drawing.Point((S 468), (S 13))
  $next.Text = 'Weiter >'; $next.Location = New-Object System.Drawing.Point((S 592), (S 13))
  $cancel.Text = 'Abbrechen'; $cancel.Location = New-Object System.Drawing.Point((S 726), (S 13))
  $next.BackColor = $AccentColor; $next.ForeColor = [System.Drawing.Color]::White; $next.FlatStyle = 'Flat'; $next.FlatAppearance.BorderSize = 0

  $content = New-Object System.Windows.Forms.Panel
  $content.Dock = 'Fill'

  $form.Controls.Add($content)
  $form.Controls.Add($nav)
  $form.Controls.Add($footer)
  $form.Controls.Add($header)
  $form.AcceptButton = $next
  $form.CancelButton = $cancel

  # --- Seite 1: Willkommen ---
  $pWelcome = New-Page 'Willkommen' 'Der Assistent richtet Knowstead auf diesem Server ein: Konfiguration, Datenverzeichnis, Autostart, Firewall und Zusatzprogramme. Danach folgt die Ersteinrichtung im Browser. Alle Angaben lassen sich später mit diesem Assistenten ändern.'
  $pWelcome.Controls.Add((New-Label 'Voraussetzungen' 10.5 -Bold -Bottom 6))
  $ui.NodeStatus = New-Label '' -Bottom 4
  $pWelcome.Controls.Add($ui.NodeStatus)
  $nodeButtons = New-Object System.Windows.Forms.FlowLayoutPanel
  $nodeButtons.AutoSize = $true
  $nodeButtons.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 10))
  $ui.InstallNode = New-Object System.Windows.Forms.Button
  $ui.InstallNode.Text = 'Node.js jetzt installieren (winget)'
  $ui.InstallNode.AutoSize = $true
  $ui.NodeLink = New-LinkLabel 'Download-Seite öffnen' 'https://nodejs.org/'
  $ui.NodeLink.Margin = New-Object System.Windows.Forms.Padding((S 10), (S 8), 0, 0)
  $nodeButtons.Controls.Add($ui.InstallNode)
  $nodeButtons.Controls.Add($ui.NodeLink)
  $pWelcome.Controls.Add($nodeButtons)
  $pWelcome.Controls.Add((New-Label "Programmordner: $Root" -Bottom 4))
  if ($existing.HasEnv -or $existing.Task -or $existing.ServiceObj) {
    $mode = @()
    if ($existing.Task) { $mode += 'geplante Aufgabe' }
    if ($existing.ServiceObj) { $mode += 'Windows-Dienst' }
    $modeText = 'ohne Autostart'
    if ($mode.Count) { $modeText = $mode -join ' und ' }
    $pWelcome.Controls.Add((New-Label "Vorhandene Installation erkannt ($modeText). Die bisherigen Angaben sind vorausgefüllt – so lassen sich Einstellungen ändern oder nach dem Einspielen neuer Programmdateien ein Update abschließen." -Bottom 10))
    $ui.Remove = New-Object System.Windows.Forms.Button
    $ui.Remove.Text = 'Autostart entfernen …'
    $ui.Remove.AutoSize = $true
    $pWelcome.Controls.Add($ui.Remove)
  }
  $pWelcome.Controls.Add((New-LinkLabel 'Installationsanleitung öffnen' (Join-Path $Root 'docs\INSTALLATION.md')))

  $refreshNode = {
    $info = Get-NodeInfo
    if ($info -and $info.Major -ge 24) {
      $ui.NodeStatus.Text = "✔  Node.js $($info.Version) gefunden"
      $ui.NodeStatus.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
      $ui.InstallNode.Visible = $false
      $ui.NodeLink.Visible = $false
    } elseif ($info) {
      $ui.NodeStatus.Text = "✖  Node.js $($info.Version) ist zu alt – benötigt wird Version 24 oder neuer."
      $ui.NodeStatus.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    } else {
      $ui.NodeStatus.Text = '✖  Node.js wurde nicht gefunden – benötigt wird Version 24 oder neuer.'
      $ui.NodeStatus.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    }
    $ui.InstallNode.Visible = -not ($info -and $info.Major -ge 24) -and [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
  }
  & $refreshNode
  $ui.InstallNode.Add_Click({
      $answer = [System.Windows.Forms.MessageBox]::Show('Node.js (LTS) wird mit winget von der offiziellen Paketquelle heruntergeladen und installiert. Fortfahren?', 'Node.js installieren', 'YesNo', 'Question')
      if ($answer -ne 'Yes') { return }
      $form.UseWaitCursor = $true
      try {
        $proc = Start-Process winget.exe -ArgumentList @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements') -Wait -PassThru
        Update-PathFromRegistry
        if ($proc.ExitCode -ne 0) { [System.Windows.Forms.MessageBox]::Show("winget meldet Fehler $($proc.ExitCode). Bitte Node.js von https://nodejs.org/ installieren.", 'Node.js', 'OK', 'Warning') | Out-Null }
      } finally {
        $form.UseWaitCursor = $false
        & $refreshNode
      }
    })

  # --- Seite 2: Datenverzeichnis ---
  $pData = New-Page 'Datenverzeichnis' 'Hier liegen Datenbank, Anhänge, Sicherungen, Protokolle und der Serverschlüssel – das Wichtigste für jede Sicherung.'
  $ui.DataDir = New-PathRow $opts.DataDir 'folder'
  Add-Field $pData 'Ordner' $ui.DataDir 'Auf einer lokalen SSD und außerhalb des Programmordners, damit Updates die Daten nicht berühren. Keine Netzfreigabe (SQLite braucht zuverlässige Dateisperren).'
  $ui.DiskInfo = New-Label '' 9 -Muted
  $pData.Controls.Add($ui.DiskInfo)
  $updateDisk = {
    try {
      $drive = [IO.Path]::GetPathRoot($ui.DataDir.Tag.Text)
      $di = New-Object IO.DriveInfo($drive)
      $ui.DiskInfo.Text = ('Freier Speicher auf {0}: {1:N1} GB' -f $drive, ($di.AvailableFreeSpace / 1GB))
    } catch { $ui.DiskInfo.Text = '' }
  }
  $ui.DataDir.Tag.Add_TextChanged($updateDisk)
  & $updateDisk

  # --- Seite 3: Erreichbarkeit ---
  $pAccess = New-Page 'Erreichbarkeit' 'Wie erreichen die Nutzenden Knowstead? Für den Betrieb gehört ein Reverse-Proxy mit HTTPS-Zertifikat davor (IIS, Caddy, nginx) – Beispielkonfigurationen stehen in der Installationsanleitung, Abschnitt 7.'
  $ui.Access = New-RadioGroup @(
    @('LocalProxy', 'Reverse-Proxy auf diesem Server (empfohlen)', 'Knowstead lauscht nur auf 127.0.0.1 – von außen ist nur der Proxy erreichbar.'),
    @('RemoteProxy', 'Reverse-Proxy auf einem anderen Rechner', 'Knowstead lauscht im Netzwerk; die Firewall lässt nur den Proxy durch.'),
    @('Direct', 'Direkt im Netzwerk, ohne Proxy', 'Nur zum Ausprobieren: ohne HTTPS werden Passwörter unverschlüsselt übertragen.')
  ) $opts.Access
  $pAccess.Controls.Add($ui.Access)
  $ui.ProxyAddress = New-TextBox $opts.ProxyAddress (S 220)
  Add-Field $pAccess 'IP-Adresse des Proxys' $ui.ProxyAddress 'Nur bei »Reverse-Proxy auf einem anderen Rechner«, z. B. 10.0.0.5.'
  $ui.BaseUrl = New-TextBox $opts.BaseUrl
  Add-Field $pAccess 'Adresse für die Nutzenden' $ui.BaseUrl 'Steht in allen Links und E-Mails, z. B. https://knowstead.firma.de.'
  $ui.Port = New-Object System.Windows.Forms.NumericUpDown
  $ui.Port.Minimum = 1; $ui.Port.Maximum = 65535; $ui.Port.Value = $opts.Port; $ui.Port.Width = S 100; $ui.Port.Font = New-Font
  Add-Field $pAccess 'Port' $ui.Port 'Interner Port von Knowstead (Standard 3000).'
  foreach ($radio in $ui.Access.Controls) {
    if ($radio -is [System.Windows.Forms.RadioButton]) {
      $radio.Add_CheckedChanged({
          if (-not $this.Checked) { return }
          $ui.ProxyAddress.Enabled = ($this.Tag -eq 'RemoteProxy')
          $suggested = @((Get-DefaultBaseUrl 'LocalProxy' ([int]$ui.Port.Value)), (Get-DefaultBaseUrl 'Direct' ([int]$ui.Port.Value)))
          if (-not $ui.BaseUrl.Text -or $suggested -contains $ui.BaseUrl.Text) { $ui.BaseUrl.Text = Get-DefaultBaseUrl ([string]$this.Tag) ([int]$ui.Port.Value) }
        })
    }
  }
  $ui.ProxyAddress.Enabled = ($opts.Access -eq 'RemoteProxy')

  # --- Seite 4: Betrieb ---
  $pService = New-Page 'Betrieb' 'Knowstead soll mit dem Server starten und nach einem Fehler von selbst wieder anlaufen.'
  $ui.Service = New-RadioGroup @(
    @('Task', 'Autostart als geplante Aufgabe (empfohlen)', 'Ohne Zusatzsoftware: startet beim Systemstart unter dem Konto »Lokaler Dienst« und nach Fehlern neu. Protokoll unter <Datenverzeichnis>\logs.'),
    @('Nssm', 'Windows-Dienst mit NSSM', 'Klassischer Dienst in der Diensteverwaltung. Benötigt nssm.exe (https://nssm.cc/download).'),
    @('None', 'Kein Autostart', 'Start von Hand mit start.cmd – für Tests.')
  ) $opts.Service
  $pService.Controls.Add($ui.Service)
  $ui.Nssm = New-PathRow $opts.NssmPath 'file'
  Add-Field $pService 'Pfad zu nssm.exe' $ui.Nssm $null
  $ui.Nssm.Enabled = ($opts.Service -eq 'Nssm')
  foreach ($radio in $ui.Service.Controls) {
    if ($radio -is [System.Windows.Forms.RadioButton]) { $radio.Add_CheckedChanged({ if ($this.Checked) { $ui.Nssm.Enabled = ($this.Tag -eq 'Nssm') } }) }
  }
  $ui.Firewall = New-CheckBox 'Firewall-Regel für Knowstead anlegen (nicht nötig beim Proxy auf diesem Server)' $opts.Firewall
  $ui.Defender = New-CheckBox 'Datenbankdateien vom Echtzeit-Scan in Microsoft Defender ausnehmen' $opts.DefenderExclusion
  $pService.Controls.Add($ui.Firewall)
  $pService.Controls.Add($ui.Defender)
  $pService.Controls.Add((New-Label 'Anhänge werden weiterhin gescannt – ausgenommen sind nur knowstead.db, knowstead.db-wal und knowstead.db-shm.' 8.75 -Muted))

  # --- Seite 5: Zusatzfunktionen ---
  $pExtras = New-Page 'Zusatzfunktionen' 'Optional: Programme, die Knowstead mitbenutzt. Fehlen sie, installiert der Assistent sie auf Wunsch mit winget. Beides lässt sich auch später unter Administration → KI & Dateien einschalten.'
  $winget = Test-Winget
  $tesseract = $opts.TesseractPath; if (-not $tesseract) { $tesseract = Find-Tesseract }
  $office = $opts.LibreOfficePath; if (-not $office) { $office = Find-LibreOffice }
  $ui.UseOcr = New-CheckBox 'Texterkennung für eingescannte PDFs und Bilder (Tesseract)' ([bool]$tesseract)
  $pExtras.Controls.Add($ui.UseOcr)
  $ui.Ocr = New-PathRow $tesseract 'file'
  Add-Field $pExtras 'tesseract.exe' $ui.Ocr $(if ($tesseract) { 'Gefunden.' } elseif ($winget) { 'Nicht gefunden – unten ankreuzen, dann installiert der Assistent Tesseract samt deutschen und englischen Sprachdaten.' } else { 'Nicht gefunden – bei Bedarf installieren (https://github.com/UB-Mannheim/tesseract/wiki), deutsche Sprachdaten auswählen.' })
  $ui.InstallOcr = New-CheckBox 'Tesseract jetzt installieren (winget, rund 80 MB)' $false
  $ui.InstallOcr.Enabled = (-not $tesseract) -and $winget
  $ui.InstallOcr.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 14))
  $ui.InstallOcr.Add_CheckedChanged({ if ($this.Checked) { $ui.UseOcr.Checked = $true } })
  if (-not $tesseract) { $pExtras.Controls.Add($ui.InstallOcr) }
  $ui.UseOffice = New-CheckBox 'Vorschau von Word-, Excel-, PowerPoint- und Visio-Dateien (LibreOffice)' ([bool]$office)
  $pExtras.Controls.Add($ui.UseOffice)
  $ui.Office = New-PathRow $office 'file'
  Add-Field $pExtras 'soffice.exe' $ui.Office $(if ($office) { 'Gefunden.' } elseif ($winget) { 'Nicht gefunden – unten ankreuzen, dann installiert der Assistent LibreOffice.' } else { 'Nicht gefunden – bei Bedarf LibreOffice installieren (https://www.libreoffice.org/).' })
  $ui.InstallOffice = New-CheckBox 'LibreOffice jetzt installieren (winget, rund 350 MB Download)' $false
  $ui.InstallOffice.Enabled = (-not $office) -and $winget
  $ui.InstallOffice.Add_CheckedChanged({ if ($this.Checked) { $ui.UseOffice.Checked = $true } })
  if (-not $office) { $pExtras.Controls.Add($ui.InstallOffice) }

  # --- Seite 6: Zusammenfassung ---
  $pSummary = New-Page 'Zusammenfassung' 'Bitte prüfen – mit »Installieren« werden diese Schritte ausgeführt.'
  $ui.Summary = New-Object System.Windows.Forms.TextBox
  $ui.Summary.Multiline = $true
  $ui.Summary.ReadOnly = $true
  $ui.Summary.ScrollBars = 'Vertical'
  $ui.Summary.Font = New-Object System.Drawing.Font('Consolas', 9)
  $ui.Summary.Size = New-Object System.Drawing.Size($ContentWidth, (S 360))
  $ui.Summary.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
  $pSummary.Controls.Add($ui.Summary)

  # --- Seite 7: Installation ---
  $pRun = New-Page 'Installation' ''
  $ui.Status = New-Label 'Bereit' 10 -Bold
  $pRun.Controls.Add($ui.Status)
  $ui.Progress = New-Object System.Windows.Forms.ProgressBar
  $ui.Progress.Size = New-Object System.Drawing.Size($ContentWidth, (S 18))
  $ui.Progress.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 12))
  $pRun.Controls.Add($ui.Progress)
  $ui.LogBox = New-Object System.Windows.Forms.TextBox
  $ui.LogBox.Multiline = $true
  $ui.LogBox.ReadOnly = $true
  $ui.LogBox.ScrollBars = 'Both'
  $ui.LogBox.WordWrap = $false
  $ui.LogBox.Font = New-Object System.Drawing.Font('Consolas', 8.5)
  $ui.LogBox.Size = New-Object System.Drawing.Size($ContentWidth, (S 360))
  $ui.LogBox.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
  $ui.LogBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
  $pRun.Controls.Add($ui.LogBox)

  # --- Seite 8: Fertig ---
  $pDone = New-Page 'Fertig' ''
  $ui.DoneText = New-Label '' -Bottom 12
  $pDone.Controls.Add($ui.DoneText)
  $ui.OpenSetup = New-Object System.Windows.Forms.Button
  $ui.OpenSetup.Text = 'Ersteinrichtung im Browser öffnen'
  $ui.OpenSetup.AutoSize = $true
  $ui.OpenSetup.BackColor = $AccentColor
  $ui.OpenSetup.ForeColor = [System.Drawing.Color]::White
  $ui.OpenSetup.FlatStyle = 'Flat'
  $ui.OpenSetup.Padding = New-Object System.Windows.Forms.Padding((S 10), (S 4), (S 10), (S 4))
  $ui.OpenSetup.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 14))
  $pDone.Controls.Add($ui.OpenSetup)
  $ui.Checks = New-Label '' 9 -Bottom 12
  $pDone.Controls.Add($ui.Checks)
  $pDone.Controls.Add((New-Label 'Nächste Schritte' 10.5 -Bold -Bottom 6))
  $pDone.Controls.Add((New-Label "• HTTPS: Reverse-Proxy mit Zertifikat einrichten (Installationsanleitung, Abschnitt 7).`r`n• Nach der Ersteinrichtung führt Administration → Nächste Schritte durch E-Mail, Sicherung, Personen und Bereiche.`r`n• Steuern: Knowstead-Dienst.cmd start | stop | restart | status | log`r`n• Update: neue Programmdateien einspielen und diesen Assistenten erneut ausführen." 9 -Bottom 10))

  $pages = @(
    @{ Name = 'Willkommen'; Panel = $pWelcome },
    @{ Name = 'Datenverzeichnis'; Panel = $pData },
    @{ Name = 'Erreichbarkeit'; Panel = $pAccess },
    @{ Name = 'Betrieb'; Panel = $pService },
    @{ Name = 'Zusatzfunktionen'; Panel = $pExtras },
    @{ Name = 'Zusammenfassung'; Panel = $pSummary },
    @{ Name = 'Installation'; Panel = $pRun },
    @{ Name = 'Fertig'; Panel = $pDone }
  )
  $navLabels = @()
  for ($i = 0; $i -lt $pages.Count; $i++) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "  $($i + 1)   $($pages[$i].Name)"
    $label.AutoSize = $false
    $label.Size = New-Object System.Drawing.Size((S 216), (S 34))
    $label.Location = New-Object System.Drawing.Point(0, (S (18 + $i * 36)))
    $label.TextAlign = 'MiddleLeft'
    $label.Font = New-Font 9.75
    $label.Padding = New-Object System.Windows.Forms.Padding((S 12), 0, 0, 0)
    $nav.Controls.Add($label)
    $navLabels += $label
  }

  $state = @{ Index = 0; Running = $false; Finished = $false; Result = $null }

  $collect = {
    $opts.DataDir = $ui.DataDir.Tag.Text.Trim()
    $opts.Port = [int]$ui.Port.Value
    $opts.Access = Get-RadioValue $ui.Access
    $opts.ProxyAddress = $ui.ProxyAddress.Text.Trim()
    $opts.BaseUrl = $ui.BaseUrl.Text.Trim().TrimEnd('/')
    $opts.Service = Get-RadioValue $ui.Service
    $opts.NssmPath = $ui.Nssm.Tag.Text.Trim()
    $opts.Firewall = $ui.Firewall.Checked
    $opts.DefenderExclusion = $ui.Defender.Checked
    $opts.UseTesseract = $ui.UseOcr.Checked
    $opts.TesseractPath = $ui.Ocr.Tag.Text.Trim()
    $opts.UseLibreOffice = $ui.UseOffice.Checked
    $opts.LibreOfficePath = $ui.Office.Tag.Text.Trim()
    # Installieren nur, solange kein Pfad eingetragen ist – ein von Hand gewähltes Programm hat Vorrang
    $opts.InstallTesseract = $ui.UseOcr.Checked -and $ui.InstallOcr.Checked -and -not $opts.TesseractPath
    $opts.InstallLibreOffice = $ui.UseOffice.Checked -and $ui.InstallOffice.Checked -and -not $opts.LibreOfficePath
  }

  $showPage = {
    param([int]$Index)
    $state.Index = $Index
    $content.Controls.Clear()
    $content.Controls.Add($pages[$Index].Panel)
    for ($i = 0; $i -lt $navLabels.Count; $i++) {
      if ($i -eq $Index) {
        $navLabels[$i].BackColor = [System.Drawing.Color]::FromArgb(219, 234, 254)
        $navLabels[$i].ForeColor = $AccentColor
        $navLabels[$i].Font = New-Font 9.75 ([System.Drawing.FontStyle]::Bold)
      } else {
        $navLabels[$i].BackColor = [System.Drawing.Color]::Transparent
        $navLabels[$i].ForeColor = $(if ($i -lt $Index) { [System.Drawing.Color]::FromArgb(71, 85, 105) } else { [System.Drawing.Color]::FromArgb(148, 163, 184) })
        $navLabels[$i].Font = New-Font 9.75
      }
    }
    $back.Enabled = ($Index -gt 0 -and $Index -lt 6)
    $next.Text = 'Weiter >'
    if ($Index -eq 5) { $next.Text = 'Installieren' }
    if ($Index -eq 6) { $next.Enabled = $false; $cancel.Enabled = $false }
    if ($Index -eq 7) { $next.Text = 'Schließen'; $next.Enabled = $true; $cancel.Visible = $false; $back.Visible = $false }
    if ($Index -eq 5) {
      & $collect
      $ui.Summary.Text = (Get-InstallPlan $opts) -join "`r`n"
    }
  }

  $validate = {
    param([int]$Index)
    & $collect
    $problems = @()
    switch ($Index) {
      0 {
        $info = Get-NodeInfo
        if (-not $info -or $info.Major -lt 24) { $problems += 'Bitte zuerst Node.js 24 oder neuer installieren.' }
      }
      1 { $problems += @(Test-InstallOptions $opts | Where-Object { $_ -match 'Datenverzeichnis' }) }
      2 { $problems += @(Test-InstallOptions $opts | Where-Object { $_ -match 'Port|Adresse|Proxy' }) }
      3 { $problems += @(Test-InstallOptions $opts | Where-Object { $_ -match 'nssm' }) }
      4 { $problems += @(Test-InstallOptions $opts | Where-Object { $_ -match 'Tesseract|LibreOffice' }) }
    }
    if ($problems.Count) {
      [System.Windows.Forms.MessageBox]::Show(($problems -join "`r`n"), 'Bitte prüfen', 'OK', 'Warning') | Out-Null
      return $false
    }
    return $true
  }

  $runInstall = {
    $state.Running = $true
    $script:Gui = @{ LogBox = $ui.LogBox; Progress = $ui.Progress; Status = $ui.Status }
    try {
      $state.Result = Invoke-KnowsteadInstall $opts
      $state.Finished = $true
      $result = $state.Result
      if ($result.NeedsSetup) {
        $ui.DoneText.Text = "Knowstead ist installiert$(if ($result.Started) { ' und läuft' }). Jetzt im Browser das erste Administratorkonto anlegen – auf diesem Server ohne Einrichtungscode."
      } else {
        $ui.DoneText.Text = "Knowstead ist aktualisiert$(if ($result.Started) { ' und läuft wieder' })."
        $ui.OpenSetup.Text = 'Knowstead im Browser öffnen'
      }
      $ui.OpenSetup.Tag = $(if ($result.NeedsSetup) { $result.SetupUrl } else { $result.LocalUrl })
      $ui.OpenSetup.Visible = $result.Started
      $notes = @($result.Warnings | ForEach-Object { "!  $_" })
      $notes += @($result.Checks | Where-Object { $_.status -ne 'ok' -and $_.id -ne 'setup' } | ForEach-Object { "!  $($_.title): $($_.message)" + $(if (Get-JsonValue $_ 'hint') { "`r`n    → $($_.hint)" } else { '' }) })
      $ui.Checks.Text = $(if ($notes.Count) { "Hinweise:`r`n" + ($notes -join "`r`n") } else { '✔  Die Prüfung der Installation hat keine Probleme gefunden.' })
      & $showPage 7
    } catch {
      Write-Log ''
      Write-Log "FEHLER: $($_.Exception.Message)"
      $ui.Status.Text = 'Fehlgeschlagen'
      $ui.Status.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
      [System.Windows.Forms.MessageBox]::Show("Die Installation ist fehlgeschlagen:`r`n$($_.Exception.Message)`r`n`r`nDas Protokoll im Fenster zeigt die Einzelheiten.", 'Knowstead', 'OK', 'Error') | Out-Null
      $back.Enabled = $true
      $back.Visible = $true
      $cancel.Enabled = $true
      $cancel.Text = 'Schließen'
    } finally {
      $state.Running = $false
    }
  }

  $next.Add_Click({
      if ($state.Index -eq 7) { $form.Close(); return }
      if (-not (& $validate $state.Index)) { return }
      if ($state.Index -eq 5) {
        & $showPage 6
        $timer = New-Object System.Windows.Forms.Timer
        $timer.Interval = 200
        $timer.Add_Tick({ $this.Stop(); & $runInstall })
        $timer.Start()
        return
      }
      & $showPage ($state.Index + 1)
    })
  $back.Add_Click({
      if ($state.Index -eq 6) { $ui.LogBox.Clear(); $ui.Progress.Value = 0; $cancel.Text = 'Abbrechen'; & $showPage 5; return }
      if ($state.Index -gt 0) { & $showPage ($state.Index - 1) }
    })
  $cancel.Add_Click({ $form.Close() })
  $ui.OpenSetup.Add_Click({ Start-Process $this.Tag })
  if ($ui.ContainsKey('Remove')) {
    $ui.Remove.Add_Click({
        $answer = [System.Windows.Forms.MessageBox]::Show('Autostart, Firewall-Regel und Virenscanner-Ausnahmen entfernen? Programm und Daten bleiben erhalten.', 'Autostart entfernen', 'YesNo', 'Question')
        if ($answer -ne 'Yes') { return }
        $script:Gui = @{ LogBox = $ui.LogBox; Progress = $ui.Progress; Status = $ui.Status }
        try {
          Invoke-KnowsteadUninstall
          [System.Windows.Forms.MessageBox]::Show(($script:LogLines -join "`r`n"), 'Autostart entfernt', 'OK', 'Information') | Out-Null
          $form.Close()
        } catch {
          [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Knowstead', 'OK', 'Error') | Out-Null
        }
      })
  }
  $form.Add_FormClosing({
      param($sender, $e)
      if ($state.Running) {
        [System.Windows.Forms.MessageBox]::Show('Die Installation läuft noch – bitte warten, bis sie abgeschlossen ist.', 'Knowstead', 'OK', 'Information') | Out-Null
        $e.Cancel = $true
      }
    })

  & $showPage 0

  if ($SelfTest) {
    New-Item -ItemType Directory -Force -Path $SelfTest | Out-Null
    $form.StartPosition = 'Manual'
    $form.Location = New-Object System.Drawing.Point(-3000, -3000)
    $form.ShowInTaskbar = $false
    $form.Show()
    $ui.LogBox.Text = "Knowstead – Installation`r`n  ▸ Node.js prüfen`r`n    Node.js v24.13.0`r`n  ▸ Abhängigkeiten und Oberfläche`r`n  [1/3] Abhängigkeiten aktuell."
    $ui.Progress.Value = 45
    $ui.Status.Text = 'Abhängigkeiten und Oberfläche'
    $ui.DoneText.Text = 'Knowstead ist installiert und läuft. Jetzt im Browser das erste Administratorkonto anlegen – auf diesem Server ohne Einrichtungscode.'
    $ui.Checks.Text = "Hinweise:`r`n!  Texterkennung: Sprachdaten fehlen für deu – erkannt wird vorerst nur eng.`r`n!  Adresse (BASE_URL): http://srv:3000 ohne HTTPS`r`n    → Einen Reverse-Proxy mit Zertifikat vorschalten (Installationsanleitung, Abschnitt 7)."
    for ($i = 0; $i -lt $pages.Count; $i++) {
      & $showPage $i
      [System.Windows.Forms.Application]::DoEvents()
      $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
      $form.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
      $file = Join-Path $SelfTest ('seite-{0}-{1}.png' -f ($i + 1), $pages[$i].Name.ToLower())
      $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
      $bitmap.Dispose()
      Write-Host "Gespeichert: $file"
    }
    $form.Close()
    return
  }

  [void]$form.ShowDialog()
}

# ------------------------------------------------------------------------------------------------
#  Einstieg
# ------------------------------------------------------------------------------------------------

$interactive = -not $Unattended -and -not $Uninstall
if (-not $SelfTest -and -not $WhatIfPreference -and -not $NoElevate -and -not (Test-Admin)) {
  # Aufgabenplanung, Firewall und Rechte brauchen Administratorrechte – neu mit Rückfrage (UAC) starten
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-ProcessArgument $PSCommandPath))
  foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    if ($entry.Value -is [switch]) { if ($entry.Value) { $forward += "-$($entry.Key)" } }
    else { $forward += "-$($entry.Key)"; $forward += (ConvertTo-ProcessArgument ([string]$entry.Value)) }
  }
  if ($Unattended -or $Uninstall) { $forward = @('-NoExit') + $forward }
  try {
    $proc = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $forward -Verb RunAs -PassThru -Wait
    exit $proc.ExitCode
  } catch {
    Write-Host 'Administratorrechte wurden nicht erteilt – Abbruch.' -ForegroundColor Red
    exit 1
  }
}

try {
  if ($SelfTest) { Show-Wizard; exit 0 }
  if ($Uninstall) { Invoke-KnowsteadUninstall; exit 0 }
  if ($interactive) { Show-Wizard; exit 0 }

  $opts = New-InstallOptions
  $problems = @(Test-InstallOptions $opts)
  if ($problems.Count) {
    foreach ($p in $problems) { Write-Host "[!] $p" -ForegroundColor Red }
    exit 2
  }
  $result = Invoke-KnowsteadInstall $opts
  Write-Host ''
  if ($result.Warnings.Count) {
    Write-Host 'Hinweise – Knowstead ist eingerichtet, bei den Zusatzprogrammen blieb etwas offen:' -ForegroundColor Yellow
    foreach ($w in $result.Warnings) { Write-Host "  [!] $w" -ForegroundColor Yellow }
    Write-Host '  → Nachholen: Administration → KI & Dateien, oder den Assistenten erneut ausführen.' -ForegroundColor Yellow
    Write-Host ''
  }
  if ($result.NeedsSetup) { Write-Host "Ersteinrichtung auf diesem Server: $($result.SetupUrl)" -ForegroundColor Green }
  else { Write-Host "Knowstead: $($opts.BaseUrl)" -ForegroundColor Green }
  if ($result.Started -and -not $NoBrowser -and -not $WhatIfPreference -and $result.NeedsSetup) { Start-Process $result.SetupUrl }
  exit 0
} catch {
  Write-Host ''
  Write-Host "[!] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
