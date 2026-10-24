@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r companion\requirements-keep.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" companion\connect_keep.py
pause
exit /b
:failed
echo Could not prepare the optional Keep connection. Check Python and internet access.
pause
