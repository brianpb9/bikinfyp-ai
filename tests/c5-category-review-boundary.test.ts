import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCategoryReviewClear,
  authorizeCategoryReviewRelease,
  deriveCategoryReview,
} from "../lib/product-type-boundary";

test("C5 structured outcomes quarantine all three reasons without heuristic mapping", () => {
  assert.equal(deriveCategoryReview("default").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("not-an-existing-id").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("beauty", "UNKNOWN").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("beauty", "AMBIGUOUS").reason, "CATEGORY_AMBIGUOUS");
  assert.equal(deriveCategoryReview("beauty", "BUNDLE").reason, "CATEGORY_BUNDLE");
  assert.deepEqual(deriveCategoryReview("beauty"), {
    state: "CLEAR", reason: null, reviewedBy: null, reviewedRole: null, reviewedAt: null, version: 1,
  });
});

test("C5 quarantine fails closed and product-type self confirmation has no release capability", () => {
  assert.throws(() => assertCategoryReviewClear(deriveCategoryReview("default")), /Authorized human category review/);
  assert.doesNotThrow(() => assertCategoryReviewClear(deriveCategoryReview("beauty")));
});

test("C5 release fails closed for missing/wrong role and records complete provenance", () => {
  const current = deriveCategoryReview("beauty", "AMBIGUOUS");
  const release = {
    actorId: "reviewer-1", actorRole: "catalog-reviewer", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "Verified single existing category from source evidence", expectedVersion: 1,
  };
  assert.throws(() => authorizeCategoryReviewRelease(current, release, ""), /role is missing or does not match/i);
  assert.throws(() => authorizeCategoryReviewRelease(current, release, "different-role"), /role is missing or does not match/i);
  assert.deepEqual(authorizeCategoryReviewRelease(current, release, "catalog-reviewer"), {
    state: "CLEAR", reason: null, reviewedBy: "reviewer-1", reviewedRole: "catalog-reviewer",
    reviewedAt: "2026-08-27T17:00:00.000Z", version: 2,
  });
});

test("C5 release is optimistic-concurrency safe", () => {
  const current = deriveCategoryReview("beauty", "BUNDLE");
  assert.throws(() => authorizeCategoryReviewRelease(current, {
    actorId: "reviewer-1", actorRole: "catalog-reviewer", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "reviewed", expectedVersion: 2,
  }, "catalog-reviewer"), /state changed or release evidence is incomplete/i);
});
