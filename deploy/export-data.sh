#!/usr/bin/env bash
# Exports the catalog's data so that another machine can take over the deployment: Infrahub's
# database, file storage, task history and repository copy, plus deploy/.env, whose passwords and
# tokens match the data.
# Run on the old machine, from the repository root:
#
#   sudo deploy/export-data.sh <archive, for example /tmp/catalog-data.tar>
#
# The stack stays stopped afterwards, so that no submission arrives after the export. The archive
# holds the secrets of deploy/.env and is readable only by root.
set -euo pipefail

ARCHIVE=$(realpath -m "${1:?usage: sudo deploy/export-data.sh <archive, for example /tmp/catalog-data.tar>}")
cd "$(dirname "$0")/.."
umask 077

PROJECT=infrahub-product-catalog
VOLUMES=(database_data storage_data workflow_db workflow_data git_data)

docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env stop

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
for volume in "${VOLUMES[@]}"; do
  docker run --rm -v "${PROJECT}_${volume}:/data:ro" -v "$WORK:/out" alpine \
    tar czf "/out/${volume}.tgz" -C /data .
done
cp deploy/.env "$WORK/env"
tar cf "$ARCHIVE" -C "$WORK" .

echo "Wrote $ARCHIVE. The stack is stopped."
