/**
 * Private media storage. Object keys are always relative POSIX paths; access
 * remains through /api/files after its HMAC check, never through public R2 URLs.
 */
import fs from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config";

export type StoredObject = { body: Buffer; size: number; contentType?: string };

export interface MediaStorage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<StoredObject | null>;
  stat(key: string): Promise<{ size: number; contentType?: string } | null>;
  /** Local staging path for FFmpeg/providers. It is a cache, not primary storage. */
  materialize(key: string): Promise<string | null>;
}

function safeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid storage object key");
  }
  return normalized;
}

function localPath(key: string): string {
  const safe = safeKey(key);
  const abs = path.resolve(config.storageDir, safe);
  if (!abs.startsWith(config.storageDir + path.sep)) throw new Error("Invalid storage object key");
  return abs;
}

class FilesystemStorage implements MediaStorage {
  async put(key: string, body: Buffer): Promise<void> {
    const target = localPath(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, body);
  }

  async get(key: string, range?: { start: number; end: number }): Promise<StoredObject | null> {
    const target = localPath(key);
    try {
      const stat = await fs.promises.stat(target);
      if (!stat.isFile()) return null;
      const full = await fs.promises.readFile(target);
      const body = range ? full.subarray(range.start, range.end + 1) : full;
      return { body, size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const value = await fs.promises.stat(localPath(key));
      return value.isFile() ? { size: value.size } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async materialize(key: string): Promise<string | null> {
    const target = localPath(key);
    try { return (await fs.promises.stat(target)).isFile() ? target : null; } catch { return null; }
  }
}

function r2ConfigError(): Error {
  return new Error("STORAGE_MODE=r2 requires R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY");
}

class R2Storage implements MediaStorage {
  private client: S3Client;
  constructor() {
    if (!config.r2Endpoint || !config.r2Bucket || !config.r2AccessKeyId || !config.r2SecretAccessKey) throw r2ConfigError();
    this.client = new S3Client({
      endpoint: config.r2Endpoint,
      region: config.r2Region,
      credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
      forcePathStyle: true,
    });
  }
  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: config.r2Bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }
  async get(key: string, range?: { start: number; end: number }): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: config.r2Bucket, Key: safeKey(key), Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }));
      if (!response.Body) return null;
      return { body: Buffer.from(await response.Body.transformToByteArray()), size: Number(response.ContentLength ?? 0), contentType: response.ContentType };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  async stat(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: safeKey(key) }));
      return { size: Number(response.ContentLength ?? 0), contentType: response.ContentType };
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  async materialize(key: string): Promise<string | null> {
    const object = await this.get(key);
    if (!object) return null;
    const target = path.join(config.storageDir, ".object-cache", safeKey(key));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, object.body);
    return target;
  }
}

let override: MediaStorage | undefined;
let instance: MediaStorage | undefined;

/** Lazy construction makes configuration fail closed before any media I/O. */
export function mediaStorage(): MediaStorage {
  if (override) return override;
  assertStorageConfiguration();
  if (!instance) {
    if (config.storageMode === "filesystem") instance = new FilesystemStorage();
    else if (config.storageMode === "r2") instance = new R2Storage();
    else throw new Error("STORAGE_MODE must be filesystem or r2");
  }
  return instance;
}

/** Test seam: avoids network and proves the storage contract with an in-memory fake. */
export function setMediaStorageForTests(storage?: MediaStorage): void {
  override = storage;
  instance = undefined;
}

export function assertStorageConfiguration(): void {
  if (config.storageMode !== "filesystem" && config.storageMode !== "r2") throw new Error("STORAGE_MODE must be filesystem or r2");
  if (config.storageMode === "r2" && (!config.r2Endpoint || !config.r2Bucket || !config.r2AccessKeyId || !config.r2SecretAccessKey)) throw r2ConfigError();
  if (process.env.NODE_ENV === "production" && config.storageMode === "filesystem") {
    throw new Error("Production requires STORAGE_MODE=r2; filesystem storage is rollback/local only");
  }
}
