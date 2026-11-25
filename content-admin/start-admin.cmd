@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (echo.& echo Start failed, see the error above.) else (start "" http://127.0.0.1:3214)
pause
