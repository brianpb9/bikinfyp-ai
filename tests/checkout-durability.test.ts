// Checkout must commit the local pending order before any external provider call.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-checkout-durability-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-checkout-durability-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { initiateCheckout } = await import("../lib/payment-checkout");

test("checkout persists pending order before the mocked Midtrans call", async () => {
  const events: string[] = [];
  let pending: { userId: string; orderId: string; packageId: string; amountIdr: number } | undefined;
  const checkout = await initiateCheckout(
    { id: "user-1", phone: "08123456789" },
    "hq5",
    {
      newOrderId: () => "racun-durable-order",
      persistPending: async (record) => {
        events.push("persist");
        pending = record;
      },
      createSnap: async ({ orderId }) => {
        events.push("provider");
        assert.deepEqual(pending, { userId: "user-1", orderId, packageId: "hq5", amountIdr: 60000 });
        return { snapToken: "snap-test", redirectUrl: "https://example.test/snap" };
      },
      markInitiationFailed: async () => assert.fail("provider success must not mark checkout failed"),
    }
  );
  assert.deepEqual(events, ["persist", "provider"]);
  assert.deepEqual(checkout, { orderId: "racun-durable-order", snapToken: "snap-test", redirectUrl: "https://example.test/snap" });
});

test("provider initiation failure keeps the pending order as a recorded failed checkout", async () => {
  const events: string[] = [];
  let failure: Record<string, unknown> | undefined;
  await assert.rejects(
    initiateCheckout(
      { id: "user-2", email: "owner@example.test" },
      "hq10",
      {
        newOrderId: () => "racun-provider-failed",
        persistPending: async () => { events.push("persist"); },
        createSnap: async () => { events.push("provider"); throw new Error("midtrans: HTTP 503 unavailable"); },
        markInitiationFailed: async (orderId, payload) => {
          events.push("record_failed");
          assert.equal(orderId, "racun-provider-failed");
          failure = payload;
        },
      }
    ),
    /HTTP 503/
  );
  assert.deepEqual(events, ["persist", "provider", "record_failed"]);
  assert.equal(failure?.error, "midtrans: HTTP 503 unavailable");
  assert.equal(typeof failure?.failed_at, "string");
});
