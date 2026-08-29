import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyManagedBrowserDiagnostic,
  type BrowserDiagnostic,
  type ExpectedNetworkFailure,
  type ObservedNetworkFailure,
} from "../scripts/managed-browser-error-classifier.ts";

const origin = "https://racun-ai-staging-web.onrender.com";
const expected = new Map<string, ExpectedNetworkFailure>([
  ["wrong-otp", { fixtureId: "wrong-otp", method: "POST", url: `${origin}/api/auth/verify-otp`, outcome: "http", status: 401 }],
  ["otp-replay", { fixtureId: "otp-replay", method: "POST", url: `${origin}/api/auth/verify-otp`, outcome: "http", status: 401 }],
  ["deliberate-block", { fixtureId: "deliberate-block", method: "POST", url: `${origin}/api/__managed-deliberate-block__`, outcome: "blocked" }],
]);
const issue = (requestId: string): BrowserDiagnostic => ({
  source: "network", level: "error", text: "Failed to load resource: the server responded with a status of 401", requestId,
});
const classify = (diagnostic: BrowserDiagnostic, observations: ObservedNetworkFailure[]) =>
  classifyManagedBrowserDiagnostic(diagnostic, new Map(observations.map((item) => [item.requestId, item])), expected);

test("deliberate wrong OTP 401 is expected only through its exact request id", () => {
  const observation = { ...expected.get("wrong-otp")!, requestId: "cdp-wrong-otp" };
  assert.deepEqual(classify(issue(observation.requestId), [observation]),
    { expected: true, reason: "exact-request-fixture", fixtureId: "wrong-otp" });
  assert.equal(classify(issue("different-request"), [observation]).expected, false);
});

test("OTP replay and deliberate blocked request have separate exact fixtures", () => {
  const replay = { ...expected.get("otp-replay")!, requestId: "cdp-replay" };
  const blocked = { ...expected.get("deliberate-block")!, requestId: "cdp-blocked" };
  assert.equal(classify(issue(replay.requestId), [replay]).expected, true);
  assert.equal(classify({ source: "network", level: "error", text: "net::ERR_BLOCKED_BY_CLIENT", requestId: blocked.requestId }, [blocked]).expected, true);
  assert.equal(classify({ source: "network", level: "error", text: "net::ERR_BLOCKED_BY_CLIENT", requestId: replay.requestId }, [replay]).expected, false);
});

test("hydration mismatch, CSP violation, and uncaught exception always fail", () => {
  for (const diagnostic of [
    { source: "console", level: "error", text: "Hydration failed because the initial UI does not match" },
    { source: "console", level: "error", text: "Refused to execute inline script because of Content Security Policy" },
    { source: "pageerror", level: "error", text: "Uncaught TypeError: boom" },
  ] satisfies BrowserDiagnostic[]) assert.equal(classify(diagnostic, []).expected, false);
});

test("unexpected uncorrelated 4xx/5xx and fixture mismatches fail", () => {
  for (const status of [404, 500]) {
    assert.equal(classify({ source: "network", level: "error", text: `Failed to load resource: status ${status}`, requestId: `unknown-${status}` }, []).expected, false);
  }
  const wrongStatus = { ...expected.get("wrong-otp")!, requestId: "cdp-wrong-status", status: 500 };
  const wrongUrl = { ...expected.get("wrong-otp")!, requestId: "cdp-wrong-url", url: `${origin}/api/other` };
  assert.equal(classify(issue(wrongStatus.requestId), [wrongStatus]).expected, false);
  assert.equal(classify(issue(wrongUrl.requestId), [wrongUrl]).expected, false);
});

test("unknown error text cannot be laundered by a valid request correlation", () => {
  const observation = { ...expected.get("wrong-otp")!, requestId: "cdp-valid" };
  assert.equal(classify({ source: "network", level: "error", text: "certificate integrity failure", requestId: observation.requestId }, [observation]).expected, false);
});
