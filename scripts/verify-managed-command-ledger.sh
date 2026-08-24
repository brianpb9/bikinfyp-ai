#!/bin/sh
set -eu

EVIDENCE_DIR=${1:?evidence directory is required}
LEDGER="$EVIDENCE_DIR/command-ledger.tsv"
STATUS=0
OLD_IFS=$IFS
IFS='
'
for ITEM in $(awk -F '\t' 'NR > 1 { print $5 "|" $6 }' "$LEDGER"); do
  ARTIFACT=${ITEM%%|*}
  EXPECTED=${ITEM#*|}
  FILE="$EVIDENCE_DIR/$ARTIFACT"
  if [ ! -f "$FILE" ]; then
    printf 'MISSING %s\n' "$ARTIFACT"
    STATUS=1
    continue
  fi
  ACTUAL=$(shasum -a 256 "$FILE" | awk '{print $1}')
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    printf 'MISMATCH %s expected=%s actual=%s\n' "$ARTIFACT" "$EXPECTED" "$ACTUAL"
    STATUS=1
  fi
done
IFS=$OLD_IFS
exit "$STATUS"
