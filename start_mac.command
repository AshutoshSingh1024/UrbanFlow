#!/bin/bash
cd "$(dirname "$0")"
echo "Installing dependencies (only needed the first time)..."
pip3 install -r requirements.txt -q 2>/dev/null || pip install -r requirements.txt -q
echo "Starting UrbanFlow Portal..."
( sleep 2 && open http://localhost:8000 ) &
uvicorn main:app --reload || python3 -m uvicorn main:app --reload
