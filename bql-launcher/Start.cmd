@echo off
cd /d "%~dp0"
if not exist ".venv-bql\Scripts\python.exe" (
  echo Please run Setup.cmd first. Standard 64-bit CPython 3.12, 3.13 or 3.14 is required.
  pause
  exit /b 1
)
".venv-bql\Scripts\python.exe" "scripts\start_bql_preview.py"
if errorlevel 1 echo Connection failed. Confirm Bloomberg is logged in and no other bridge is using port 8768.
pause
