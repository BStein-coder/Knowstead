@echo off
rem ---------------------------------------------------------------------------
rem  Knowstead starten (Windows)
rem
rem  Doppelklick genügt: prüft Node.js, installiert bzw. aktualisiert die
rem  Abhängigkeiten, baut die Oberfläche (auch nach einem Update) und startet
rem  den Server. Vor Datenbank-Änderungen legt der Server selbst eine Sicherung an.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title Knowstead

echo.
echo   ####   Knowstead - Dokumentation und Wissen
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] Node.js wurde nicht gefunden.
  echo       Bitte Node.js 24 oder neuer installieren: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem Abhaengigkeiten und Oberflaeche pruefen - nach einem Update wird beides automatisch aktualisiert
node scripts\prepare.mjs || goto :fehler

echo   [3/3] Server startet ...
echo.
echo   Adresse: http://localhost:3000
echo   Beenden: dieses Fenster schliessen oder Strg+C
echo.

start "" http://localhost:3000
call npm start
goto :ende

:fehler
echo.
echo   [!] Es ist ein Fehler aufgetreten. Bitte die Meldungen oben pruefen.
pause
exit /b 1

:ende
endlocal
