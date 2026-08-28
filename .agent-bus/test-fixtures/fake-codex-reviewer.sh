#!/bin/sh
# Deterministic fake for test-reviewer-runtime.sh. It implements only the
# `codex exec ... -o <result> -` surface used by the persistent reviewer.
set -u

result=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    result=$1
  fi
  shift
done
[ -n "$result" ] || exit 2

prompt=$(cat)
sha=$(printf '%s\n' "$prompt" | sed -n 's/^Review exactly commit \([0-9a-f][0-9a-f]*\) for task .*$/\1/p' | sed -n '1p')
task=$(printf '%s\n' "$prompt" | sed -n 's/^Review exactly commit [0-9a-f][0-9a-f]* for task \(.*\)\. The bus message is:$/\1/p' | sed -n '1p')

case "$task" in
  *HANG*) sleep 60; exit 1 ;;
esac

printf '{"verdict":"PASS","sha":"%s","task":"%s","body":"fake reviewer accepted exact test SHA","findings":[]}\n' \
  "$sha" "$task" > "$result"
