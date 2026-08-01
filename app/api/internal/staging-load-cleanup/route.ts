import { Pool } from "pg";
import { config } from "@/lib/config";
import { getRedisJobQueue, closeRedisJobQueue } from "@/lib/job-queue";
import { PgJobsRepository } from "@/lib/postgres/jobs";
export const runtime = "nodejs";
const permitted=(r:Request)=>process.env.RACUN_DEPLOY_ENV==="staging"&&!!process.env.RACUN_STAGING_LOAD_CLEANUP_SECRET&&r.headers.get("x-staging-load-cleanup-secret")===process.env.RACUN_STAGING_LOAD_CLEANUP_SECRET;
export async function POST(r:Request){
 if(!permitted(r))return Response.json({code:"NOT_FOUND"},{status:404});
 const marker=process.env.RACUN_STAGING_LOAD_MARKER;
 if(!marker||!config.databaseUrl||!config.redisUrl)return Response.json({code:"MISCONFIGURED"},{status:503});
 const pool=new Pool({connectionString:config.databaseUrl}); const repo=new PgJobsRepository(config.databaseUrl,{stateTimeoutsMin:config.stateTimeoutsMin}); let scanned=0,refunded=0,refunded_idr=0,redis_removed=0; const state_counts:Record<string,number>={};
 try { const found=await pool.query<{id:string;state:string}>("SELECT j.id,j.state FROM jobs j JOIN products p ON p.id=j.product_id WHERE p.name LIKE $1 ORDER BY j.created_at LIMIT 100",[marker+"%"]); scanned=found.rowCount??0; const q=getRedisJobQueue(); for(const x of found.rows){state_counts[x.state]=(state_counts[x.state]??0)+1;if(!["READY","FAILED","REFUNDED"].includes(x.state)){const z=await repo.failJob(x.id,"Controlled staging load test cleanup.");if(z.changed){refunded++;refunded_idr+=z.refunded;}}const j=await q.getJob(x.id);if(j){await j.remove();redis_removed++;}} return Response.json({ok:true,scanned,state_counts,refunded,refunded_idr,redis_removed}); }
 finally {await closeRedisJobQueue().catch(()=>undefined);await repo.close();await pool.end();}
}
