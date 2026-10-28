@echo off
cd /d "%~dp0"
if exist ".venv-bql\Scripts\python.exe" (
  ".venv-bql\Scripts\python.exe" setup.py --check-runtime >nul 2>&1
  if not errorlevel 1 (
    ".venv-bql\Scripts\python.exe" setup.py
    goto finished
  )
  echo Existing BQL environment is incompatible. Extract the launcher into a new folder and run Setup.cmd again.
  pause
  exit /b 1
)
for %%V in (3.12 3.13 3.14) do (
  py -%%V setup.py --check-runtime >nul 2>&1
  if not errorlevel 1 (
    py -%%V setup.py
    goto finished
  )
)
for %%P in (python python3) do (
  %%P setup.py --check-runtime >nul 2>&1
  if not errorlevel 1 (
    %%P setup.py
    goto finished
  )
)
echo No compatible Python found. Install standard 64-bit CPython 3.12, 3.13 or 3.14 for Windows x64.
pause
exit /b 1
:finished
set "setupResult=%errorlevel%"
if not "%setupResult%"=="0" echo Setup failed. Check the error above and company network access. No other Python version was installed.
pause
exit /b %setupResult%
