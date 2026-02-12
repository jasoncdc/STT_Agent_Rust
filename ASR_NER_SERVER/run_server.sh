#!/bin/bash
# Activate virtual environment if you have one, e.g.:
# source venv/bin/activate

echo "Installing server dependencies..."
pip install -r requirements_server.txt

echo "Starting ASR NER Server..."
python3 ASR_NER_Server.py
