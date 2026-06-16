#!/usr/bin/env bash
#
# Deletes ALL collections from the database EXCEPT `quotations` and `counters`.
# Takes a full mongodump backup first. This is IRREVERSIBLE without the backup.
#
# Usage:
#   MONGO_URI="<prod-uri>" MONGO_DB_NAME="<prod-db>" ./wipe_except_quotations.sh
#
set -euo pipefail

: "${MONGO_URI:?Set MONGO_URI to the production connection string}"
: "${MONGO_DB_NAME:?Set MONGO_DB_NAME to the production database name}"

# Collections to KEEP. Everything else in the DB is dropped.
KEEP=("quotations" "counters")

# Collections to DROP (explicit allowlist — safer than "drop everything not kept",
# so a newly-added collection is never silently wiped without you knowing).
DROP=(
  attendance clients employees furniture_designs inquiries
  inventory_items inventory_movements inventory_stock_lots
  log_categories log_entries log_items log_types
  pricing_rules products projects vendors
)

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="./backup-${MONGO_DB_NAME}-${STAMP}"

echo "Database : ${MONGO_DB_NAME}"
echo "Keeping  : ${KEEP[*]}"
echo "Dropping : ${DROP[*]}"
echo "Backup   : ${BACKUP_DIR}"
echo
read -r -p "Type the database name '${MONGO_DB_NAME}' to confirm: " CONFIRM
if [ "$CONFIRM" != "$MONGO_DB_NAME" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Taking full backup..."
mongodump --uri="$MONGO_URI" --db="$MONGO_DB_NAME" --out="$BACKUP_DIR"
echo "    Backup written to ${BACKUP_DIR}"

echo "==> Dropping collections..."
for c in "${DROP[@]}"; do
  echo "    - dropping ${c}"
  mongosh "$MONGO_URI" --quiet --eval "db.getSiblingDB('${MONGO_DB_NAME}').getCollection('${c}').drop()"
done

echo
echo "Done. Restore with: mongorestore --uri=\"\$MONGO_URI\" \"${BACKUP_DIR}/${MONGO_DB_NAME}\""
