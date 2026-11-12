#!/usr/bin/env bash
# Imports an archive written by deploy/export-data.sh on another machine.
# Run on the new machine, from the repository root, after `sudo deploy/setup-vm.sh --no-start` and
# before the stack is started for the first time:
#
#   sudo deploy/import-data.sh <archive>
#
# deploy/.env takes the passwords and tokens from the archive, and keeps this machine's host names
# and certificate email. Start the stack afterwards with deploy/setup-vm.sh.
set -euo pipefail

ARCHIVE=$(realpath "${1:?usage: sudo deploy/import-data.sh <archive>}")
cd "$(dirname "$0")/.."
umask 077

PROJECT=infrahub-product-catalog
VOLUMES=(database_data storage_data workflow_db workflow_data git_data)
HOST_SETTINGS='^(SITE_HOST|INFRAHUB_HOST|INFRAHUB_PUBLIC_URL|ACME_EMAIL)='

if [ ! -f deploy/.env ]; then
  echo "deploy/.env is missing. Run: sudo deploy/setup-vm.sh --no-start <email>" >&2
  exit 1
fi
for volume in "${VOLUMES[@]}"; do
  if docker volume inspect "${PROJECT}_${volume}" >/dev/null 2>&1; then
    echo "The volume ${PROJECT}_${volume} already exists. This script only imports into a machine whose stack was never started." >&2
    exit 1
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar xf "$ARCHIVE" -C "$WORK"

for volume in "${VOLUMES[@]}"; do
  docker volume create \
    --label "com.docker.compose.project=${PROJECT}" \
    --label "com.docker.compose.volume=${volume}" \
    "${PROJECT}_${volume}" >/dev/null
  docker run --rm -v "${PROJECT}_${volume}:/data" -v "$WORK:/in:ro" alpine \
    tar xzf "/in/${volume}.tgz" -C /data
done

{
  grep -v -E "$HOST_SETTINGS" "$WORK/env"
  grep -E "$HOST_SETTINGS" deploy/.env
} > deploy/.env.new
mv deploy/.env.new deploy/.env

echo "Imported. Start the stack with: sudo deploy/setup-vm.sh <email>"
