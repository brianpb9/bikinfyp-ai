type QueryResult<Row = Record<string, unknown>> = { rows: Row[]; rowCount: number | null };
export type CorrelationQueryable = {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
};

type PromptArchiveRow = { spec_json: string };
type ProviderRequestRow = {
  job_id: string;
  shot_index: number;
  provider: string;
  task_id: string;
  created_at: string;
};

function expectedShotIndices(specJson: string): number[] {
  const spec = JSON.parse(specJson) as { shots?: Array<{ idx?: unknown }> };
  if (!Array.isArray(spec.shots) || spec.shots.length === 0) throw new Error("PROMPT_SHOTS_MISSING");
  const indices = spec.shots.map((shot) => {
    if (!Number.isInteger(shot?.idx)) throw new Error("PROMPT_SHOT_INVALID");
    return shot.idx as number;
  });
  if (new Set(indices).size !== indices.length) throw new Error("PROMPT_SHOT_INDEX_DUPLICATE");
  return indices;
}

/**
 * Copies terminal provider request IDs into the durable prompt archive.
 * Returns false, without deleting anything, when there is no complete archive
 * to update. Query errors propagate so the caller can retain provider_tasks.
 */
export async function freezeProviderRequestCorrelation(
  db: CorrelationQueryable,
  jobId: string,
): Promise<boolean> {
  const archive = await db.query<PromptArchiveRow>(
    "SELECT spec_json FROM job_prompts WHERE job_id=$1",
    [jobId],
  );
  if (archive.rowCount !== 1 || !archive.rows[0]) return false;

  const requests = await db.query<ProviderRequestRow>(
    "SELECT job_id,shot_index,provider,task_id,created_at FROM provider_tasks WHERE job_id=$1 ORDER BY shot_index,provider",
    [jobId],
  );
  const expected = expectedShotIndices(archive.rows[0].spec_json);
  const actual = requests.rows.map((request) => request.shot_index);
  if (requests.rowCount !== expected.length
    || new Set(actual).size !== actual.length
    || expected.some((idx) => !actual.includes(idx))) {
    return false;
  }

  const updated = await db.query(
    `UPDATE job_prompts
        SET model_params = (model_params::jsonb || $2::jsonb)::text
      WHERE job_id = $1
      RETURNING job_id`,
    [jobId, JSON.stringify({ provider_requests: requests.rows })],
  );
  return updated.rowCount === 1;
}

