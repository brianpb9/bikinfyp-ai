export const CONTENT_REJECTION_PATTERN_SOURCE:string;
export const NSFW_TARGET_BY_FORMAT:Readonly<Record<string,number>>;
export function isProviderContentRejection(reason:unknown):boolean;
export type NsfwAggregateInput={format:string;sukses:number|string;ditolak_konten:number|string;gagal_semua:number|string};
export type NsfwKpiSummary={format:string;success:number;rejected:number;otherFailures:number;launched:number;
  rate:number;target:number|undefined;thresholdStatus:"PASS"|"FAIL"|"NO_DATA"|"UNSCOPED"};
export function summarizeNsfwAggregates(rows:NsfwAggregateInput[]):NsfwKpiSummary[];
export function completeRequiredNsfwFormats(rows:NsfwAggregateInput[]):NsfwAggregateInput[];
export function nsfwReportExitCode(summaries:NsfwKpiSummary[]):0|1;
