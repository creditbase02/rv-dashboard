@echo off
setlocal
cd /d "%~dp0"
echo Repair rebuilds this folder's BQL packages and needs network access.
echo The previous environment will be kept as a backup. Close any active queries first.
choice /c YN /n /m "Repair installation? [Y/N] "
if errorlevel 2 exit /b 0
if exist ".venv-bql\Scripts\python.exe" (
  ".venv-bql\Scripts\python.exe" "scripts\start_bql_preview.py" --stop
  if errorlevel 1 (
    echo Close the existing BQL launcher first, then try Repair.cmd again.
    pause
    exit /b 1
  )
)
call Setup.cmd --repair
exit /b %errorlevel%
