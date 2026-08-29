#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  allowListIsExact, exactRunnerAllowList, parsePublicIPv4, postgresShape, renderRequest,
  replaceAllowList, STAGING_POSTGRES_ID, validateTarget, waitForAllowList,
} from "./managed-staging-db-tls-window.mjs";

function required(name, value) {
  if (typeof value !== "string" || !value || /[\r\n]/.test(value)) throw new Error(`missing ${name}`);
  return value;
}

const defaultDeps = {
  async readPostgres(id, token) { return postgresShape(await renderRequest(id, token)); },
  replaceAllowList,
  waitForAllowList,
};

export async function closeOwnedWindow(env = process.env, deps = defaultDeps) {
  const receipt = {
    target_verified: false, ownership_verified: false, cleanup_patch_empty: false,
    cleanup_skipped_already_empty: false, cleanup_readback_empty: false,
    foreign_allow_list_preserved: false, secret_values_exposed: false,
    ip_value_exposed: false, production_access_attempted: false
  };
  try {
    const postgresId = validateTarget(required("STAGING_RENDER_POSTGRES_ID", env.STAGING_RENDER_POSTGRES_ID));
    receipt.target_verified = true;
    const marker = JSON.parse(fs.readFileSync(required("WINDOW_OWNER_MARKER_PATH", env.WINDOW_OWNER_MARKER_PATH), "utf8"));
    const markerIp = parsePublicIPv4(required("marker.cidr_block", marker?.cidr_block).replace(/\/32$/, ""));
    const ownedList = exactRunnerAllowList(markerIp);
    if (marker?.schema !== "normal-metadata-window-owner/v1" || marker?.postgres_id !== postgresId ||
        marker.cidr_block !== ownedList[0].cidrBlock) throw new Error("WINDOW_OWNER_MARKER_INVALID");
    receipt.ownership_verified = true;
    const token = required("STAGING_RENDER_API_KEY", env.STAGING_RENDER_API_KEY);
    const current = postgresShape(await deps.readPostgres(postgresId, token));
    if (allowListIsExact(current.ipAllowList, [])) {
      receipt.cleanup_skipped_already_empty = true;
      receipt.cleanup_readback_empty = true;
      return receipt;
    }
    if (!allowListIsExact(current.ipAllowList, ownedList)) {
      receipt.foreign_allow_list_preserved = true;
      throw new Error("FOREIGN_ALLOW_LIST_PRESERVED");
    }
    await deps.replaceAllowList(STAGING_POSTGRES_ID, token, []);
    receipt.cleanup_patch_empty = true;
    await deps.waitForAllowList(STAGING_POSTGRES_ID, token, []);
    receipt.cleanup_readback_empty = true;
    return receipt;
  } finally {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  closeOwnedWindow().catch(() => { process.exitCode = 1; });
}
