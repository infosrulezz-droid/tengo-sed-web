#!/bin/bash
# n8n auto-install startup script for Google Cloud e2-micro (Ubuntu 24.04 LTS)
# Installs: 2GB swap, Docker, n8n + Caddy (automatic HTTPS via sslip.io)
set -eux

# --- swap (essential: e2-micro has only 1GB RAM) ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- docker ---
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# --- derive public hostname from the VM's external IP via sslip.io ---
IP=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
HOST="n8n.${IP}.sslip.io"

mkdir -p /opt/n8n && cd /opt/n8n

cat > Caddyfile <<EOF
${HOST} {
  reverse_proxy n8n:5678
}
EOF

cat > docker-compose.yml <<EOF
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: always
    environment:
      - N8N_HOST=${HOST}
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://${HOST}/
      - N8N_EDITOR_BASE_URL=https://${HOST}/
      - GENERIC_TIMEZONE=America/Santiago
      - TZ=America/Santiago
      - N8N_RUNNERS_ENABLED=true
      - N8N_DIAGNOSTICS_ENABLED=false
    volumes:
      - n8n_data:/home/node/.n8n

  caddy:
    image: caddy:2
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

volumes:
  n8n_data:
  caddy_data:
  caddy_config:
EOF

docker compose up -d
echo "n8n available at https://${HOST}" > /opt/n8n/URL.txt
