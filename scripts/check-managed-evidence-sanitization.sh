#!/bin/sh
set -eu

EVIDENCE_DIR=${1:?evidence directory is required}

if rg -n '/Users/|/private/tmp|\.render/|cli\.yaml|refreshtoken|10\.24\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$EVIDENCE_DIR"; then
  echo "forbidden local path, credential locator, private address, or email found" >&2
  exit 1
fi

for FILE in "$EVIDENCE_DIR"/*-deploys.json; do
  [ -e "$FILE" ] || continue
  [ "$(jq -r type "$FILE")" = "object" ] || {
    echo "deploy artifact is not allowlisted to one object: $FILE" >&2
    exit 1
  }
  jq -e 'keys - ["id","status","commit","createdAt","startedAt","finishedAt","trigger","updatedAt"] | length == 0' "$FILE" >/dev/null
done

echo "SANITIZATION_CHECK=PASS"
