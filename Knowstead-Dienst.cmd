@echo off
rem ---------------------------------------------------------------------------
rem  Knowstead steuern (Windows):  Knowstead-Dienst.cmd start ^| stop ^| restart ^| status ^| log
rem  Protokoll laufend verfolgen:  Knowstead-Dienst.cmd log -Follow
rem  Sprache der Meldungen:       Knowstead-Dienst.cmd status -Language en   (sonst Anzeigesprache von Windows)
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
set ACTION=%~1
if "%ACTION%"=="" set ACTION=status
if /i "%ACTION%"=="start" goto :admin
if /i "%ACTION%"=="stop" goto :admin
if /i "%ACTION%"=="restart" goto :admin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install\windows\Knowstead-Dienst.ps1" %*
exit /b %ERRORLEVEL%

:admin
rem Starten und Beenden brauchen Administratorrechte
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install\windows\Knowstead-Dienst.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
