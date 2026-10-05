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

rem Sprache der Meldungen: KNOWSTEAD_LANG (de oder en), sonst die Anzeigesprache von Windows
if not defined KNOWSTEAD_LANG for /f "usebackq delims=" %%L in (`powershell.exe -NoProfile -Command "(Get-UICulture).TwoLetterISOLanguageName" 2^>nul`) do set "KNOWSTEAD_LANG=%%L"
if /i not "%KNOWSTEAD_LANG%"=="de" set "KNOWSTEAD_LANG=en"
if "%KNOWSTEAD_LANG%"=="de" (
  set "M_TITLE=Knowstead - Dokumentation und Wissen"
  set "M_NONODE=Node.js wurde nicht gefunden."
  set "M_INSTALL=Bitte Node.js 24 oder neuer installieren: https://nodejs.org/"
  set "M_START=Server startet ..."
  set "M_ADDRESS=Adresse:"
  set "M_STOP=Beenden: dieses Fenster schliessen oder Strg+C"
  set "M_ERROR=Es ist ein Fehler aufgetreten. Bitte die Meldungen oben pruefen."
) else (
  set "M_TITLE=Knowstead - documentation and knowledge"
  set "M_NONODE=Node.js was not found."
  set "M_INSTALL=Please install Node.js 24 or newer: https://nodejs.org/"
  set "M_START=Starting the server ..."
  set "M_ADDRESS=Address:"
  set "M_STOP=Stop: close this window or press Ctrl+C"
  set "M_ERROR=An error occurred. Please check the messages above."
)

echo.
echo   ####   %M_TITLE%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] %M_NONODE%
  echo       %M_INSTALL%
  echo.
  pause
  exit /b 1
)

rem Abhaengigkeiten und Oberflaeche pruefen - nach einem Update wird beides automatisch aktualisiert
node scripts\prepare.mjs || goto :fehler

echo   [3/3] %M_START%
echo.
echo   %M_ADDRESS% http://localhost:3000
echo   %M_STOP%
echo.

start "" http://localhost:3000
call npm start
goto :ende

:fehler
echo.
echo   [!] %M_ERROR%
pause
exit /b 1

:ende
endlocal
