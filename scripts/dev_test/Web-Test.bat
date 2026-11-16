@echo off
setlocal
title Babagiwa Farm - Web Test
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Web-Test.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo.
if not "%RESULT%"=="0" echo [ERROR] Web test stopped with exit code %RESULT%. The window will remain open.
pause
exit /b %RESULT%
