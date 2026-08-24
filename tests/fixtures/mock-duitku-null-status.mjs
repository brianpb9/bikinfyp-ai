globalThis.fetch = async () => new Response("null", {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});
