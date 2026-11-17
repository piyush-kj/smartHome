@echo off
title SmartGuard - Smart Home Security
cd /d "%~dp0"

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate
echo Installing requirements (first run only)...
pip install -q -r requirements.txt

echo.
echo Starting SmartGuard...
echo Open http://127.0.0.1:5000 in your browser
echo Press CTRL+C to stop.
echo.
python app.py
pause
