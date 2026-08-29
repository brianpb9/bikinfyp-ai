import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeDurationSec, probeHasAudioStream, probeHasVideoStream, runFfmpeg, volumeDetect } from "./ffmpeg";
import type { QcResult } from "./qc";

export const NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR = "bikinfyp.normal-evidence.offline-media-receipt";
export const NORMAL_EVIDENCE_OFFLINE_QC_VERSION = "1.0.0";
const SAMPLE_FRACTIONS = [0.05, 0.125, 0.2, 0.275, 0.35, 0.425, 0.5, 0.575, 0.65, 0.725, 0.8, 0.875, 0.95] as const;

export interface NormalEvidenceOfflineQcReceipt extends QcResult {
  evaluator: { identity: typeof NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR; version: typeof NORMAL_EVIDENCE_OFFLINE_QC_VERSION; network: "forbidden" };
  disposition: "INDEPENDENT_REVIEW_REQUIRED";
  artifact_sha256: string;
  frame_findings: Array<{ sample_index: number; timestamp_sec: number; sha256: string; bytes: number; local_extraction: true }>;
  audio_finding: { stream_present: boolean; mean_db: number | null; max_db: number | null; local_probe: true };
}

export function assertNormalEvidenceReceiptMatchesArtifact(
  receipt: NormalEvidenceOfflineQcReceipt,
  artifactSha256: string,
): void {
  if (!/^[0-9a-f]{64}$/.test(artifactSha256) || receipt.artifact_sha256 !== artifactSha256) {
    throw new Error("NORMAL_EVIDENCE_QC_ARTIFACT_DIGEST_MISMATCH");
  }
  if (receipt.evaluator?.identity !== NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR
      || receipt.evaluator?.version !== NORMAL_EVIDENCE_OFFLINE_QC_VERSION
      || receipt.evaluator?.network !== "forbidden"
      || receipt.disposition !== "INDEPENDENT_REVIEW_REQUIRED"
      || receipt.passed !== false) {
    throw new Error("NORMAL_EVIDENCE_QC_RECEIPT_CONTRACT_INVALID");
  }
}

/** Evidence collection, not an acceptance verdict. It performs only local
 * ffprobe/ffmpeg operations and deliberately cannot claim brand or anti-slop
 * PASS; those judgments belong to the independent row Reviewer. */
export async function runNormalEvidenceOfflineQc(filePath: string): Promise<NormalEvidenceOfflineQcReceipt> {
  if (!fs.existsSync(filePath)) throw new Error("NORMAL_EVIDENCE_OFFLINE_QC_ARTIFACT_MISSING");
  const artifact = fs.readFileSync(filePath);
  const duration = await probeDurationSec(filePath);
  const hasVideo = await probeHasVideoStream(filePath);
  const hasAudio = await probeHasAudioStream(filePath);
  if (!Number.isFinite(duration) || duration <= 0 || !hasVideo) throw new Error("NORMAL_EVIDENCE_OFFLINE_QC_INVALID_VIDEO");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normal-evidence-offline-qc-"));
  try {
    const frameFindings: NormalEvidenceOfflineQcReceipt["frame_findings"] = [];
    for (let index = 0; index < SAMPLE_FRACTIONS.length; index++) {
      const timestamp = Math.round(duration * SAMPLE_FRACTIONS[index] * 1000) / 1000;
      const framePath = path.join(dir, `frame-${String(index).padStart(2, "0")}.jpg`);
      await runFfmpeg(["-y", "-v", "error", "-ss", String(timestamp), "-i", filePath, "-frames:v", "1", "-q:v", "3", framePath]);
      const bytes = fs.readFileSync(framePath);
      frameFindings.push({ sample_index: index, timestamp_sec: timestamp,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, local_extraction: true });
    }
    const volume = hasAudio ? await volumeDetect(filePath) : null;
    return {
      passed: false,
      checked_at: new Date().toISOString(),
      evaluator: { identity: NORMAL_EVIDENCE_OFFLINE_QC_EVALUATOR, version: NORMAL_EVIDENCE_OFFLINE_QC_VERSION, network: "forbidden" },
      disposition: "INDEPENDENT_REVIEW_REQUIRED",
      artifact_sha256: crypto.createHash("sha256").update(artifact).digest("hex"),
      frame_findings: frameFindings,
      audio_finding: { stream_present: hasAudio, mean_db: volume?.meanDb ?? null, max_db: volume?.maxDb ?? null, local_probe: true },
      checks: [
        { code: "EVIDENCE-MEDIA", name: "Offline media integrity receipt", status: hasAudio && frameFindings.length === SAMPLE_FRACTIONS.length ? "pass" : "fail",
          detail: `video=true audio=${hasAudio} duration=${duration.toFixed(3)}s frames=${frameFindings.length}` },
        { code: "EVIDENCE-BRAND", name: "Brand fidelity", status: "skip", detail: "INDEPENDENT_REVIEW_REQUIRED; offline receipt makes no Brand PASS claim" },
        { code: "EVIDENCE-ANTI-SLOP", name: "Visual anti-slop", status: "skip", detail: "INDEPENDENT_REVIEW_REQUIRED; offline receipt makes no Anti-slop PASS claim" },
        { code: "EVIDENCE-AUDIO-CONTENT", name: "Spoken-content fidelity", status: "skip", detail: "INDEPENDENT_REVIEW_REQUIRED; no external transcription permitted" },
      ],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
