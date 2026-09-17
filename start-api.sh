#!/bin/bash
# Free port 8002 first so a restart can never hit "address already in use".
# uvicorn --workers can leave a child worker holding the socket for a moment
# after the master exits; that was causing an infinite pm2 restart loop.
pkill -f 'uvicorn loomrun_api.main:app' 2>/dev/null || true
sleep 2

exec /var/www/loomrun/apps/api/.venv/bin/uvicorn loomrun_api.main:app \
  --host 127.0.0.1 \
  --port 8002 \
  --workers 1
