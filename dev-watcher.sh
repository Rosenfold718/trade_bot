#!/bin/bash
while true; do
  cd /home/z/my-project
  NODE_OPTIONS="--max-old-space-size=1536" bun run dev
  echo "[watcher] dev server exited, restarting in 3s..."
  sleep 3
done
