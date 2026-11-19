@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 fetch_dongs.py
if errorlevel 1 python fetch_dongs.py
echo.
echo Done. Press any key to close.
pause >nul
