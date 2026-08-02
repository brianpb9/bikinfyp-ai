import crypto from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { config } from "@/lib/config";

export async function POST(req: Request) {
  const body: { job_id?: unknown } = await req.json().catch(() => ({}));
  if (body.job_id !== "5cf57de0-0d88-46f7-9f93-c5ea5d32828d") return new NextResponse(null, { status: 404 });
  const expected = crypto.createHmac("sha256", config.authSecret).update(`staging-load-compensate:${body.job_id}`).digest("hex");
  if (req.headers.get("x-staging-load-compensate") !== expected) return new NextResponse(null, { status: 404 });
  const pool = new Pool({ connectionString: config.databaseUrl });
  let outputUrl: string | null = null; let duplicated = false;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const job = (await client.query<{ user_id:string; state:string; output_url:string | null }>("SELECT user_id,state,output_url FROM jobs WHERE id=$1 FOR UPDATE", [body.job_id])).rows[0];
      if (!job || job.state !== "READY") throw new Error("Job kompensasi tidak valid.");
      outputUrl = job.output_url;
      const prior = await client.query("SELECT id FROM audit_log WHERE action='job.load_test_compensation' AND entity_id=$1", [body.job_id]);
      if (prior.rowCount) duplicated = true;
      else {
        const now = new Date().toISOString();
        await client.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,5000,'bonus',$3,NULL,$4)", [crypto.randomUUID(),job.user_id,body.job_id,now]);
        await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,'system','job.load_test_compensation','jobs',$2,$3,$4)", [crypto.randomUUID(),body.job_id,JSON.stringify({ amount_idr:5000, reason:'authorized staging load-test compensation' }),now]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; } finally { client.release(); }
    if (outputUrl && config.r2Endpoint && config.r2Bucket && config.r2AccessKeyId && config.r2SecretAccessKey) {
      const r2 = new S3Client({ endpoint:config.r2Endpoint, region:config.r2Region, credentials:{accessKeyId:config.r2AccessKeyId,secretAccessKey:config.r2SecretAccessKey}, forcePathStyle:true });
      await r2.send(new DeleteObjectCommand({ Bucket:config.r2Bucket, Key:outputUrl }));
    }
    return NextResponse.json({ duplicated, compensated_idr:duplicated?0:5000, output_deleted:Boolean(outputUrl) });
  } finally { await pool.end(); }
}
