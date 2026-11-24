@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Academy
set "academy_exit=%errorlevel%"
if not "%academy_exit%"=="0" pause
exit /b %academy_exit%
