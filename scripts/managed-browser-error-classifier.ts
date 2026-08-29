export type ExpectedNetworkFailure = {
  fixtureId: string;
  method: string;
  url: string;
  outcome: "http" | "blocked";
  status?: number;
};

export type ObservedNetworkFailure = ExpectedNetworkFailure & {
  requestId: string;
};

export type BrowserDiagnostic = {
  source: "network" | "console" | "pageerror";
  level: string;
  text: string;
  requestId?: string;
};

export type DiagnosticClassification = {
  expected: boolean;
  reason: string;
  fixtureId?: string;
};

const NETWORK_ERROR = /failed to load resource|net::err_|http error/i;
const BLOCKED_ERROR = /net::err_|blocked/i;
const HTTP_ERROR = /failed to load resource|http error/i;

/**
 * A browser error is expected only when Chromium binds it to the exact CDP
 * request id that the runner registered for one deliberate failure fixture.
 * Text, URL, or status alone are never sufficient correlation.
 */
export function classifyManagedBrowserDiagnostic(
  diagnostic: BrowserDiagnostic,
  observedByRequestId: ReadonlyMap<string, ObservedNetworkFailure>,
  expectedByFixtureId: ReadonlyMap<string, ExpectedNetworkFailure>,
): DiagnosticClassification {
  if (diagnostic.level !== "error") return { expected: true, reason: "non-error" };
  if (diagnostic.source !== "network") return { expected: false, reason: diagnostic.source };
  if (!NETWORK_ERROR.test(diagnostic.text)) return { expected: false, reason: "unknown-network-error" };
  if (!diagnostic.requestId) return { expected: false, reason: "missing-request-id" };

  const observed = observedByRequestId.get(diagnostic.requestId);
  if (!observed) return { expected: false, reason: "uncorrelated-request-id" };
  const fixture = expectedByFixtureId.get(observed.fixtureId);
  if (!fixture) return { expected: false, reason: "unknown-fixture" };
  const exact = observed.fixtureId === fixture.fixtureId
    && observed.method === fixture.method
    && observed.url === fixture.url
    && observed.outcome === fixture.outcome
    && observed.status === fixture.status;
  if (!exact) return { expected: false, reason: "fixture-mismatch" };
  if (fixture.outcome === "blocked" && !BLOCKED_ERROR.test(diagnostic.text))
    return { expected: false, reason: "outcome-text-mismatch" };
  if (fixture.outcome === "http" && !HTTP_ERROR.test(diagnostic.text))
    return { expected: false, reason: "outcome-text-mismatch" };
  const reportedStatus = diagnostic.text.match(/(?:status(?: of)?|http error)\D*(\d{3})/i)?.[1];
  if (reportedStatus && Number(reportedStatus) !== fixture.status)
    return { expected: false, reason: "status-text-mismatch" };
  return { expected: true, reason: "exact-request-fixture", fixtureId: fixture.fixtureId };
}
