#!/usr/bin/env bash
# Prepares a Debian 12 virtual machine for the beta deployment, then starts the stack.
# Run on the machine, from the repository root:
#
#   sudo deploy/setup-vm.sh [--no-start] <email for HTTPS certificates>
#
# --no-start installs Docker and writes deploy/.env without starting the stack, so that the data of
# another machine can be imported first (deploy/import-data.sh).
# Running it again keeps deploy/.env and the beta password, and only rebuilds and restarts.
set -euo pipefail

START=1
if [ "${1:-}" = "--no-start" ]; then
  START=0
  shift
fi
ACME_EMAIL="${1:?usage: sudo deploy/setup-vm.sh [--no-start] <email for HTTPS certificates>}"
cd "$(dirname "$0")/.."

# Docker from Docker's own Debian repository.
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Host names built from the machine's public IPv4 address, for example 51-1-2-3.sslip.io.
IP=$(curl -4 -fsS https://api.ipify.org)
SITE_HOST="${IP//./-}.sslip.io"

secret() { openssl rand -hex 24; }
uuid() { cat /proc/sys/kernel/random/uuid; }

# New Infrahub passwords, tokens and secret key, instead of the published defaults.
if [ ! -f deploy/.env ]; then
  umask 077
  cat > deploy/.env <<ENV
SITE_HOST=${SITE_HOST}
INFRAHUB_HOST=infrahub.${SITE_HOST}
ACME_EMAIL=${ACME_EMAIL}
INFRAHUB_PUBLIC_URL=https://infrahub.${SITE_HOST}
INFRAHUB_ALLOW_ANONYMOUS_ACCESS=false
INFRAHUB_INITIAL_ADMIN_PASSWORD=$(secret)
INFRAHUB_INITIAL_ADMIN_TOKEN=$(uuid)
INFRAHUB_INITIAL_AGENT_TOKEN=$(uuid)
INFRAHUB_SECURITY_SECRET_KEY=$(secret)
INFRAHUB_DB_PASSWORD=$(secret)
INFRAHUB_BROKER_PASSWORD=$(secret)
INFRAHUB_TASKMANAGER_DB_PASSWORD=$(secret)
# Set after the service account is created (deploy/README.md, step 5).
CATALOG_API_TOKEN=
ENV
fi

if [ "$START" = 0 ]; then
  echo "Docker is installed and deploy/.env is written. The stack is not started."
  exit 0
fi

docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env up -d --build

echo
echo "Web app:   https://${SITE_HOST}"
echo "Infrahub:  https://infrahub.${SITE_HOST}  (user admin, password INFRAHUB_INITIAL_ADMIN_PASSWORD in deploy/.env)"
