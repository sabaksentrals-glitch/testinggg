#!/bin/sh
set -eu
cd /workspace
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true
if [ -f /workspace/.local/database-url ]; then
  DATABASE_URL=$(cat /workspace/.local/database-url)
  export DATABASE_URL
elif [ -f /tmp/bioflog-database-url ]; then
  DATABASE_URL=$(cat /tmp/bioflog-database-url)
  export DATABASE_URL
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
