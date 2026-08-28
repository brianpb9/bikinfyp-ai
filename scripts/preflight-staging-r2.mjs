import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const EXPECTED_STAGING_BUCKET_SHA256 = "ac1b68a6d928588ad7ad9ea149e47c1cda07c3257e849a9b5e083b58740ea4ca";
const EXPECTED_STAGING_ENDPOINT_SHA256 = "977ce90e2cc94eb82bb175a6f1d1ffeee36569402eb6dd07eb5d4d8e2ba1e477";

const digest = (value) => createHash("sha256").update(value).digest("hex");

const missingObject = (error) =>
  error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";

async function readBody(body) {
  if (typeof body?.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body ?? []) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function confirmsAbsent(send, bucket, key) {
  try {
    await send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return false;
  } catch (error) {
    return missingObject(error);
  }
}

/** @param {any} [options] */
export async function runStagingR2Preflight(options = {}) {
  const {
    env = process.env,
    send: injectedSend,
    makeBytes = () => randomBytes(96),
    makeUuid = () => randomUUID(),
    expectedBucketSha256 = EXPECTED_STAGING_BUCKET_SHA256,
    expectedEndpointSha256 = EXPECTED_STAGING_ENDPOINT_SHA256,
  } = options;
  const result = {
    staging_context_verified: false,
    put_verified: false,
    get_hash_verified: false,
    delete_verified: false,
    absent_verified: false,
    cleanup_delete_verified: false,
    cleanup_absent_verified: false,
    secret_values_exposed: false,
    identifier_values_exposed: false,
    production_access_attempted: false,
  };

  let send;
  let client;
  let bucket;
  let key;
  try {
    const required = ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_REGION"];
    if (required.some((slot) => !env[slot])) return result;
    if (env.RACUN_DEPLOY_ENV !== "staging" || env.STORAGE_MODE !== "r2") return result;

    const endpointOrigin = new URL(env.R2_ENDPOINT).origin;
    if (digest(env.R2_BUCKET) !== expectedBucketSha256) return result;
    if (digest(endpointOrigin) !== expectedEndpointSha256) return result;
    result.staging_context_verified = true;

    bucket = env.R2_BUCKET;
    key = `staging-only/preflight/${makeUuid()}`;
    const payload = Buffer.from(makeBytes());
    const expectedHash = digest(payload);
    client = injectedSend
      ? undefined
      : new S3Client({
          region: env.R2_REGION,
          endpoint: endpointOrigin,
          forcePathStyle: true,
          maxAttempts: 2,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          },
        });
    send = injectedSend ?? ((command) => client.send(command));

    await send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: "application/octet-stream" }));
    result.put_verified = true;

    const fetched = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    result.get_hash_verified = digest(await readBody(fetched.Body)) === expectedHash;
    if (!result.get_hash_verified) return result;

    await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    result.delete_verified = true;
    result.absent_verified = await confirmsAbsent(send, bucket, key);
    return result;
  } catch {
    return result;
  } finally {
    if (result.staging_context_verified && send && bucket && key) {
      try {
        await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        result.cleanup_delete_verified = true;
      } catch {
        result.cleanup_delete_verified = false;
      }
      result.cleanup_absent_verified = await confirmsAbsent(send, bucket, key);
    }
    client?.destroy();
  }
}

function passed(result) {
  return result.staging_context_verified && result.put_verified && result.get_hash_verified &&
    result.delete_verified && result.absent_verified && result.cleanup_delete_verified &&
    result.cleanup_absent_verified && !result.secret_values_exposed &&
    !result.identifier_values_exposed && !result.production_access_attempted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runStagingR2Preflight();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!passed(result)) process.exitCode = 1;
}
