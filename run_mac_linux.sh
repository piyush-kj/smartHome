#!/usr/bin/env bash
# SmartGuard - start script for macOS and Linux
cd "$(dirname "$0")" || exit 1

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

# shellcheck disable=SC1091
source venv/bin/activate
echo "Installing requirements (first run only)..."
pip install -q -r requirements.txt

echo
echo "Starting SmartGuard..."
echo "Open http://127.0.0.1:5000 in your browser"
echo "Press Ctrl+C to stop."
echo
python app.py
