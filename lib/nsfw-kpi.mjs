export const CONTENT_REJECTION_PATTERN_SOURCE =
  "(sensitive|risk[_ ]?level|content polic|nsfw|may contain real person|content[_ ]?filter|prohibited content|moderation|flagged)";

export const NSFW_TARGET_BY_FORMAT = Object.freeze({hands_only:0.2,talking_head:0.35});

const contentPattern=new RegExp(CONTENT_REJECTION_PATTERN_SOURCE,"i");

export function isProviderContentRejection(reason) {
  return typeof reason==="string"&&contentPattern.test(reason);
}

export function summarizeNsfwAggregates(rows) {
  return rows.map((row)=>{
    const success=Number(row.sukses),rejected=Number(row.ditolak_konten),allFailed=Number(row.gagal_semua);
    const launched=success+rejected;
    const rate=launched===0?0:rejected/launched;
    const target=NSFW_TARGET_BY_FORMAT[row.format];
    return {format:row.format,success,rejected,otherFailures:allFailed-rejected,launched,rate,target,
      thresholdStatus:target===undefined?"UNSCOPED":rate<=target?"PASS":"FAIL"};
  });
}
