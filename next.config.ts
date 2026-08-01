import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Queue client is server-only. Externalizing it avoids bundling BullMQ's
  // optional Valkey client into the Next web artifact.
  serverExternalPackages: ["better-sqlite3", "bullmq"],
};

export default nextConfig;
