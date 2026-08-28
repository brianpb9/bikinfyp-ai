#!/usr/bin/env bash
set -euo pipefail

image="${EVIDENCE_IMAGE:?EVIDENCE_IMAGE is required}"
expected_sha="${EXPECTED_APP_SHA:?EXPECTED_APP_SHA is required}"
env_file="${EVIDENCE_ENV_FILE:?EVIDENCE_ENV_FILE is required}"
test -f "$env_file"

image_id="$(docker image inspect --format '{{.Id}}' "$image")"
source_sha="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")"
source_tree="$(docker image inspect --format '{{index .Config.Labels "ai.hdrv.source.tree"}}' "$image_id")"
printf '%s\n' "$image_id" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf '%s\n' "$source_tree" | grep -Eq '^[0-9a-f]{40}$'
test "$source_sha" = "$expected_sha"

launch_dir="$(mktemp -d)"
container_name="mobile-evidence-${expected_sha:0:12}-$$"
container_id=""
cleanup(){
  if test -n "$container_id";then docker rm -f "$container_id" >/dev/null 2>&1 || true;fi
  rm -rf "$launch_dir"
}
trap cleanup EXIT

container_id="$(docker create --name "$container_name" \
  --env-file "$env_file" \
  --env "EXPECTED_APP_SHA=$expected_sha" \
  --env "EVIDENCE_IMAGE_DIGEST=$image_id" \
  --env "EVIDENCE_LAUNCH_ATTESTATION_PATH=/run/evidence-launch/attestation.json" \
  --mount "type=bind,src=$launch_dir,dst=/run/evidence-launch,readonly" \
  "$image_id")"
printf '%s\n' "$container_id" | grep -Eq '^[0-9a-f]{64}$'
inspected_image="$(docker container inspect --format '{{.Image}}' "$container_id")"
config_image="$(docker container inspect --format '{{.Config.Image}}' "$container_id")"
test "$inspected_image" = "$image_id"
test "$config_image" = "$image_id"

node -e 'const fs=require("fs");const [target,containerId,imageId,configImage,sourceSha,sourceTree]=process.argv.slice(1);fs.writeFileSync(target,JSON.stringify({schema:"mobile-evidence-launch/v1",container_id:containerId,image_id:imageId,config_image:configImage,source_sha:sourceSha,source_tree:sourceTree,inspected_at:new Date().toISOString()})+"\n",{mode:0o444})' \
  "$launch_dir/attestation.json" "$container_id" "$image_id" "$config_image" "$source_sha" "$source_tree"

docker start --attach "$container_id"
