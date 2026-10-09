@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\beta-maintenance.ps1" -Action check
