// Test preload: fail closed on non-loopback HTTP(S). Data URLs remain usable
// for provider fixtures, and local test servers remain available.
const http = require("node:http");
const https = require("node:https");

function assertLocal(target) {
  const raw = typeof target === "string" || target instanceof URL
    ? String(target)
    : `${target?.protocol ?? "http:"}//${target?.hostname ?? target?.host ?? "localhost"}${target?.path ?? "/"}`;
  if (raw.startsWith("data:") || raw.startsWith("file:")) return;
  const url = new URL(raw);
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return;
  throw new Error(`TEST_EXTERNAL_NETWORK_FORBIDDEN:${url.protocol}//${url.hostname}`);
}

if (globalThis.fetch) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    assertLocal(input instanceof Request ? input.url : input);
    return realFetch(input, init);
  };
}

for (const transport of [http, https]) {
  const request = transport.request;
  transport.request = function guardedRequest(...args) {
    assertLocal(args[0]);
    return request.apply(this, args);
  };
  const get = transport.get;
  transport.get = function guardedGet(...args) {
    assertLocal(args[0]);
    return get.apply(this, args);
  };
}
