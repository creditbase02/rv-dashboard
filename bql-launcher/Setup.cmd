@echo off
cd /d "%~dp0"
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  python setup.py
) else (
  py -3.12 setup.py
)
if errorlevel 1 echo Setup failed. Check Python 3.12 64-bit and company network access.
pause
