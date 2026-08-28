#!/usr/bin/env bash
set -euo pipefail

image="${EVIDENCE_IMAGE:?EVIDENCE_IMAGE is required}"
expected_sha="${EXPECTED_APP_SHA:?EXPECTED_APP_SHA is required}"
artifact_dir="${EVIDENCE_RECEIPT_EXPORT_DIR:?EVIDENCE_RECEIPT_EXPORT_DIR is required}"
env_file="${EVIDENCE_ENV_FILE:-}"
inherit_staging_env="${EVIDENCE_INHERIT_STAGING_ENV:-0}"

# Local/manual operation may continue to use a protected env file. Managed CI
# injects the same allowlisted slots directly from its staging environment so
# secret values are never serialized into a workspace or artifact file.
docker_env_args=()
if test -n "$env_file" && test "$inherit_staging_env" = 1; then
  printf '%s\n' "choose EVIDENCE_ENV_FILE or EVIDENCE_INHERIT_STAGING_ENV=1, not both" >&2
  exit 2
elif test -n "$env_file"; then
  test -f "$env_file"
  docker_env_args+=(--env-file "$env_file")
elif test "$inherit_staging_env" = 1; then
  required_staging_slots=(
    BASE DATABASE_URL AUTH_SECRET STORAGE_MODE R2_ENDPOINT R2_BUCKET
    R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_REGION RACUN_DEPLOY_ENV
    RACUN_DB_RUNTIME
  )
  for slot in "${required_staging_slots[@]}"; do
    test -n "${!slot:-}" || { printf 'required managed staging slot absent: %s\n' "$slot" >&2; exit 2; }
    docker_env_args+=(--env "$slot")
  done
  test "$BASE" = "https://racun-ai-staging-web.onrender.com"
  test "$RACUN_DEPLOY_ENV" = staging
  test "$RACUN_DB_RUNTIME" = postgres
  test "$STORAGE_MODE" = r2
else
  printf '%s\n' "EVIDENCE_ENV_FILE or EVIDENCE_INHERIT_STAGING_ENV=1 is required" >&2
  exit 2
fi
case "$artifact_dir" in
  /*) ;;
  *) printf '%s\n' "EVIDENCE_RECEIPT_EXPORT_DIR must be absolute" >&2; exit 2 ;;
esac
test "$artifact_dir" != "/"
mkdir -p "$artifact_dir"
chmod 0700 "$artifact_dir"

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
  original_status=$?
  final_status=$original_status
  if test -n "$container_id"; then
    export_stage="$(mktemp -d "$artifact_dir/.mobile-evidence-export.XXXXXX")"
    export_final="$artifact_dir/$container_id"
    export_ok=true
    if ! docker cp "$container_id:/srv/receipts/." "$export_stage/"; then
      export_ok=false
    fi
    if test -f "$launch_dir/attestation.json" && ! cp "$launch_dir/attestation.json" "$export_stage/launch-attestation.json"; then
      export_ok=false
    fi
    if test "$export_ok" = true && ! node -e 'const fs=require("fs");const [target,sha,containerId,imageId]=process.argv.slice(1);const receipt=JSON.parse(fs.readFileSync(target,"utf8"));const launch=receipt?.evidence_runner?.launch;if(receipt.exact_sha!==sha||launch?.container_id!==containerId||launch?.image_id!==imageId||launch?.config_image!==imageId)process.exit(1)' \
      "$export_stage/receipt.json" "$expected_sha" "$container_id" "$image_id"; then
      export_ok=false
    fi
    if test "$export_ok" = true && { test -e "$export_final" || ! mv "$export_stage" "$export_final"; }; then
      export_ok=false
    fi
    if test "$export_ok" = true; then
      if ! docker rm -f "$container_id" >/dev/null; then final_status=1; fi
    else
      printf '%s\n' "Evidence export failed; retained container $container_id for recovery." >&2
      printf '%s\n' "Unverified staging export retained at $export_stage" >&2
      printf '%s\n' "Recover with: docker cp $container_id:/srv/receipts/. $export_stage/" >&2
      final_status=1
    fi
  fi
  chmod 0700 "$launch_dir" >/dev/null 2>&1 || true
  rm -rf "$launch_dir"
  trap - EXIT
  exit "$final_status"
}
trap cleanup EXIT

container_id="$(docker create --name "$container_name" \
  "${docker_env_args[@]}" \
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
chmod 0444 "$launch_dir/attestation.json"
chmod 0555 "$launch_dir"

docker start --attach "$container_id"
