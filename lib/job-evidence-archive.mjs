import fs from "node:fs";
import path from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

/**
 * Build the filesystem reader used by the independent verifier. Both the
 * declared key and the OS-resolved target must remain under this exact job's
 * evidence directory. realpathSync closes symlink escapes as well as encoded
 * or ordinary dot-segment traversal.
 */
export function createJobEvidenceArchiveReader(archiveRoot, jobId) {
  if (typeof archiveRoot !== "string" || archiveRoot.trim() === "") throw new Error("JOB_ARCHIVE_ROOT_MISSING");
  if (typeof jobId !== "string" || !SAFE_ID.test(jobId)) throw new Error("JOB_ARCHIVE_JOB_ID_INVALID");
  const root = fs.realpathSync(archiveRoot);
  const jobDirectory = fs.realpathSync(path.join(root, "jobs", jobId, "evidence"));
  if (!contained(root, jobDirectory)) throw new Error("JOB_ARCHIVE_DIRECTORY_ESCAPES_ROOT");
  const prefix = `jobs/${jobId}/evidence/`;

  return (storageKey) => {
    if (typeof storageKey !== "string" || !storageKey.startsWith(prefix)) throw new Error("JOB_ARCHIVE_KEY_INVALID");
    let decoded;
    try { decoded = decodeURIComponent(storageKey); } catch { throw new Error("JOB_ARCHIVE_KEY_ENCODING_INVALID"); }
    // Canonical keys are literal ASCII path segments. Reject alternate URL
    // spellings (#, ?, percent encoding, backslashes) rather than normalizing
    // two attacker-controlled names onto one archive object.
    if (decoded !== storageKey || /[\\#?\0]/.test(decoded)) throw new Error("JOB_ARCHIVE_KEY_NOT_CANONICAL");
    const suffix = decoded.slice(prefix.length);
    const segments = suffix.split("/");
    if (segments.length === 0 || segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
      throw new Error("JOB_ARCHIVE_KEY_INVALID");
    }
    const candidate = path.resolve(jobDirectory, ...segments);
    if (!contained(jobDirectory, candidate)) throw new Error("JOB_ARCHIVE_KEY_ESCAPES_JOB");
    const resolved = fs.realpathSync(candidate);
    if (!contained(jobDirectory, resolved)) throw new Error("JOB_ARCHIVE_SYMLINK_ESCAPES_JOB");
    return fs.readFileSync(resolved);
  };
}
