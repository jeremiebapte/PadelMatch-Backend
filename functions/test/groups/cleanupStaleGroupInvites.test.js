import test from "node:test";
import assert from "node:assert/strict";
import { staleInviteReason, buildCleanupStaleGroupInvites } from "../../cleanupStaleGroupInvites.js";

const now = new Date("2026-11-24T12:00:00Z");
const invite = (extra = {}) => ({
  status: "pending", targetUserId: "user_a", groupId: "group_a",
  expiresAt: new Date("2026-11-25T12:00:00Z"), ...extra,
});
const active = { status: "active", userId: "user_a", groupId: "group_a" };

test("expired direct invitation is stale", () => {
  assert.equal(staleInviteReason(invite({expiresAt: new Date("2026-11-23")}), null, now), "expired");
});
test("invite with missing expiration cannot remain pending", () => {
  assert.equal(staleInviteReason(invite({expiresAt: null}), null, now), "expired");
});
test("already member invitation is stale even before expiry", () => {
  assert.equal(staleInviteReason(invite(), active, now), "already_member");
});
test("other membership cannot invalidate invitation", () => {
  assert.equal(staleInviteReason(invite(), { ...active, groupId: "other" }, now), null);
});
test("valid direct invitation stays pending", () => {
  assert.equal(staleInviteReason(invite(), null, now), null);
});
test("reusable link is not swept by recipient cleanup", () => {
  assert.equal(staleInviteReason(invite({targetUserId: undefined}), null, now), null);
});
test("resolved invitations are not altered", () => {
  assert.equal(staleInviteReason(invite({status: "accepted"}), active, now), null);
});

function fixture({ status = "pending", expiresAt = new Date("2026-11-22"), membershipStatus = "active" } = {}) {
  const storedInvite = { status, targetUserId: "user_a", groupId: "group_a", expiresAt };
  const activity = { userId: "user_a", type: "group_invite_received", inviteId: "invite_1" };
  const activityRef = { id: "activity_1" };
  const inviteRef = { id: "invite_1" };
  const inviteDocument = { id: "invite_1", ref: inviteRef, data: () => storedInvite };
  const activityDocument = { id: "activity_1", ref: activityRef, data: () => activity };
  let removedActivity = false;
  const db = {
    collection(collection) {
      if (collection === "groupInvites") {
        return {
          where() { return this; },
          orderBy() { return this; },
          limit() { return this; },
          startAfter() { return this; },
          async get() { return { empty: false, size: 1, docs: [inviteDocument] }; },
        };
      }
      if (collection === "groupMemberships") return { doc: id => ({ id, collection }) };
      if (collection === "userActivities") return {
        where() { return this; },
        limit() { return this; },
        collection,
      };
      throw Error("unexpected collection " + collection);
    },
    async runTransaction(fn) {
      return fn({
        async get(target) {
          if (target === inviteRef) return { data: () => storedInvite };
          if (target.collection === "groupMemberships") return {
            exists: true,
            data: () => ({ groupId: "group_a", userId: "user_a", status: membershipStatus }),
          };
          if (target.collection === "userActivities") return { docs: [activityDocument] };
          throw Error("Unexpected read");
        },
        update(ref, patch) { assert.equal(ref, inviteRef); Object.assign(storedInvite, patch); },
        delete(ref) { assert.equal(ref, activityRef); removedActivity = true; },
      });
    },
  };
  return { db, storedInvite, isActivityRemoved: () => removedActivity };
}

test("cleanup resolves an expired invitation and deletes stale badge activity", async () => {
  const { db, storedInvite, isActivityRemoved } = fixture({ membershipStatus: "removed" });
  const run = buildCleanupStaleGroupInvites({ db, now: () => now, logger: {info() {}, warn() {}} });
  const result = await run();
  assert.equal(result.cleaned, 1);
  assert.equal(storedInvite.status, "expired");
  assert.equal(isActivityRemoved(), true);
});

test("cleanup cancels already-member invitations before expiration", async () => {
  const { db, storedInvite, isActivityRemoved } = fixture({
    expiresAt: new Date("2026-11-25"), membershipStatus: "active",
  });
  const run = buildCleanupStaleGroupInvites({ db, now: () => now, logger: {info() {}, warn() {}} });
  const result = await run();
  assert.equal(result.cleaned, 1);
  assert.equal(storedInvite.status, "cancelled");
  assert.equal(isActivityRemoved(), true);
});
