import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Pool} from "pg";
import {runControlledPostgresPaymentCanary} from "../lib/postgres/payment-production-canary";

const databaseUrl=process.env.DATABASE_URL??"";
assert.match(databaseUrl,/^postgres(?:ql)?:\/\//);
const pool=new Pool({connectionString:databaseUrl,max:2});
const now=()=>new Date("2026-08-28T00:00:00.000Z");
const economics={cogsIdr:6000,feeIdr:100,taxIdr:0,netIdr:9900,marginIdr:3900,
  cogsSource:"evidence://cogs",feeSource:"evidence://fee",taxSource:"evidence://tax"};
const source={schema:"payment-canary-source-bundle/v1",merchantReadinessSource:"evidence://merchant-readiness",
  channelMinimumSource:"evidence://channel-minimum",settlementSource:"evidence://settlement",
  cogsSource:economics.cogsSource,feeSource:economics.feeSource,taxSource:economics.taxSource,
  effectiveAt:"2026-08-27T00:00:00.000Z",expiresAt:"2026-08-29T00:00:00.000Z",economics};
const sourceBytes=Buffer.from(JSON.stringify(source));
const sourceHash=crypto.createHash("sha256").update(sourceBytes).digest("hex");
const approval={schema:"payment-canary-founder-approval/v1",canaryId:"production-payment-canary-v1",
  approverIdentity:"Founder/CEO",approvalReference:"evidence://founder/payment-canary",sourceBundleSha256:sourceHash,
  approvedLossCapIdr:50000,effectiveAt:"2026-08-27T00:00:00.000Z",expiresAt:"2026-08-29T00:00:00.000Z"};
const approvalBytes=Buffer.from(JSON.stringify(approval));
const {privateKey,publicKey}=crypto.generateKeyPairSync("ed25519");
const trustDir=fs.mkdtempSync(path.join(os.tmpdir(),"payment-canary-founder-trust-"));
const trustPath=path.join(trustDir,"trust.json");
const trustBytes=Buffer.from(JSON.stringify({schema:"payment-canary-founder-trust/v1",keyId:"integration-founder",
  approverIdentity:"Founder/CEO",publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString()}));
fs.writeFileSync(trustPath,trustBytes,{mode:0o400});
process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH=trustPath;
process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256=crypto.createHash("sha256").update(trustBytes).digest("hex");
const input={actorId:"payment-canary-integration",configuredTesterId:"payment-canary-integration",paymentMethod:"VA",
  configuredPaymentMethod:"VA",amountIdr:10000,environment:"production" as const,prerequisites:{merchantReady:true,
    merchantReadinessSource:source.merchantReadinessSource,channelMinimumIdr:10000,
    channelMinimumSource:source.channelMinimumSource,settlementClass:"T+1",settlementWindow:"next banking day",
    settlementSource:source.settlementSource,sourceBundleSha256:sourceHash,sourceEffectiveAt:source.effectiveAt,
    sourceExpiresAt:source.expiresAt,economics,approval:{approverIdentity:"Founder/CEO",
      approvalReference:approval.approvalReference,
      approvalReceiptSha256:crypto.createHash("sha256").update(approvalBytes).digest("hex"),
      effectiveAt:approval.effectiveAt,expiresAt:approval.expiresAt,approvedLossCapIdr:50000},
    authorityEvidence:{sourceBundleBase64:sourceBytes.toString("base64"),approvalReceiptBase64:approvalBytes.toString("base64"),
      approvalSignatureBase64:crypto.sign(null,approvalBytes,privateKey).toString("base64"),approvalKeyId:"integration-founder"}}};

try {
  await pool.query("INSERT INTO users(id,email,created_at) VALUES ($1,$2,$3)",
    [input.actorId,"payment-canary-integration@example.invalid",now().toISOString()]);
  await pool.query(`CREATE FUNCTION reject_canary_issued_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.state='ISSUED' THEN RAISE EXCEPTION 'forced issued write failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER reject_canary_issued BEFORE UPDATE ON payment_production_canary
    FOR EACH ROW EXECUTE FUNCTION reject_canary_issued_write()`);
  const result=await runControlledPostgresPaymentCanary(input,{db:pool,operatorAuthorization:"integration-operator",
    configuredOperatorAuthorization:"integration-operator",createInvoice:async()=>({providerRef:"provider-ref-known",
      redirectUrl:"https://provider.invalid/pay"}),now});
  assert.equal(result.outcome,"HOLD_NO_RETRY");
  assert.equal(result.providerRef,"provider-ref-known");
  const row=(await pool.query("SELECT state,provider_ref,no_retry,hold_reason FROM payment_production_canary")).rows[0];
  assert.deepEqual(row,{state:"HOLD_NO_RETRY",provider_ref:"provider-ref-known",no_retry:true,
    hold_reason:"forced issued write failure"});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_production_canary")).rows[0].n,1);
  console.log(JSON.stringify({result:"PASS",state:row.state,provider_ref_preserved:true,singleton_rows:1}));
} finally {await pool.end();fs.rmSync(trustDir,{recursive:true,force:true});}
