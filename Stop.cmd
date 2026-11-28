@echo off
setlocal
node "%~dp0frontend\electron\launch.cjs" --aetherloom-stop
set "stop_exit=%errorlevel%"
if not "%stop_exit%"=="0" pause
exit /b %stop_exit%
