@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 goto :folder_error

if not exist "%~dp0runtime\python.exe" goto :runtime_error
if not exist "%~dp0launcher.py" goto :launcher_error

"%~dp0runtime\python.exe" "%~dp0launcher.py"
set "RC=%ERRORLEVEL%"
popd
if "%RC%"=="0" exit /b 0

echo.
echo ERROR: Program stopped with exit code %RC%.
echo Check the logs folder.
pause
exit /b %RC%

:folder_error
echo ERROR: Cannot open the program folder.
pause
exit /b 1

:runtime_error
echo ERROR: runtime\python.exe was not found.
echo Re-extract the entire ZIP before running this file.
pause
exit /b 1

:launcher_error
echo ERROR: launcher.py was not found.
echo Re-extract the entire ZIP before running this file.
pause
exit /b 1
