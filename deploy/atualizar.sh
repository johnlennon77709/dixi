#!/usr/bin/env bash
# Atualiza o sistema para a versão mais nova do repositório (faz backup antes).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T app node --no-warnings src/backup.js || true
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Atualizado."
