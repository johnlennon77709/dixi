#!/usr/bin/env bash
# Instala o DIXI-MVP Ponto num servidor Ubuntu/Debian com domínio próprio.
# Uso (como root, dentro da pasta do projeto):  sudo bash deploy/instalar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash deploy/instalar.sh"; exit 1; fi

echo "== 1/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null

echo "== 2/5 Configuração (.env)"
if [ ! -f .env ]; then
  read -rp "Domínio (ex.: ponto.suaempresa.com.br): " DOMINIO
  read -rp "E-mail para o certificado HTTPS: " EMAIL_SSL
  sed -e "s|^DOMINIO=.*|DOMINIO=${DOMINIO}|" \
      -e "s|^EMAIL_SSL=.*|EMAIL_SSL=${EMAIL_SSL}|" \
      -e "s|^DIXI_SEGREDO=.*|DIXI_SEGREDO=$(openssl rand -hex 32)|" .env.exemplo > .env
  chmod 600 .env
else
  echo ".env já existe, mantendo."
fi
DOMINIO=$(grep -E '^DOMINIO=' .env | cut -d= -f2)

echo "== 3/5 Conferindo o DNS de ${DOMINIO}"
IP_SERVIDOR=$(curl -4 -fsS https://api.ipify.org || true)
IP_DNS=$(getent ahostsv4 "${DOMINIO}" | awk 'NR==1{print $1}' || true)
if [ -n "$IP_SERVIDOR" ] && [ "$IP_SERVIDOR" != "$IP_DNS" ]; then
  echo "ATENÇÃO: ${DOMINIO} aponta para '${IP_DNS:-nada}', mas este servidor é ${IP_SERVIDOR}."
  echo "Crie um registro DNS do tipo A: ${DOMINIO} -> ${IP_SERVIDOR}. Sem isso o HTTPS não é emitido."
  read -rp "Continuar mesmo assim? [s/N] " r; [ "${r:-n}" = "s" ] || exit 1
fi

echo "== 4/5 Firewall e subida dos containers"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp; fi
mkdir -p certificado
docker compose up -d --build

echo "== 5/5 Backup diário (03:17) em /var/backups/dixi"
mkdir -p /var/backups/dixi
cat > /etc/cron.d/dixi-backup <<CRON
17 3 * * * root cd $(pwd) && docker compose exec -T app node --no-warnings src/backup.js >/dev/null && docker compose cp app:/app/data/backups/. /var/backups/dixi/ >/dev/null 2>&1
CRON

echo -n "Aguardando o sistema ficar pronto"
for i in $(seq 1 60); do
  if curl -fsS "https://${DOMINIO}/api/saude" >/dev/null 2>&1; then echo; break; fi
  echo -n "."; sleep 3
done
echo
echo "=========================================================="
echo " Pronto: https://${DOMINIO}"
echo " 1. Abra o endereço e clique em 'Criar empresa' (a primeira conta vira a administradora)."
echo " 2. Depois disso o cadastro público fecha automaticamente."
echo " 3. Bater ponto no celular: aba 'Celular' do painel (QR code) -> Instalar app."
echo " Atualizar: bash deploy/atualizar.sh   |   Logs: docker compose logs -f app"
echo "=========================================================="
