import test from "node:test";
import assert from "node:assert/strict";
import { staleInviteReason } from "../cleanupStaleGroupInvites.js";

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
