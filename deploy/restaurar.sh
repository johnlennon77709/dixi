#!/usr/bin/env bash
# Restaura um backup:  sudo bash deploy/restaurar.sh /var/backups/dixi/dixi-AAAA-MM-DD-hh-mm-ss.db
set -euo pipefail
cd "$(dirname "$0")/.."
ARQ="${1:?informe o arquivo de backup}"
docker compose stop app
docker compose cp "$ARQ" app:/app/data/dixi.db
docker compose run --rm --user root --entrypoint sh app -c "rm -f /app/data/dixi.db-wal /app/data/dixi.db-shm; chown node:node /app/data/dixi.db"
docker compose start app
echo "Backup restaurado: $ARQ"
