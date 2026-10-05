import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OCR_LANGUAGES, parseTesseractLanguages, pickOcrLanguages, planOcrLanguages } from '../../scripts/install.mjs';

/**
 * Installationsroutine: Abfrage und Installation von Tesseract (Texterkennung) und LibreOffice (Office-Vorschau)
 * über die Paketverwaltung – und die Absicherung des Ablaufs: Ein Zusatzprogramm, das sich nicht einrichten lässt,
 * hält die Installation nicht auf, und nach einem Fehlschlag läuft ein vorher laufendes Knowstead wieder.
 * Geprüft wird mit nachgestellten Programmen (apt-get, apt-cache, tesseract, systemctl, id) in einem eigenen
 * Ordner am Anfang des Suchpfads – ohne Root-Rechte, ohne etwas zu installieren oder am System zu ändern.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const extras = path.join(root, 'scripts', 'install', 'linux', 'extras.sh').replaceAll('\\', '/');

/** Unter Windows die Bash von Git – `bash` aus dem Suchpfad wäre dort oft der Starter von WSL. */
function findBash(): string | null {
  if (process.platform !== 'win32') return 'bash';
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
  for (const base of bases) {
    if (!base) continue;
    const candidate = path.join(base, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
const bash = findBash();

test('Installationskern: Sprachen der Texterkennung', () => {
  for (const ok of ['deu', 'deu+eng', 'deu+eng+fra', 'chi_sim+eng']) assert.ok(OCR_LANGUAGES.test(ok), ok);
  for (const bad of ['', 'de', 'deu eng', 'deu,eng', 'deu+', 'deu;rm -rf /', 'a+b+c+d+e+f+g', '$(id)']) assert.ok(!OCR_LANGUAGES.test(bad), bad);

  const v5 = 'List of available languages in "/usr/share/tesseract-ocr/5/tessdata/" (3):\ndeu\neng\nosd\n';
  assert.deepEqual(parseTesseractLanguages(v5), ['deu', 'eng']);
  assert.deepEqual(parseTesseractLanguages('List of available languages (2):\r\neng\r\nosd\r\n'), ['eng'], 'Windows-Zeilenenden');
  assert.deepEqual(parseTesseractLanguages('Error opening data file\n'), []);
  assert.deepEqual(parseTesseractLanguages(undefined), []);

  assert.deepEqual(pickOcrLanguages('deu+eng', ['deu', 'eng', 'fra']), { languages: 'deu+eng', missing: [] });
  assert.deepEqual(pickOcrLanguages('deu+eng', ['eng']), { languages: 'eng', missing: ['deu'] });
  assert.deepEqual(pickOcrLanguages('deu+eng', []), { languages: '', missing: ['deu', 'eng'] });

  // Was wird eingetragen – und was davon ist ein Hinweis für das Ende der Installation?
  assert.deepEqual(planOcrLanguages('deu+eng', ['deu', 'eng', 'fra']), { languages: 'deu+eng', level: 'info', message: 'Sprachen: deu+eng' });
  const partly = planOcrLanguages('deu+eng+fra', ['eng', 'fra']);
  assert.equal(partly.languages, 'eng+fra', 'nur vorhandene Sprachen – Tesseract bricht sonst bei jeder Datei ab');
  assert.equal(partly.level, 'warn');
  assert.match(partly.message, /Sprachdaten fehlen für deu – erkannt wird vorerst nur eng, fra\./);
  const none = planOcrLanguages('deu+eng', ['fra']);
  assert.equal(none.languages, null, 'nichts einzutragen');
  assert.equal(none.level, 'warn');
  assert.match(none.message, /keine Sprachdaten für deu, eng \(vorhanden: fra\) – die Einstellung bleibt unverändert/);
  assert.match(planOcrLanguages('deu+eng', []).message, /\(vorhanden: keine\)/);
  const unknown = planOcrLanguages('deu+eng', null);
  assert.equal(unknown.languages, 'deu+eng', 'Liste nicht ermittelbar: eintragen wie gewünscht');
  assert.equal(unknown.level, 'info');
});

test('Installationskern: ungültige Sprachen werden abgewiesen, bevor etwas geschrieben wird', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-extras-'));
  try {
    const envPath = path.join(dir, '.env');
    const res = spawnSync(process.execPath, ['scripts/install.mjs', '--env-path', envPath, '--data-dir', path.join(dir, 'daten'), '--skip-prepare', '--skip-test', '--ocr-languages', 'deu;eng'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Ungültige Sprachen der Texterkennung/);
    assert.ok(!fs.existsSync(envPath), 'keine .env angelegt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows-Assistent: Probelauf mit -InstallTesseract und -InstallLibreOffice', { skip: process.platform === 'win32' ? false : 'nur unter Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-assistent-'));
  const wizard = (extra: string[]) =>
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts', 'install', 'windows', 'Install-Knowstead.ps1'),
        '-Unattended',
        '-WhatIf',
        '-NoElevate',
        '-SkipPrepare',
        '-EnvPath',
        path.join(dir, '.env'),
        '-DataDir',
        path.join(dir, 'daten'),
        '-Port',
        '3986',
        '-Service',
        'None',
        ...extra,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
  try {
    const res = wizard(['-InstallTesseract', '-InstallLibreOffice', '-OcrLanguages', 'deu+eng']);
    const out = res.stdout + res.stderr;
    // Ohne winget (ältere Server) lehnt der Assistent die Installation mit einem klaren Hinweis ab
    if (res.status === 2 && /winget/.test(out)) return;
    assert.equal(res.status, 0, out);
    // Ist ein Programm auf diesem Rechner schon vorhanden, wird es nur eingeschaltet – sonst steht die Installation im Plan
    assert.match(out, /Tesseract mit winget installieren \(UB-Mannheim\.TesseractOCR\), Sprachdaten deu\+eng|Texterkennung mit Tesseract einschalten/);
    assert.match(out, /LibreOffice mit winget installieren \(TheDocumentFoundation\.LibreOffice\)|Office-Vorschau mit LibreOffice einschalten/);
    if (/Tesseract mit winget installieren/.test(out)) {
      assert.match(out, /\(Probelauf\) winget install --id UB-Mannheim\.TesseractOCR -e --silent --accept-package-agreements --accept-source-agreements/);
    }
    if (/LibreOffice mit winget installieren/.test(out)) {
      assert.match(out, /\(Probelauf\) winget install --id TheDocumentFoundation\.LibreOffice -e --silent/);
    }
    assert.ok(!fs.existsSync(path.join(dir, '.env')), 'der Probelauf schreibt keine .env');
    assert.ok(!fs.existsSync(path.join(dir, 'daten')), 'der Probelauf legt kein Datenverzeichnis an');

    // Ohne die neuen Schalter bleibt alles beim Alten: nichts wird installiert
    const plain = wizard([]);
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    assert.ok(!/winget install/.test(plain.stdout), plain.stdout);

    const bad = wizard(['-InstallTesseract', '-OcrLanguages', 'deu;eng']);
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /Sprachen der Texterkennung/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Prüfstand für den Windows-Assistenten: Er holt die beteiligten Funktionen unverändert aus Install-Knowstead.ps1 und
 * stellt nur die Systembefehle nach (Dienst, geplante Aufgabe, Aufruf von Node). So lässt sich der Ablauf
 * „anhalten → Fehlschlag → wieder starten“ ohne Administratorrechte und ohne echten Dienst prüfen.
 * Nur ASCII: Windows PowerShell 5.1 läse eine Datei ohne BOM sonst in der ANSI-Codepage.
 */
const WIZARD_HARNESS = String.raw`param([string]$Wizard, [string]$Scenario)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$TaskPath = '\Knowstead\'
$TaskName = 'Knowstead'
$ServiceName = 'Knowstead'
$script:Gui = $null
$script:LogLines = New-Object System.Collections.Generic.List[string]
$script:DoneEvent = $null
$script:WasRunning = ''
$script:Notes = New-Object System.Collections.Generic.List[string]
$script:Calls = New-Object System.Collections.Generic.List[string]

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Wizard, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Parserfehler: $($errors[0].Message)" }
$wanted = @('Write-Log', 'Invoke-Checked', 'Add-Note', 'Stop-Knowstead', 'Restore-Knowstead', 'Invoke-KnowsteadInstall')
$found = @()
foreach ($fn in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  if ($wanted -contains $fn.Name) { . ([scriptblock]::Create($fn.Extent.Text)); $found += $fn.Name }
}
foreach ($name in $wanted) { if ($found -notcontains $name) { throw "Funktion fehlt im Assistenten: $name" } }

function Get-Service { param($Name, $ErrorAction) if ($Scenario -like 'service*') { return [pscustomobject]@{ Status = 'Running' } } }
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  if ($Scenario -like 'task*') { return [pscustomobject]@{ State = 'Running' } }
  if ($Scenario -like 'stopped*') { return [pscustomobject]@{ State = 'Ready' } }
}
function Start-Service { param($Name) $script:Calls.Add("Start-Service $Name"); if ($Scenario -like '*startfails') { throw 'Start nicht moeglich' } }
function Start-ScheduledTask { param($TaskPath, $TaskName) $script:Calls.Add("Start-ScheduledTask $TaskPath$TaskName") }
function Stop-Service { param($Name, [switch]$Force) $script:Calls.Add("Stop-Service $Name") }
function Stop-ScheduledTask { param($TaskPath, $TaskName, $ErrorAction) $script:Calls.Add("Stop-ScheduledTask $TaskPath$TaskName") }
function Invoke-NodeScript { param($NodePath, $Arguments) $script:Calls.Add("node $($Arguments[-3]) $($Arguments[-2]) $($Arguments[-1])"); return 0 }
function Invoke-KnowsteadInstallSteps($opts) {
  Stop-Knowstead 'node.exe' $opts
  if ($Scenario -like '*ok') { $script:WasRunning = ''; return [pscustomobject]@{ Started = $true } }
  throw 'Die Einrichtung ist fehlgeschlagen'
}

$existing = [pscustomobject]@{ Task = $null; ServiceObj = $null }
if ($Scenario -like 'service*') { $existing.ServiceObj = [pscustomobject]@{ Status = 'Running' } }
if ($Scenario -like 'task*') { $existing.Task = [pscustomobject]@{ State = 'Running' } }
if ($Scenario -like 'stopped*') { $existing.Task = [pscustomobject]@{ State = 'Ready' } }
$opts = @{ Existing = $existing }

$outcome = 'ok'
try { $null = Invoke-KnowsteadInstall $opts } catch { $outcome = "error: $($_.Exception.Message)" }
Write-Output "OUTCOME $outcome"
foreach ($call in $script:Calls) { Write-Output "CALL $call" }
Write-Output "WASRUNNING [$($script:WasRunning)]"
`;

test('Windows-Assistent: Nach einem Fehlschlag läuft ein vorher laufendes Knowstead wieder', { skip: process.platform === 'win32' ? false : 'nur unter Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-assistent-'));
  const harness = path.join(dir, 'pruefstand.ps1');
  fs.writeFileSync(harness, WIZARD_HARNESS);
  const run = (scenario: string) => {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Wizard', path.join(root, 'scripts', 'install', 'windows', 'Install-Knowstead.ps1'), '-Scenario', scenario],
      { encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const lines = res.stdout.split(/\r?\n/);
    return {
      outcome: lines.find((l) => l.startsWith('OUTCOME '))?.slice(8),
      calls: lines.filter((l) => l.startsWith('CALL ')).map((l) => l.slice(5)),
      state: lines.find((l) => l.startsWith('WASRUNNING ')),
      out: res.stdout,
    };
  };
  const stopServer = 'node stop --timeout 60';
  try {
    // Geplante Aufgabe lief: anhalten, Fehlschlag, wieder starten – der ursprüngliche Fehler bleibt die Meldung
    const task = run('task-fail');
    assert.equal(task.outcome, 'error: Die Einrichtung ist fehlgeschlagen');
    assert.deepEqual(task.calls, [stopServer, 'Stop-ScheduledTask \\Knowstead\\Knowstead', 'Start-ScheduledTask \\Knowstead\\Knowstead']);
    assert.match(task.out, /wird wieder gestartet/);
    assert.equal(task.state, 'WASRUNNING []', 'kein zweiter Wiederanlauf');

    // Windows-Dienst (NSSM) lief
    const service = run('service-fail');
    assert.deepEqual(service.calls, ['Stop-Service Knowstead', stopServer, 'Start-Service Knowstead']);

    // Eingerichtet, aber nicht gestartet: nach dem Fehlschlag wird nichts gestartet
    const stopped = run('stopped-fail');
    assert.equal(stopped.outcome, 'error: Die Einrichtung ist fehlgeschlagen');
    assert.deepEqual(stopped.calls, [stopServer, 'Stop-ScheduledTask \\Knowstead\\Knowstead']);
    assert.ok(!/wird wieder gestartet/.test(stopped.out), stopped.out);

    // Erfolg: Der Assistent startet Knowstead selbst – kein Wiederanlauf
    const ok = run('task-ok');
    assert.equal(ok.outcome, 'ok');
    assert.deepEqual(ok.calls, [stopServer, 'Stop-ScheduledTask \\Knowstead\\Knowstead']);

    // Auch der Wiederanlauf scheitert: Hinweis im Protokoll, gemeldet wird der ursprüngliche Fehler
    const broken = run('service-fail-startfails');
    assert.equal(broken.outcome, 'error: Die Einrichtung ist fehlgeschlagen');
    assert.match(broken.out, /nicht wieder starten: Start nicht moeglich/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install.sh: Tesseract und LibreOffice über die Paketverwaltung', { skip: bash ? false : 'keine Bash gefunden (unter Windows: Git für Windows)' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-extras-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'aufrufe.log').replaceAll('\\', '/');
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  // apt-get: protokolliert den Aufruf; „install“ legt die Programme an, wie es die Pakete täten
  stub(
    'apt-get',
    `echo "apt-get $*" >> "${log}"
[ "\${APT_FAIL:-0}" = 1 ] && [ "$1" = install ] && exit 100
[ "\${APT_UPDATE_FAIL:-0}" = 1 ] && [ "$1" = update ] && exit 100
here="$(cd "$(dirname "$0")" && pwd)"
for arg in "$@"; do
  case "$arg" in
    tesseract-ocr) printf '%s\\n' '#!/usr/bin/env bash' 'echo "List of available languages (n):"; cat "$(dirname "$0")/sprachen.txt" 2>/dev/null; echo osd' > "$here/tesseract"; chmod +x "$here/tesseract" ;;
    tesseract-ocr-*) echo "\${arg#tesseract-ocr-}" | tr '-' '_' >> "$here/sprachen.txt" ;;
    libreoffice-writer*) printf '%s\\n' '#!/usr/bin/env bash' 'exit 0' > "$here/soffice"; chmod +x "$here/soffice" ;;
  esac
done
exit 0`,
  );
  stub('apt-cache', `case "$2" in\n  libreoffice-core-nogui | libreoffice-writer-nogui) [ "\${NOGUI:-1}" = 1 ] && exit 0 ;;\nesac\nexit 1`);

  const env = (extra: Record<string, string> = {}) => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...extra });
  /** Führt Bash-Zeilen mit eingebundenen Hilfsfunktionen aus – `run` und `say` wie in install.sh. */
  const sh = (script: string, opts: { dryRun?: boolean; env?: Record<string, string> } = {}) => {
    const prelude = `set -euo pipefail
DRY_RUN=${opts.dryRun ? 1 : 0}
say() { printf '%s\\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then printf '    (Probelauf) %s\\n' "$*"; else "$@"; fi; }
. '${extras}'
`;
    const res = spawnSync(bash!, ['-c', prelude + script], { encoding: 'utf8', env: env(opts.env) });
    return { status: res.status, out: res.stdout.replaceAll('\r', ''), err: res.stderr };
  };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  const reset = () => {
    for (const f of ['tesseract', 'soffice', 'libreoffice', 'sprachen.txt']) fs.rmSync(path.join(bin, f), { force: true });
    fs.rmSync(log, { force: true });
  };

  try {
    await t.test('Paketverwaltung und Sprachkürzel', () => {
      assert.equal(sh('extras_pkg_manager').out.trim(), 'apt');
      const check = sh(`for l in deu deu+eng chi_sim+eng 'de' 'deu eng' 'deu;id' ''; do if extras_valid_languages "$l"; then echo "ok:$l"; else echo "nein:$l"; fi; done`);
      assert.equal(check.status, 0, check.err);
      assert.deepEqual(check.out.trim().split('\n'), ['ok:deu', 'ok:deu+eng', 'ok:chi_sim+eng', 'nein:de', 'nein:deu eng', 'nein:deu;id', 'nein:']);
    });

    await t.test('Paketnamen je Distribution', () => {
      assert.deepEqual(sh('extras_ocr_packages apt deu+eng+chi_sim').out.trim().split('\n'), ['tesseract-ocr', 'tesseract-ocr-deu', 'tesseract-ocr-eng', 'tesseract-ocr-chi-sim']);
      assert.deepEqual(sh('extras_ocr_packages dnf deu+eng').out.trim().split('\n'), ['tesseract', 'tesseract-langpack-deu', 'tesseract-langpack-eng']);
      const nogui = sh('extras_office_packages apt').out.trim().split('\n');
      // Der Kern ohne Oberfläche steht ausdrücklich dabei – apt wählte sonst den mit Oberfläche
      assert.deepEqual(nogui.slice(0, 5), ['libreoffice-core-nogui', 'libreoffice-writer-nogui', 'libreoffice-calc-nogui', 'libreoffice-impress-nogui', 'libreoffice-draw-nogui']);
      assert.ok(nogui.includes('fonts-crosextra-carlito') && nogui.includes('fonts-liberation'), 'Schriften für die Vorschau gehören dazu');
      const gui = sh('extras_office_packages apt', { env: { NOGUI: '0' } }).out.trim().split('\n');
      assert.deepEqual(gui.slice(0, 4), ['libreoffice-writer', 'libreoffice-calc', 'libreoffice-impress', 'libreoffice-draw'], 'ältere Distribution ohne -nogui-Pakete');
      assert.deepEqual(sh('extras_office_packages dnf').out.trim().split('\n').slice(0, 4), ['libreoffice-writer', 'libreoffice-calc', 'libreoffice-impress', 'libreoffice-draw']);
    });

    await t.test('Texterkennung installieren: Pakete, Pfad und Sprachen', () => {
      reset();
      const res = sh('extras_install_ocr apt deu+eng && echo "PFAD=$EXTRAS_OCR_PATH" && echo "FEHLT=$(extras_missing_languages deu+eng+fra "$EXTRAS_OCR_PATH")"');
      assert.equal(res.status, 0, res.err + res.out);
      // --no-remove: Die Installation fügt nur hinzu, vorhandene Pakete bleiben
      assert.deepEqual(calls(), ['apt-get update', 'apt-get install -y --no-install-recommends --no-remove tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng']);
      assert.match(res.out, /PFAD=.*\/bin\/tesseract/);
      assert.match(res.out, /Tesseract: .*\(Sprachen: deu eng\)/);
      assert.match(res.out, /FEHLT=fra$/m, 'Französisch wurde nicht installiert');
    });

    await t.test('LibreOffice installieren: ohne Oberfläche, Paketlisten nur einmal laden', () => {
      reset();
      const res = sh('extras_install_ocr apt deu && extras_install_office apt && echo "PFAD=$EXTRAS_OFFICE_PATH"');
      assert.equal(res.status, 0, res.err + res.out);
      assert.equal(calls().filter((c) => c === 'apt-get update').length, 1, 'apt-get update nur einmal');
      assert.match(calls().at(-1)!, /^apt-get install -y --no-install-recommends --no-remove libreoffice-core-nogui libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui fonts-/);
      assert.match(res.out, /PFAD=.*\/bin\/soffice/);
    });

    await t.test('Fehlschlag der Paketverwaltung bricht die Installation von Knowstead nicht ab', () => {
      reset();
      const res = sh('if extras_install_ocr apt deu+eng; then echo JA; else echo "WEITER pfad=[$EXTRAS_OCR_PATH]"; fi; if extras_install_office apt; then echo JA; else echo "WEITER office=[$EXTRAS_OFFICE_PATH]"; fi', { env: { APT_FAIL: '1' } });
      assert.equal(res.status, 0, res.err);
      assert.match(res.out, /Tesseract ließ sich nicht installieren/);
      assert.match(res.out, /WEITER pfad=\[\]/);
      assert.match(res.out, /LibreOffice ließ sich nicht installieren/);
      assert.match(res.out, /WEITER office=\[\]/);
      assert.match(res.out, /--install-ocr/, 'Hinweis, wie es sich nachholen lässt');
    });

    await t.test('Paketlisten lassen sich nicht aktualisieren (eine Paketquelle fehlt): Installation wird trotzdem versucht', () => {
      reset();
      const res = sh('extras_install_ocr apt deu+eng && echo "PFAD=$EXTRAS_OCR_PATH"', { env: { APT_UPDATE_FAIL: '1' } });
      assert.equal(res.status, 0, res.err + res.out);
      assert.match(res.out, /Paketlisten ließen sich nicht vollständig aktualisieren/);
      assert.match(res.out, /PFAD=.*\/bin\/tesseract/);
      assert.equal(calls().filter((c) => c.startsWith('apt-get install')).length, 1);
    });

    await t.test('Sprachdaten lassen sich nicht nachinstallieren: Meldung nennt die Sprachen, nicht Tesseract', () => {
      reset();
      fs.writeFileSync(path.join(bin, 'tesseract'), '#!/usr/bin/env bash\necho "List of available languages (2):"; echo eng; echo osd\n');
      fs.chmodSync(path.join(bin, 'tesseract'), 0o755);
      const res = sh('if extras_install_ocr apt deu+eng; then echo JA; else echo NEIN; fi', { env: { APT_FAIL: '1' } });
      assert.equal(res.status, 0, res.err);
      assert.match(res.out, /Die Sprachdaten ließen sich nicht installieren – es bleibt bei den vorhandenen Sprachen/);
      assert.ok(!/Tesseract ließ sich nicht installieren/.test(res.out), res.out);
      assert.match(res.out, /^NEIN$/m);
    });

    await t.test('LibreOffice finden: nur »soffice« zählt', () => {
      reset();
      const real = sh('command -v soffice || true').out.trim();
      // Starter ohne Verweis auf soffice – so sieht es beim Snap-Paket aus (/snap/bin/libreoffice → snap)
      stub('libreoffice', 'exit 0');
      const starter = sh('echo "[$(extras_find_office)]"').out.trim();
      assert.ok(!starter.endsWith('/libreoffice]'), `der Server nähme diesen Pfad nicht an: ${starter}`);
      if (!real && process.platform !== 'win32') {
        // Debian, Fedora: /usr/bin/libreoffice ist ein Verweis auf …/program/soffice – das Ziel wird eingetragen
        const program = path.join(dir, 'lib', 'program');
        fs.mkdirSync(program, { recursive: true });
        fs.writeFileSync(path.join(program, 'soffice'), '#!/usr/bin/env bash\nexit 0\n');
        fs.chmodSync(path.join(program, 'soffice'), 0o755);
        fs.rmSync(path.join(bin, 'libreoffice'));
        fs.symlinkSync(path.join(program, 'soffice'), path.join(bin, 'libreoffice'));
        assert.match(sh('echo "[$(extras_find_office)]"').out.trim(), /\/lib\/program\/soffice\]$/);
        fs.rmSync(path.join(bin, 'libreoffice'));
      }
      stub('soffice', 'exit 0');
      assert.match(sh('echo "[$(extras_find_office)]"').out.trim(), /\/bin\/soffice\]$/);
    });

    await t.test('ohne Paketverwaltung: Hinweis statt Abbruch', () => {
      const res = sh('if extras_install_ocr "" deu; then echo JA; else echo NEIN; fi; if extras_install_office ""; then echo JA; else echo NEIN; fi');
      assert.equal(res.status, 0, res.err);
      assert.deepEqual(res.out.trim().split('\n').filter((l) => l === 'NEIN' || l === 'JA'), ['NEIN', 'NEIN']);
      assert.match(res.out, /Keine Paketverwaltung/);
    });

    await t.test('Probelauf: zeigt die Befehle, ruft nichts auf', () => {
      reset();
      const res = sh('extras_install_ocr apt deu+eng; echo "pfad=[$EXTRAS_OCR_PATH]"; extras_install_office apt; echo "office=[$EXTRAS_OFFICE_PATH]"', { dryRun: true });
      assert.equal(res.status, 0, res.err);
      assert.deepEqual(calls(), [], 'keine Paketverwaltung aufgerufen');
      assert.match(res.out, /\(Probelauf\) apt-get update/);
      assert.match(res.out, /\(Probelauf\) env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-remove tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng/);
      assert.match(res.out, /\(Probelauf\) env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-remove libreoffice-core-nogui libreoffice-writer-nogui/);
      assert.match(res.out, /pfad=\[\]/);
    });

    const installSh = (args: string[], input = '') => {
      const res = spawnSync(bash!, ['install.sh', '--dry-run', '--service', 'none', '--data-dir', '/var/lib/knowstead-test', ...args], { cwd: root, encoding: 'utf8', env: env(), input });
      return { status: res.status, out: res.stdout.replaceAll('\r', ''), err: res.stderr };
    };

    await t.test('install.sh ohne Rückfragen: --install-ocr und --install-office', () => {
      reset();
      const res = installSh(['--unattended', '--install-ocr', '--install-office', '--ocr-languages', 'deu+eng+fra']);
      assert.equal(res.status, 0, res.err + res.out);
      assert.match(res.out, /Texterkennung: +wird installiert \(Tesseract, Sprachen deu, eng, fra\)/);
      assert.match(res.out, /Office-Vorschau: +wird installiert \(LibreOffice ohne grafische Oberfläche\)/);
      assert.match(res.out, /\(Probelauf\) env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-remove tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng tesseract-ocr-fra/);
      assert.match(res.out, /\(Probelauf\) env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-remove libreoffice-core-nogui libreoffice-writer-nogui/);
      assert.match(res.out, /\(Probelauf\) Danach eingeschaltet: Texterkennung Office-Vorschau/);
      assert.deepEqual(calls(), [], 'der Probelauf installiert nichts');
      // Die Pakete kommen vor dem Installationskern – ein laufender Dienst bleibt so lange oben
      assert.ok(res.out.indexOf('Texterkennung installieren') < res.out.indexOf('Knowstead – Installation'), 'Zusatzprogramme zuerst');
    });

    await t.test('install.sh ohne die neuen Optionen installiert nichts', () => {
      reset();
      const res = installSh(['--unattended']);
      assert.equal(res.status, 0, res.err + res.out);
      assert.ok(!/apt-get/.test(res.out), res.out);
      assert.ok(!/wird installiert/.test(res.out));
    });

    await t.test('install.sh: ungültige Sprachkürzel', () => {
      const res = installSh(['--unattended', '--install-ocr', '--ocr-languages', 'deu;id']);
      assert.equal(res.status, 1);
      assert.match(res.err, /Tesseract-Kürzel/);
    });

    await t.test('install.sh mit Rückfragen: Texterkennung ja (Vorgabe), LibreOffice nur auf ausdrückliches Ja', () => {
      reset();
      // Antworten: Datenverzeichnis, Zugriff, Port, Adresse, Autostart – jeweils Vorgabe –, dann die beiden Fragen
      const defaults = installSh([], '\n\n\n\n\n\n\n');
      assert.equal(defaults.status, 0, defaults.err + defaults.out);
      assert.match(defaults.out, /Texterkennung: +wird installiert/, 'Vorgabe der Frage zur Texterkennung ist Ja');
      assert.ok(!/Office-Vorschau: +wird installiert/.test(defaults.out), 'Vorgabe der Frage zu LibreOffice ist Nein (rund 400 MB)');

      const both = installSh([], '\n\n\n\n\nj\nj\n');
      assert.equal(both.status, 0, both.err + both.out);
      assert.match(both.out, /Texterkennung: +wird installiert/);
      assert.match(both.out, /Office-Vorschau: +wird installiert/);

      const none = installSh([], '\n\n\n\n\nn\nn\n');
      assert.equal(none.status, 0, none.err + none.out);
      assert.ok(!/wird installiert/.test(none.out));
      assert.ok(!/apt-get/.test(none.out));
    });

    await t.test('install.sh: vorhandenes Tesseract wird eingeschaltet, fehlende Sprachdaten werden nachinstalliert', () => {
      reset();
      // Tesseract ist da, kennt aber nur Englisch
      fs.writeFileSync(path.join(bin, 'tesseract'), '#!/usr/bin/env bash\necho "List of available languages (2):"; echo eng; echo osd\n');
      fs.chmodSync(path.join(bin, 'tesseract'), 0o755);
      const res = installSh(['--unattended', '--install-ocr']);
      assert.equal(res.status, 0, res.err + res.out);
      assert.match(res.out, /Texterkennung: +wird installiert \(Tesseract, Sprachen deu, eng\)/, 'Deutsch fehlt – also nachinstallieren');

      // Alle Sprachen vorhanden: nichts installieren, nur einschalten
      fs.writeFileSync(path.join(bin, 'tesseract'), '#!/usr/bin/env bash\necho "List of available languages (3):"; echo deu; echo eng; echo osd\n');
      const ready = installSh(['--unattended', '--install-ocr']);
      assert.equal(ready.status, 0, ready.err + ready.out);
      assert.ok(!/wird installiert/.test(ready.out), ready.out);
      assert.match(ready.out, /Texterkennung: +.*tesseract/);
      // Der Installationskern fragt Tesseract selbst nach den Sprachdaten. Unter Windows lässt sich das
      // nachgestellte Programm (ein Bash-Skript) von Node aus nicht starten – dort greift der Rückfall.
      if (process.platform === 'win32') assert.match(ready.out, /Sprachdaten ließen sich nicht ermitteln .* eingetragen wird deu\+eng/);
      else assert.match(ready.out, /Sprachen: deu\+eng/, 'der Installationskern prüft die Sprachdaten');
    });

    await t.test('install.sh: ein Starter »libreoffice« ohne soffice dahinter (Snap) gilt nicht als LibreOffice', () => {
      reset();
      stub('libreoffice', 'exit 0');
      // Mit Rückfragen, alles Vorgabe: Gefragt wird nach der Installation – nicht, ob das Gefundene eingeschaltet werden soll
      const res = installSh([], '\n\n\n\n\n\n\n');
      assert.equal(res.status, 0, res.err + res.out);
      assert.ok(!/LibreOffice gefunden/.test(res.out), res.out);
      assert.ok(!/--office-path/.test(res.out), res.out);
      const wanted = installSh(['--unattended', '--install-office']);
      assert.equal(wanted.status, 0, wanted.err + wanted.out);
      assert.match(wanted.out, /Office-Vorschau: +wird installiert/);
    });

    // ----- Echter Ablauf (kein Probelauf) in einem eigenen Programmordner mit nachgestelltem Installationskern:
    // »id« meldet root, »systemctl« protokolliert nur, der Ort des Dienst-Eintrags ist umgelenkt.
    const stage = path.join(dir, 'programm');
    fs.mkdirSync(path.join(stage, 'scripts', 'install', 'linux'), { recursive: true });
    fs.copyFileSync(path.join(root, 'install.sh'), path.join(stage, 'install.sh'));
    fs.copyFileSync(path.join(root, 'scripts', 'install', 'linux', 'extras.sh'), path.join(stage, 'scripts', 'install', 'linux', 'extras.sh'));
    const coreLog = path.join(dir, 'kern.log');
    fs.writeFileSync(
      path.join(stage, 'scripts', 'install.mjs'),
      `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CORE_LOG, args.join(' ') + '\\n');
const report = args.indexOf('--report');
if (report >= 0 && process.env.CORE_WARN) fs.writeFileSync(args[report + 1], process.env.CORE_WARN + '\\n');
console.log('  Knowstead – Installation (nachgestellt)');
process.exit(Number(process.env.CORE_EXIT || 0));
`,
    );
    const unit = path.join(dir, 'knowstead.service');
    const realRun = (args: string[], extra: Record<string, string> = {}) => {
      stub('id', 'echo 0');
      // Sicherheitsnetz: Sollte die Routine doch nach Root-Rechten fragen, darf kein echtes sudo anlaufen
      stub('sudo', `echo "sudo $*" >> "${log}"\nexit 97`);
      stub('systemctl', `echo "systemctl $*" >> "${log}"\ncase "$1" in\n  is-active) exit "\${SERVICE_ACTIVE:-3}" ;;\n  start) exit "\${START_EXIT:-0}" ;;\nesac\nexit 0`);
      fs.rmSync(log, { force: true });
      fs.rmSync(coreLog, { force: true });
      // Die Bash von Git stellt ihre eigenen Ordner vor den Suchpfad – dort gibt es ein echtes »id«. Deshalb den
      // Ordner mit den nachgestellten Programmen erst in der Shell nach vorn setzen.
      const res = spawnSync(bash!, ['-c', 'PATH="$(cd "$STUBS" && pwd):$PATH" exec bash install.sh "$@"', 'install.sh', '--unattended', '--data-dir', '/var/lib/knowstead-test', ...args], {
        cwd: stage,
        encoding: 'utf8',
        env: env({ STUBS: bin.replaceAll('\\', '/'), CORE_LOG: coreLog, KNOWSTEAD_UNIT_FILE: unit.replaceAll('\\', '/'), ...extra }),
      });
      return {
        status: res.status,
        out: res.stdout.replaceAll('\r', ''),
        err: res.stderr.replaceAll('\r', ''),
        core: fs.existsSync(coreLog) ? fs.readFileSync(coreLog, 'utf8') : '',
        systemctl: calls().filter((c) => c.startsWith('systemctl')),
      };
    };

    await t.test('install.sh: Fehlschlag nach dem Anhalten – ein vorher laufender Dienst wird wieder gestartet', () => {
      reset();
      fs.writeFileSync(unit, '[Unit]\n');
      const res = realRun(['--service', 'systemd'], { SERVICE_ACTIVE: '0', CORE_EXIT: '1' });
      assert.equal(res.status, 1, res.out + res.err);
      assert.deepEqual(res.systemctl, ['systemctl is-active --quiet knowstead', 'systemctl stop knowstead', 'systemctl start knowstead']);
      assert.match(res.err, /lief vorher – er wird wieder gestartet/);
      assert.match(res.err, /Dienst gestartet\./);
      assert.ok(!/Fertig\./.test(res.out), 'kein Abschluss nach einem Fehlschlag');

      // Der Dienst lief nicht: nichts anhalten, nichts starten
      const idle = realRun(['--service', 'systemd'], { SERVICE_ACTIVE: '3', CORE_EXIT: '1' });
      assert.equal(idle.status, 1, idle.out + idle.err);
      assert.deepEqual(idle.systemctl, ['systemctl is-active --quiet knowstead']);
      assert.ok(!/wird wieder gestartet/.test(idle.err), idle.err);

      // Auch der Neustart scheitert: Meldung, wo es weitergeht – der Fehlercode bleibt der des Fehlschlags
      const broken = realRun(['--service', 'systemd'], { SERVICE_ACTIVE: '0', CORE_EXIT: '1', START_EXIT: '5' });
      assert.equal(broken.status, 1, broken.out + broken.err);
      assert.match(broken.err, /Der Dienst ließ sich nicht starten – Protokoll: journalctl -u knowstead -n 50/);
      fs.rmSync(unit, { force: true });
    });

    await t.test('install.sh: Hinweise des Installationskerns stehen am Ende noch einmal', () => {
      reset();
      const res = realRun(['--service', 'none'], { CORE_WARN: 'Texterkennung: Sprachdaten fehlen für deu – erkannt wird vorerst nur eng.' });
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Fertig\.[\s\S]*Hinweise – Knowstead ist eingerichtet[\s\S]*\[!\] Texterkennung: Sprachdaten fehlen für deu – erkannt wird vorerst nur eng\.[\s\S]*Nachholen: Administration → KI & Dateien/);
      const reportFile = /--report (\S+)/.exec(res.core)?.[1];
      assert.ok(reportFile, res.core);
      assert.equal(fs.existsSync(reportFile), false, 'die Zwischendatei ist wieder weg');
      assert.deepEqual(res.systemctl, [], 'ohne Dienst-Eintrag kein systemctl');

      // Ohne Hinweise bleibt der Abschluss, wie er war
      const quiet = realRun(['--service', 'none']);
      assert.equal(quiet.status, 0, quiet.out + quiet.err);
      assert.match(quiet.out, /Fertig\./);
      assert.ok(!/Hinweise/.test(quiet.out), quiet.out);
    });

    await t.test('install.sh: echter Ablauf – erst installieren, dann Pfade und Sprachen an den Installationskern', () => {
      reset();
      const res = realRun(['--service', 'none', '--install-ocr', '--install-office', '--ocr-languages', 'deu+eng']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.core, /--ocr-path .*\/bin\/tesseract --ocr-languages deu\+eng --office-path .*\/bin\/soffice/);
      assert.ok(!/Hinweise/.test(res.out), res.out);
    });

    await t.test('install.sh: Paketverwaltung scheitert – Knowstead wird trotzdem eingerichtet, Hinweis am Ende', () => {
      reset();
      const res = realRun(['--service', 'none', '--install-ocr', '--install-office'], { APT_FAIL: '1' });
      assert.equal(res.status, 0, res.out + res.err);
      assert.ok(!/--ocr-path|--office-path/.test(res.core), res.core);
      assert.match(res.out, /Fertig\.[\s\S]*Hinweise – Knowstead ist eingerichtet[\s\S]*Texterkennung: Tesseract wurde nicht installiert[\s\S]*Office-Vorschau: LibreOffice wurde nicht installiert/);
    });

    await t.test('install.sh: Sprachdaten kommen nicht hinzu – vorhandenes Tesseract wird trotzdem eingeschaltet', () => {
      reset();
      fs.writeFileSync(path.join(bin, 'tesseract'), '#!/usr/bin/env bash\necho "List of available languages (2):"; echo eng; echo osd\n');
      fs.chmodSync(path.join(bin, 'tesseract'), 0o755);
      const res = realRun(['--service', 'none', '--install-ocr'], { APT_FAIL: '1' });
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Die Sprachdaten ließen sich nicht installieren/);
      // Welche Sprachen es werden, entscheidet der Installationskern anhand von tesseract --list-langs
      assert.match(res.core, /--ocr-path .*\/bin\/tesseract --ocr-languages deu\+eng/);
    });

    // ----- Installation aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9): Dienst und Konto »doku« bleiben.
    // Nur der Ordner der Dienst-Einträge ist umgelenkt – finden muss install.sh den früheren Dienst selbst.
    const units = path.join(dir, 'units');
    fs.mkdirSync(units);
    const shellPath = (p: string) => spawnSync(bash!, ['-c', 'cd "$1" && pwd', 'pwd', p.replaceAll('\\', '/')], { encoding: 'utf8' }).stdout.trim();
    const legacyRun = (args: string[], extra: Record<string, string> = {}) => {
      stub('id', 'echo 0');
      stub('sudo', `echo "sudo $*" >> "${log}"\nexit 97`);
      stub('systemctl', `echo "systemctl $*" >> "${log}"\ncase "$1" in\n  is-active) exit "\${SERVICE_ACTIVE:-3}" ;;\nesac\nexit 0`);
      fs.rmSync(log, { force: true });
      fs.rmSync(coreLog, { force: true });
      const res = spawnSync(bash!, ['-c', 'PATH="$(cd "$STUBS" && pwd):$PATH" exec bash install.sh "$@"', 'install.sh', '--dry-run', '--unattended', ...args], {
        cwd: stage,
        encoding: 'utf8',
        env: env({ STUBS: bin.replaceAll('\\', '/'), CORE_LOG: coreLog, KNOWSTEAD_UNIT_DIR: units.replaceAll('\\', '/'), ...extra }),
      });
      return { status: res.status, out: res.stdout.replaceAll('\r', ''), err: res.stderr.replaceAll('\r', ''), core: fs.existsSync(coreLog) ? fs.readFileSync(coreLog, 'utf8') : '' };
    };

    await t.test('install.sh über einer früheren Installation: Dienst und Konto »doku« bleiben, Angaben kommen aus der .env', () => {
      reset();
      fs.writeFileSync(path.join(units, 'doku.service'), `[Service]\nUser=doku\nGroup=doku\nWorkingDirectory=${shellPath(stage)}\n`);
      fs.writeFileSync(path.join(stage, '.env'), 'PORT=3111\nHOST=127.0.0.1\nDATA_DIR=/var/lib/doku\nBASE_URL=https://wiki.firma.example\nDOKU_SERVICE=systemd\n');
      try {
        const res = legacyRun([], { SERVICE_ACTIVE: '0' });
        assert.equal(res.status, 0, res.out + res.err);
        assert.match(res.out, /Datenverzeichnis: +\/var\/lib\/doku\n/, 'kein neues Datenverzeichnis /var/lib/knowstead');
        assert.match(res.out, /Autostart: +systemd \(Konto doku\)/);
        assert.match(res.out, /\(Probelauf\) systemctl stop doku/);
        assert.match(res.out, /\(Probelauf\) .*\/units\/doku\.service:/, 'der bestehende Dienst-Eintrag wird fortgeschrieben, kein zweiter angelegt');
        assert.match(res.out, /^\s+User=doku$/m);
        assert.ok(!/useradd/.test(res.out), 'kein neues Konto');
        assert.ok(!/knowstead\.service/.test(res.out), res.out);
        // (Die Bash von Git stellt Pfaden für Windows-Programme ihren eigenen Ordner voran)
        assert.match(res.core, /--data-dir .*\/var\/lib\/doku --port 3111 .*--service systemd/);
        assert.equal(fs.existsSync(path.join(units, 'knowstead.service')), false);

        // Gibt es beide Dienst-Einträge, gilt der neue
        fs.writeFileSync(path.join(units, 'knowstead.service'), `[Service]\nUser=knowstead\nWorkingDirectory=${shellPath(stage)}\n`);
        const both = legacyRun([]);
        assert.equal(both.status, 0, both.out + both.err);
        assert.match(both.out, /Autostart: +systemd \(Konto knowstead\)/);
        assert.match(both.out, /\(Probelauf\) .*\/units\/knowstead\.service:/);
      } finally {
        fs.rmSync(path.join(units, 'knowstead.service'), { force: true });
        fs.rmSync(path.join(units, 'doku.service'), { force: true });
        fs.rmSync(path.join(stage, '.env'), { force: true });
      }
    });

    await t.test('install.sh in einem frisch entpackten Paket neben einer bestehenden Installation: Abbruch mit Hinweis auf update.sh', () => {
      reset();
      const installed = path.join(dir, 'opt', 'doku');
      fs.mkdirSync(installed, { recursive: true });
      fs.writeFileSync(path.join(installed, '.env'), 'DATA_DIR=/var/lib/doku\n');
      fs.writeFileSync(path.join(units, 'doku.service'), `[Service]\nUser=doku\nWorkingDirectory=${shellPath(installed)}/\n`);
      try {
        const res = legacyRun([]);
        assert.equal(res.status, 1, res.out + res.err);
        assert.match(res.err, /bereits eingerichtet: Dienst »doku«, Programmordner .*\/opt\/doku\./);
        assert.match(res.err, /Aktualisieren: +bash .*\/programm\/update\.sh/);
        assert.match(res.err, /cp -p .*\/opt\/doku\/\.env .*\/programm\/\.env/);
        assert.equal(res.core, '', 'der Installationskern lief nicht');
        assert.deepEqual(calls(), [], 'der Dienst wurde nicht angefasst');

        // Mit übernommener .env ist es gewollt: Dieser Ordner löst die Installation ab
        fs.copyFileSync(path.join(installed, '.env'), path.join(stage, '.env'));
        const taken = legacyRun([]);
        assert.equal(taken.status, 0, taken.out + taken.err);
        assert.match(taken.out, /Datenverzeichnis: +\/var\/lib\/doku\n/);
        fs.rmSync(path.join(stage, '.env'));

        // Entfernen bleibt möglich
        const removed = legacyRun(['--uninstall']);
        assert.equal(removed.status, 0, removed.out + removed.err);
        assert.match(removed.out, /\(Probelauf\) systemctl disable --now doku/);

        // Ein Dienst-Eintrag, dessen Ordner es nicht mehr gibt, hält eine neue Installation nicht auf
        fs.rmSync(path.join(installed, '.env'));
        const orphan = legacyRun(['--data-dir', '/var/lib/knowstead-test']);
        assert.equal(orphan.status, 0, orphan.out + orphan.err);
      } finally {
        fs.rmSync(path.join(units, 'doku.service'), { force: true });
        fs.rmSync(path.join(stage, '.env'), { force: true });
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
