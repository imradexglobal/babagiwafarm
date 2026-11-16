# Babagiwa Farm developer test scripts

These scripts follow the workflow style in `medlogng/scripts/dev_test`, adapted for this repository's Vite app and Firebase project.

## Test the web app

Double-click `Web-Test.bat`. Its PowerShell runner checks Node/npm, installs the project's dependencies if Vite is missing, runs a production build, then starts the development server at `http://127.0.0.1:3001/`. Port 3001 is fixed; if it is already in use, the script reports that and stops instead of silently changing ports. It opens the browser once the server responds. Press Ctrl+C in the console to stop Vite.

The project currently has a Bun lockfile but no npm lockfile or Bun executable on PATH, so the fallback uses npm with `--no-package-lock --legacy-peer-deps` and registry retries. The legacy peer option handles the existing Vite 8 / esbuild version relationship in the package manifest/lockfile.

## Deploy Firestore rules

Double-click `Firestore-Deploy.bat`. It displays and confirms the target before doing anything. You must type `DEPLOY` to proceed. It deploys **Firestore rules only**, not Hosting, Functions, or any application records.

The target is explicitly set to:

- Firebase project: `babagiwafarm`
- Firestore database: `(default)`
- Rules source: the root `firestore.rules`

The root `firebase.json` maps that named database to `firestore.rules`; `.firebaserc` selects the matching project. Before deploying, authenticate the Firebase CLI if needed (`npx firebase-tools login`) and ensure the signed-in account has deployment permission. The deploy script may need internet access on first run.

## Notes

- Review `firestore.rules` before each deploy. A rules deployment changes access to live Firestore data, though it does not modify the data itself.
- Neither script includes credentials or copies the other project's Firebase target.
