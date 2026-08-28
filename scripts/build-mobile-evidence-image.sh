#!/usr/bin/env bash
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
cd "$repo"
sha="$(git rev-parse HEAD)"
tree="$(git rev-parse 'HEAD^{tree}')"
expected="${EXPECTED_APP_SHA:-$sha}"
tag="${EVIDENCE_IMAGE_TAG:-racun-mobile-evidence:$sha}"

test "$sha" = "$expected"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
git archive --format=tar HEAD > "$build_dir/source.tar"
git bundle create "$build_dir/source.bundle" HEAD
tar -xf "$build_dir/source.tar" -C "$build_dir" Dockerfile.mobile-evidence

docker build --pull \
  --build-arg "EVIDENCE_SOURCE_SHA=$sha" \
  --build-arg "EVIDENCE_SOURCE_TREE=$tree" \
  --tag "$tag" \
  --file "$build_dir/Dockerfile.mobile-evidence" \
  "$build_dir"

image_digest="$(docker image inspect --format '{{.Id}}' "$tag")"
if ! printf '%s\n' "$image_digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "invalid immutable image digest" >&2
  exit 1
fi
if test -n "${EVIDENCE_BUILD_OUTPUT_FILE:-}"; then
  printf 'EVIDENCE_IMAGE=%s\nEVIDENCE_IMAGE_DIGEST=%s\nEVIDENCE_SOURCE_SHA=%s\nEVIDENCE_SOURCE_TREE=%s\n' \
    "$tag" "$image_digest" "$sha" "$tree" >> "$EVIDENCE_BUILD_OUTPUT_FILE"
else
  printf 'EVIDENCE_IMAGE=%s\nEVIDENCE_IMAGE_DIGEST=%s\nEVIDENCE_SOURCE_SHA=%s\nEVIDENCE_SOURCE_TREE=%s\n' \
    "$tag" "$image_digest" "$sha" "$tree"
fi
