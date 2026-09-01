@echo off
cd /d "%~dp0"
echo Installing dependencies (only needed the first time)...
pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo pip failed, trying py -m pip instead...
    py -m pip install -r requirements.txt >nul 2>&1
)
echo Starting UrbanFlow Portal...
start "" cmd /c "timeout /t 2 >nul && start http://localhost:8000"
uvicorn main:app --reload
pause
