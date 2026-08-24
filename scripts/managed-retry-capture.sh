#!/bin/sh
set -u

if [ "$#" -lt 2 ]; then
  echo "usage: managed-retry-capture.sh <artifact-name> <command> [args...]" >&2
  exit 64
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EVIDENCE="$ROOT/docs/evidence/P0-03/managed-classifier-retry-20260824"
ARTIFACT=$1
shift
OUT="$EVIDENCE/$ARTIFACT"
LEDGER="$EVIDENCE/command-ledger.tsv"

case "$ARTIFACT" in
  *[!A-Za-z0-9._-]*|"") echo "invalid artifact name" >&2; exit 64 ;;
esac

START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
INVOCATION=""
for ARG in "$@"; do
  case "$ARG" in
    *[!A-Za-z0-9_./:=,@%+-]*) SAFE="'<REDACTED_COMPLEX_ARG>'" ;;
    *) SAFE=$ARG ;;
  esac
  INVOCATION="${INVOCATION}${INVOCATION:+ }$SAFE"
done

"$@" >"$OUT" 2>&1
STATUS=$?
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HASH=$(shasum -a 256 "$OUT" | awk '{print $1}')
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$START" "$END" "$STATUS" "$INVOCATION" "$ARTIFACT" "$HASH" >>"$LEDGER"
printf 'START=%s END=%s EXIT=%s ARTIFACT=%s SHA256=%s\n' "$START" "$END" "$STATUS" "$ARTIFACT" "$HASH"
exit "$STATUS"
