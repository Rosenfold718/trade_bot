#!/bin/bash
# Persistent dev server wrapper with auto-restart
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting dev server..."
  npx next dev -p 3000 2>&1
  EXIT_CODE=$?
  echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 2s..."
  sleep 2
done