@echo off
setlocal
set "PYTHON_MANAGER_AUTOMATIC_INSTALL=false"
set "PYLAUNCHER_ALLOW_INSTALL="
set "PYLAUNCHER_ALWAYS_INSTALL="
set "PYLAUNCHER_DRYRUN="
set "SETUP_ARGS=%~1"
cd /d "%~dp0"
echo Looking for an installed compatible Python...
if /i "%SETUP_ARGS%"=="--repair" goto systemPython
if exist ".venv-bql\Scripts\python.exe" (
  call :tryPython ".venv-bql\Scripts\python.exe"
  if not errorlevel 1 goto finished
)
:systemPython
call :tryPython py
if not errorlevel 1 goto finished
for %%V in (3.14 3.13 3.12) do (
  call :tryPython py -%%V
  if not errorlevel 1 goto finished
)
for %%P in (python python3) do (
  call :tryPython %%P
  if not errorlevel 1 goto finished
)
echo No compatible Python found. Install standard 64-bit CPython 3.12, 3.13 or 3.14 for Windows x64.
pause
exit /b 1
:tryPython
rem Some Python managers return success even when no runtime exists: require our sentinel.
call %* setup.py --check-runtime 2>nul | findstr /b /c:"Compatible Python " >nul
if errorlevel 1 exit /b 1
call %* setup.py %SETUP_ARGS%
rem A selected runtime failure must not trigger another package installation.
set "SETUP_RESULT=%errorlevel%"
exit /b 0
:finished
if not "%SETUP_RESULT%"=="0" echo Setup failed. Check network access and the error above. Run Repair.cmd if needed.
pause
exit /b %SETUP_RESULT%
