@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/2] Updating to the latest version...
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder is not a git clone. Run once: git clone https://github.com/dujin986-bit/jeongeup-map
  pause
  exit /b
)
git pull origin main
if errorlevel 1 (
  echo Update failed. Check internet or local changes, then try again.
  pause
  exit /b
)
echo [2/2] Starting local server: http://localhost:8001  (close this window to stop)
start "" http://localhost:8001
where python >nul 2>nul && (python -m http.server 8001) || (py -m http.server 8001)
pause
