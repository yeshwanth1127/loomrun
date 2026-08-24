#!/bin/bash
exec /var/www/loomrun/apps/api/.venv/bin/uvicorn loomrun_api.main:app \
  --host 127.0.0.1 \
  --port 8002 \
  --workers 2
