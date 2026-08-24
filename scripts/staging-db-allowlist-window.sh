#!/bin/sh
set -eu

DB_ID=${STAGING_DATABASE_ID:?STAGING_DATABASE_ID is required}

case "${1:-}" in
  add)
    CIDR=${OPERATOR_CIDR:?OPERATOR_CIDR is required for add}
    DESCRIPTION=${ALLOWLIST_DESCRIPTION:-bounded-operator-window}
    exec render postgres update "$DB_ID" --ip-allow-list "cidr=$CIDR,description=$DESCRIPTION" --confirm --output json
    ;;
  clear)
    exec render postgres update "$DB_ID" --clear-ip-allow-list --confirm --output json
    ;;
  *)
    echo "usage: staging-db-allowlist-window.sh <add|clear>" >&2
    exit 64
    ;;
esac
