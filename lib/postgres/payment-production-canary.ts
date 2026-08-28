import type { Pool } from "pg";
import { INTERNAL_PAYMENT_CANARY, runProductionPaymentCanary, type PaymentCanaryDeps,
  type PaymentCanaryPinnedInput, type PaymentCanaryReservation } from "../payment-production-canary";
import {loadPaymentCanaryFounderAuthorityFromDeployment} from "../payment-canary-founder-trust";

type Queryable = Pick<Pool,"query">;

export class PgPaymentProductionCanaryState {
  constructor(private readonly db:Queryable,private readonly now:()=>Date) {}

  async reserveSingleton(input:PaymentCanaryReservation):Promise<boolean> {
    const p=input.prerequisites,a=p.approval,e=p.economics;
    const result=await this.db.query(`INSERT INTO payment_production_canary
      (singleton_id,actor_id,amount_idr,entitlement,payment_method,channel_minimum_idr,
       merchant_readiness_source,channel_minimum_source,settlement_class,settlement_window,settlement_source,
       source_bundle_sha256,source_effective_at,source_expires_at,approver_identity,approval_key_id,
       approval_reference,approval_receipt_sha256,approval_effective_at,approval_expires_at,
       approved_loss_cap_idr,economics_json,prerequisite_receipt_sha256,payments_env,state,no_retry,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
        'RESERVED',TRUE,$25,$25)
      ON CONFLICT (singleton_id) DO NOTHING RETURNING singleton_id`,[
      input.canaryId,input.actorId,input.amountIdr,input.entitlement,input.paymentMethod,p.channelMinimumIdr,
      p.merchantReadinessSource,p.channelMinimumSource,p.settlementClass,p.settlementWindow,p.settlementSource,
      p.sourceBundleSha256,p.sourceEffectiveAt,p.sourceExpiresAt,a.approverIdentity,p.authorityEvidence.approvalKeyId,
      a.approvalReference,a.approvalReceiptSha256,a.effectiveAt,a.expiresAt,a.approvedLossCapIdr,JSON.stringify(e),
      input.prerequisiteReceiptSha256,input.environment,this.now().toISOString()]);
    return result.rowCount===1;
  }

  async markIssued(input:{canaryId:string;providerRef:string;expectedState:"RESERVED"}):Promise<void> {
    const result=await this.db.query(`UPDATE payment_production_canary
      SET state='ISSUED',provider_ref=$2,updated_at=$3
      WHERE singleton_id=$1 AND state=$4 AND no_retry=TRUE AND provider_ref IS NULL
      RETURNING singleton_id`,[input.canaryId,input.providerRef,this.now().toISOString(),input.expectedState]);
    if(result.rowCount!==1)throw new Error("PAYMENT_CANARY_MARK_ISSUED_STATE_CONFLICT");
  }

  async markHoldNoRetry(input:{canaryId:string;reason:string;providerRef?:string;
    expectedStates:readonly ("RESERVED"|"ISSUED")[]}):Promise<void> {
    const result=await this.db.query(`UPDATE payment_production_canary
      SET state='HOLD_NO_RETRY',hold_reason=$2,provider_ref=COALESCE($3,provider_ref),updated_at=$4
      WHERE singleton_id=$1 AND state=ANY($5::text[]) AND no_retry=TRUE
        AND ($3::text IS NULL OR provider_ref IS NULL OR provider_ref=$3)
      RETURNING singleton_id`,[input.canaryId,input.reason,input.providerRef??null,this.now().toISOString(),input.expectedStates]);
    if(result.rowCount!==1)throw new Error("PAYMENT_CANARY_MARK_HOLD_STATE_CONFLICT");
  }
}

export async function runControlledPostgresPaymentCanary(input:PaymentCanaryPinnedInput,options:{
  db:Queryable;
  operatorAuthorization:string;
  configuredOperatorAuthorization:string;
  createInvoice:PaymentCanaryDeps["createInvoice"];
  now?:()=>Date;
}) {
  if(!options.configuredOperatorAuthorization
      || options.operatorAuthorization!==options.configuredOperatorAuthorization) {
    throw new Error("PAYMENT_CANARY_OPERATOR_NOT_AUTHORIZED");
  }
  if(INTERNAL_PAYMENT_CANARY.environment!=="production")throw new Error("PAYMENT_CANARY_ENVIRONMENT_DRIFT");
  const now=options.now??(()=>new Date());
  const state=new PgPaymentProductionCanaryState(options.db,now);
  return runProductionPaymentCanary(input,{
    reserveSingleton:(value)=>state.reserveSingleton(value),createInvoice:options.createInvoice,
    markIssued:(value)=>state.markIssued(value),markHoldNoRetry:(value)=>state.markHoldNoRetry(value),
    loadTrustedFounderAuthority:loadPaymentCanaryFounderAuthorityFromDeployment,now,
  });
}
