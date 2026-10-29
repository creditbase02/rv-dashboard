@echo off
cd /d "%~dp0"
if not exist ".venv-bql\Scripts\python.exe" (
  echo Run Setup.cmd first. If installation is damaged, run Repair.cmd.
  pause
  exit /b 1
)
".venv-bql\Scripts\python.exe" "scripts\start_bql_preview.py" --reset
if errorlevel 1 echo Reset failed. Read the message above. Other programs were not stopped.
pause
