@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" companion\server.py
) else (
  python companion\server.py
)
if errorlevel 1 pause
