import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateMatchReminderCleanupV2,
  MATCH_REMINDER_CLEANUP_AGE_MS,
} from "../domain/notifications/MatchReminderCleanupPolicyV2.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 2000000000000;

const BASE = {
  matchId: "match_123",
  uid: "player_123",
  reminderType: "1h",
  scheduledAt: NOW - 8 * DAY_MS,
  status: "failed",
  claimedAtMs: NOW - 8 * DAY_MS,
};

function evaluate(overrides = {}, now = NOW) {
  return evaluateMatchReminderCleanupV2(
    { ...BASE, ...overrides },
    now
  );
}

test("13AI : failed ancien éligible", () => {
  assert.deepEqual(evaluate(), {
    eligible: true,
    reason: "stale_delivery",
  });
});

test("13AI : sending ancien avec bail expiré éligible", () => {
  assert.equal(
    evaluate({ status: "sending" }).eligible,
    true
  );
});

test("13AI : sent appartient exclusivement au TTL", () => {
  assert.deepEqual(evaluate({ status: "sent" }), {
    eligible: false,
    reason: "sent_uses_ttl",
  });
});

test("13AI : failed récent conservé", () => {
  assert.equal(
    evaluate({
      scheduledAt: NOW - 6 * DAY_MS,
    }).eligible,
    false
  );
});

test("13AI : match futur conservé", () => {
  assert.equal(
    evaluate({
      scheduledAt: NOW + DAY_MS,
    }).eligible,
    false
  );
});

test("13AI : frontière exacte des 7 jours", () => {
  assert.equal(
    evaluate({
      scheduledAt: NOW - MATCH_REMINDER_CLEANUP_AGE_MS,
    }).eligible,
    true
  );

  assert.equal(
    evaluate({
      scheduledAt: NOW - MATCH_REMINDER_CLEANUP_AGE_MS + 1,
    }).eligible,
    false
  );
});

test("13AI : sending avec bail encore actif conservé", () => {
  assert.deepEqual(
    evaluate({
      status: "sending",
      claimedAtMs: NOW - 60000,
    }),
    { eligible: false, reason: "active_lease" }
  );
});

test("13AI : sending avec date future de réservation conservé", () => {
  assert.equal(
    evaluate({
      status: "sending",
      claimedAtMs: NOW + 60000,
    }).eligible,
    false
  );
});

test("13AI : documents incomplets conservés", () => {
  assert.equal(
    evaluate({ matchId: "" }).eligible,
    false
  );

  assert.equal(
    evaluate({ scheduledAt: null }).eligible,
    false
  );

  assert.equal(
    evaluate({
      status: "sending",
      claimedAtMs: null,
    }).eligible,
    false
  );
});

test("13AI : statut inconnu conservé", () => {
  assert.deepEqual(
    evaluate({ status: "unknown" }),
    { eligible: false, reason: "unsupported_status" }
  );
});

test("13AI : horloge invalide refusée", () => {
  assert.equal(
    evaluate({}, NaN).eligible,
    false
  );
});
