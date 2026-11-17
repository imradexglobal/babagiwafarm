@echo off
setlocal
title Babagiwa Farm - Firebase Hosting Deploy
echo ==========================================
echo  BABAGIWA FARM - FIREBASE HOSTING DEPLOY
echo ==========================================
echo.

:: Project root is two levels above scripts\dev_test.
cd /d "%~dp0..\.."
if not exist "firebase.json" (
  echo [ERROR] firebase.json is missing. No deployment attempted.
  pause
  exit /b 1
)
if not exist "package.json" (
  echo [ERROR] package.json is missing. Cannot build the website.
  pause
  exit /b 1
)

set "FIREBASE_PROJECT=babagiwafarm"
set "FIREBASE_SITE=babagiwafarm"

echo Target Firebase project: %FIREBASE_PROJECT%
echo Target Hosting site: %FIREBASE_SITE%
echo Hosting URL: https://%FIREBASE_SITE%.web.app
echo Build output: %CD%\dist
echo.
echo This operation builds and publishes the website to Firebase Hosting.
echo It does not deploy Firestore rules or modify Firestore data.
echo.
set /p "CONFIRM=Type DEPLOY to build and publish: "
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
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js with npm and try again.
  pause
  exit /b 1
)

echo.
echo [INFO] Building the production website...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Website build failed. Nothing was published.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo [ERROR] Build completed but dist\index.html was not created. Nothing was published.
  pause
  exit /b 1
)

echo.
echo [INFO] Deploying Firebase Hosting only...
if exist "node_modules\.bin\firebase.cmd" (
  call node_modules\.bin\firebase.cmd deploy --only hosting --project "%FIREBASE_PROJECT%"
) else (
  echo [INFO] Firebase CLI not installed locally; using npx. Internet access may be required.
  call npx --yes firebase-tools deploy --only hosting --project "%FIREBASE_PROJECT%"
)
if errorlevel 1 (
  echo.
  echo [ERROR] Firebase Hosting deployment failed. Check CLI authentication, project access,
  echo and the Firebase CLI output above.
  pause
  exit /b 1
)

echo.
echo [SUCCESS] Website published to https://%FIREBASE_SITE%.web.app
echo If the domain does not load immediately, wait briefly and try again.
pause
exit /b 0
