import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateMatchReminderCleanupHealthV2,
  FAILURE_THRESHOLD,
} from "../domain/notifications/MatchReminderCleanupHealthV2.js";

test("13AQ-2 : aucun échec = healthy", () => {
  assert.deepEqual(
    evaluateMatchReminderCleanupHealthV2({
      consecutiveFailures: 0,
    }),
    {
      status: "healthy",
      consecutiveFailures: 0,
      needsAttention: false,
    }
  );
});

test("13AQ-2 : un échec = degraded", () => {
  assert.equal(
    evaluateMatchReminderCleanupHealthV2({
      consecutiveFailures: 1,
    }).status,
    "degraded"
  );
});

test("13AQ-2 : deux échecs restent sous le seuil", () => {
  const result = evaluateMatchReminderCleanupHealthV2({
    consecutiveFailures: 2,
  });

  assert.equal(result.needsAttention, false);
  assert.equal(result.status, "degraded");
});

test("13AQ-2 : troisième échec = blocked", () => {
  const result = evaluateMatchReminderCleanupHealthV2({
    consecutiveFailures: 3,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.needsAttention, true);
});

test("13AQ-2 : au-delà du seuil = blocked", () => {
  const result = evaluateMatchReminderCleanupHealthV2({
    consecutiveFailures: 12,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.consecutiveFailures, 12);
});

test("13AQ-2 : valeur invalide = unknown", () => {
  for (const value of [-1, "3", null, 1.5]) {
    const result = evaluateMatchReminderCleanupHealthV2({
      consecutiveFailures: value,
    });

    assert.equal(result.status, "unknown");
    assert.equal(result.needsAttention, false);
  }
});

test("13AQ-2 : seuil fixé à trois", () => {
  assert.equal(FAILURE_THRESHOLD, 3);
});
