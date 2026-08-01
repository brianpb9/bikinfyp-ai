/** Keep operational worker logs useful without leaking datastore credentials. */
export function redactWorkerError(message: string): string {
  return message
    .replace(/(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "$1<redacted>")
    .replace(/(redis(?:s)?:\/\/)[^\s'"`]+/gi, "$1<redacted>")
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1<redacted>")
    .slice(0, 2_000);
}
