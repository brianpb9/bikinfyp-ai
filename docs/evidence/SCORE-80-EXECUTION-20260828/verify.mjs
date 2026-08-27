#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const dir=path.dirname(fileURLToPath(import.meta.url));
const read=(name)=>JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));
const fail=(message)=>{throw new Error(message);};
const sourceBytes=fs.readFileSync(path.join(dir,"FOUNDER-SOURCE-TASK.raw.json"));
const source=JSON.parse(sourceBytes);const allocation=read("ALLOCATION.json");
const roles=read("ROLE-AUTHORITY.json");const laneA=read("A-RECEIPT-NORMALIZATION.json");
const laneB=read("B-RECEIPT-NORMALIZATION.json");
const streamBReceiptBytes=fs.readFileSync(path.join(dir,laneB.source.receipt_path));
const streamBManifestBytes=fs.readFileSync(path.join(dir,laneB.source.manifest_path));
const digest=(bytes)=>crypto.createHash("sha256").update(bytes).digest("hex");
const streamBReceipt=JSON.parse(streamBReceiptBytes);

if(source.id!=="1787854482000-reviewer-TASK"||source.from!=="reviewer"||source.to!=="builder"||source.type!=="TASK"||source.sha!==""||source.task!=="SCORE-80-EXECUTION-20260828"||source.owner_id!=="builder-score80-execution-20260828"||source.worker_id!==source.owner_id)fail("Founder source identity");
if(digest(sourceBytes)!=="8f7a1e10dd4ec71ef607efdcb76f5aae980a8a75e86452e7c2a8310338962b2b")fail("Founder source bytes");
const current=allocation.rows.reduce((sum,row)=>sum+row.current,0);
const target=allocation.rows.reduce((sum,row)=>sum+row.target,0);
const delta=allocation.rows.reduce((sum,row)=>sum+row.delta,0);
if(allocation.rows.length!==13||current!==77||target!==104||delta!==27||allocation.target.required_delta!==27)fail("allocation arithmetic");
for(const row of allocation.rows){if(row.target-row.current!==row.delta||row.target>10||row.current<0)fail(`row arithmetic ${row.row}`);if(row.delta>0&&row.state!=="UNAWARDED")fail(`premature award ${row.row}`);}
if(allocation.claimed_raw_now!==77||allocation.claimed_certified_score_now!==58||allocation.award_policy!=="EXACT_SHA_INDEPENDENT_PASS_ROW_BY_ROW")fail("award state");
if(roles.roles.c5_authorized_human_review_role!=="Founder/CEO"||roles.roles.release_approver!=="Founder/CEO"||roles.roles.release_operator!=="canonical Builder service/operator identity"||roles.roles.rollback_authority!=="Founder/CEO")fail("role authority");
if(!roles.separation.approver_and_operator_must_be_separate||roles.separation.operator_may_approve||roles.separation.additional_distinct_rollback_role_required)fail("role separation");
if(laneA.state!=="WAITING_RAW_RECEIPTS"||laneA.raw_receipts.length||laneA.normalized_receipts.length||laneA.output_contract.score_delta_before_independent_pass!==0||laneA.normalization_rules.builder_may_claim_pass||!laneA.normalization_rules.reviewer_exact_sha_pass_required)fail("Lane A fail closed");
if(digest(streamBReceiptBytes)!==laneB.source.receipt_sha256||digest(streamBManifestBytes)!==laneB.source.manifest_sha256)fail("Stream B source bytes");
if(!streamBManifestBytes.toString("utf8").includes(`${laneB.source.receipt_sha256}  ./RECEIPT.json`))fail("Stream B manifest receipt binding");
if(streamBReceipt.receipt_id!=="STREAM-B-MANAGED-20260828"||streamBReceipt.exact_deployed_sha!==laneB.source.exact_deployed_sha||streamBReceipt.evidence_tier!==laneB.source.evidence_tier)fail("Stream B identity");
if(streamBReceipt.result!=="PASS_PARTIAL_NO_SCORE_CLAIM"||streamBReceipt.dashboard.client_hydration_execution_status!=="BLOCKED_BROWSER_RUNTIME_BOOTSTRAP"||streamBReceipt.dashboard.mobile_375_keyboard_loading_failure_recovery_status!=="BLOCKED_BROWSER_RUNTIME_BOOTSTRAP")fail("Stream B partial boundary");
if(streamBReceipt.safety.payments_live||streamBReceipt.safety.real_money_idr!==0||streamBReceipt.safety.resend_or_email_provider_called||streamBReceipt.safety.generation_provider_called||streamBReceipt.safety.payment_provider_called)fail("Stream B safety");
if(laneB.result!=="PASS_PARTIAL_NO_SCORE"||laneB.slot_closed||laneB.points_claimed!==0||laneB.row_outcomes.length!==4||laneB.row_outcomes.some((row)=>row.points_awarded!==0))fail("Stream B score boundary");
if(!source.body.includes("Total raw target 104/130")||!source.body.includes("PAYMENTS_GO_LIVE NOT_AUTHORIZED")||!source.body.includes("Do not change public prices")||!source.body.includes("ambiguous STOP_NO_RETRY"))fail("payment boundary");
console.log(JSON.stringify({result:"PASS",current_raw:current,target_raw:target,delta,positive_rows:allocation.rows.filter((row)=>row.delta>0).length,lane_a_receipts:0,stream_b_result:laneB.result,stream_b_slot_closed:false,score_awarded:0,public_payments:false}));
