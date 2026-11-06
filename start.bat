@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" launch.py
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    py -3 launch.py
  ) else (
    python launch.py
  )
)
if errorlevel 1 pause
