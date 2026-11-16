@echo off
setlocal
title Babagiwa Farm - Firestore Rules Deploy
echo ==========================================
echo  Babagiwa Farm - FIRESTORE RULES DEPLOY
echo ==========================================
echo.

:: Project root is two levels above scripts\dev_test.
cd /d "%~dp0..\.."
if not exist "firebase.json" (
  echo [ERROR] firebase.json is missing. No deployment attempted.
  pause
  exit /b 1
)
if not exist "firestore.rules" (
  echo [ERROR] firestore.rules is missing. No deployment attempted.
  pause
  exit /b 1
)

set "FIREBASE_PROJECT=babagiwafarm"
set "FIRESTORE_DATABASE=(default)"

echo Target Firebase project: %FIREBASE_PROJECT%
echo Target Firestore database: %FIRESTORE_DATABASE%
echo Rules file: %CD%\firestore.rules
echo.
echo This operation changes Firestore SECURITY RULES only.
echo It does not deploy hosting, functions, or application data.
echo.
set /p "CONFIRM=Type DEPLOY to continue: "
if /I not "%CONFIRM%"=="DEPLOY" (
  echo [CANCELLED] No deployment was performed.
  pause
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  pause
  exit /b 1
)

if exist "node_modules\.bin\firebase.cmd" (
  call node_modules\.bin\firebase.cmd deploy --only firestore:rules --project "%FIREBASE_PROJECT%"
) else (
  echo [INFO] Running Firebase CLI via npx; internet access may be required on first run.
  call npx --yes firebase-tools deploy --only firestore:rules --project "%FIREBASE_PROJECT%"
)
if errorlevel 1 (
  echo.
  echo [ERROR] Firestore rules deployment failed. Check Firebase CLI authentication,
  echo project access, database configuration, and the CLI output above.
  pause
  exit /b 1
)

echo.
echo [SUCCESS] Firestore rules deployment completed for %FIRESTORE_DATABASE%.
pause
exit /b 0
