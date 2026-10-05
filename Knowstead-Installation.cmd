@echo off
rem ---------------------------------------------------------------------------
rem  Knowstead installieren, Einstellungen aendern oder Update abschliessen (Windows)
rem
rem  Doppelklick genuegt: Ein Assistent fragt alle Angaben ab und richtet
rem  Konfiguration, Autostart, Firewall und Zusatzprogramme ein. Danach folgt
rem  die Ersteinrichtung im Browser.
rem
rem  Ohne Rueckfragen (z. B. fuer Updates oder Skripte):
rem    Knowstead-Installation.cmd -Unattended -DataDir D:\KnowsteadDaten -BaseUrl https://knowstead.firma.de
rem  Nur anzeigen, was geschehen wuerde:   Knowstead-Installation.cmd -Unattended -WhatIf
rem  Autostart wieder entfernen:           Knowstead-Installation.cmd -Uninstall
rem
rem  Sprache: Deutsch oder Englisch nach der Anzeigesprache von Windows; ausdruecklich mit
rem    Knowstead-Installation.cmd -Language en   bzw.   -Language de
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install\windows\Install-Knowstead.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo   [!] Die Installation wurde mit Fehler %EXITCODE% beendet. / The installation ended with error %EXITCODE%.
  pause
)
exit /b %EXITCODE%
