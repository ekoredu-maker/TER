@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
if exist "%~dp0runtime\python.exe" set "PYTHON_EXE=%~dp0runtime\python.exe"
if not defined PYTHON_EXE where py >nul 2>nul && set "PYTHON_EXE=py -3"
if not defined PYTHON_EXE where python >nul 2>nul && set "PYTHON_EXE=python"

if not defined PYTHON_EXE (
  echo [오류] Python 실행환경을 찾을 수 없습니다.
  echo 포터블 배포판에서는 runtime\python.exe가 포함되어야 합니다.
  pause
  exit /b 1
)

%PYTHON_EXE% launcher.py
if errorlevel 1 (
  echo.
  echo 프로그램 실행 중 오류가 발생했습니다. logs 폴더를 확인해 주세요.
  pause
)

endlocal
