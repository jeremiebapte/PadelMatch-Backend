import test from "node:test";
import assert from "node:assert/strict";

import {
  GroupInviteSource,
  GroupInviteStatus,
  GroupInviteType,
} from "../../../domain/groups/GroupEnums.js";
import {
  buildDirectGroupInvite,
  buildInviteStatusUpdate,
  buildMembershipFromAcceptedInvite,
  buildReusableGroupInvite,
  assertInviteUsable,
} from "../../../domain/groups/GroupInviteService.js";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
} from "../../../domain/groups/GroupInviteToken.js";
import {
  validateCreateLinkInviteInput,
  validateInviteTransition,
} from "../../../domain/groups/GroupInviteValidator.js";

const now = new Date("2026-07-27T12:00:00.000Z");

test("generateInviteToken creates a URL-safe token", () => {
  const token = generateInviteToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 32);
});

test("hashInviteToken is deterministic and does not expose the token", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFG_123456789";
  const first = hashInviteToken(token);
  const second = hashInviteToken(token);

  assert.equal(first, second);
  assert.notEqual(first, token);
  assert.equal(first.length, 64);
});

test("buildInviteUrl creates an HTTPS invitation URL", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFG_123456789";
  const result = buildInviteUrl({ token });

  assert.match(result, /^https:\/\/padima\.app\/invite\?/);
  assert.ok(result.includes("token="));
});

test("buildDirectGroupInvite creates a one-use personal invitation", () => {
  const result = buildDirectGroupInvite({
    inviteId: "invite_123",
    input: {
      groupId: "group_123",
      targetUserId: "target_123",
      source: GroupInviteSource.INTERNAL_SEARCH,
    },
    inviterUid: "owner_123",
    group: { name: "Padel Paris", imageUrl: "https://example.com/group.jpg" },
    inviterUser: { pseudo: "Jeremie", avatar: "avatar_m1" },
    targetUser: { pseudo: "Sam", niveau: 6 },
    now,
  });

  assert.equal(result.type, GroupInviteType.DIRECT_USER);
  assert.equal(result.status, GroupInviteStatus.PENDING);
  assert.equal(result.maxUses, 1);
  assert.equal(result.targetUserId, "target_123");
  assert.equal(result.targetPseudoSnapshot, "Sam");
});

test("buildReusableGroupInvite stores only the token hash", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFG_123456789";
  const result = buildReusableGroupInvite({
    inviteId: "invite_link_123",
    input: {
      groupId: "group_123",
      type: GroupInviteType.LINK,
      maxUses: 25,
    },
    inviterUid: "owner_123",
    group: { name: "Padel Paris" },
    inviterUser: { pseudo: "Jeremie" },
    now,
    token,
  });

  assert.equal(result.maxUses, 25);
  assert.equal(result.type, GroupInviteType.LINK);
  assert.equal(result.tokenHash, hashInviteToken(token));
  assert.equal(Object.hasOwn(result, "token"), false);
});

test("assertInviteUsable rejects an invitation for another user", () => {
  assert.throws(
    () =>
      assertInviteUsable(
        {
          status: GroupInviteStatus.PENDING,
          targetUserId: "target_123",
          expiresAt: new Date("2026-08-01T12:00:00.000Z"),
          useCount: 0,
          maxUses: 1,
        },
        now,
        "other_123"
      ),
    (error) => error.code === "INVITE_NOT_FOR_USER"
  );
});

test("validateInviteTransition rejects terminal status changes", () => {
  assert.throws(
    () =>
      validateInviteTransition(
        GroupInviteStatus.ACCEPTED,
        GroupInviteStatus.REVOKED
      ),
    (error) => error.code === "INVALID_INVITE_STATUS_TRANSITION"
  );
});

test("buildInviteStatusUpdate increments use count on acceptance", () => {
  const result = buildInviteStatusUpdate({
    invite: {
      status: GroupInviteStatus.PENDING,
      useCount: 2,
    },
    nextStatus: GroupInviteStatus.ACCEPTED,
    actorUid: "target_123",
    now,
  });

  assert.equal(result.status, GroupInviteStatus.ACCEPTED);
  assert.equal(result.useCount, 3);
  assert.equal(result.acceptedAt, now);
});

test("buildMembershipFromAcceptedInvite uses invite membership source", () => {
  const membership = buildMembershipFromAcceptedInvite({
    invite: {
      status: GroupInviteStatus.PENDING,
      groupId: "group_123",
      inviterUid: "owner_123",
      type: GroupInviteType.DIRECT_USER,
    },
    userId: "target_123",
    user: { pseudo: "Sam", niveau: 6 },
    now,
  });

  assert.equal(membership.source, "invite");
  assert.equal(membership.role, "member");
  assert.equal(membership.invitedByUid, "owner_123");
});

test("validateCreateLinkInviteInput rejects excessive maxUses", () => {
  assert.throws(
    () =>
      validateCreateLinkInviteInput({
        groupId: "group_123",
        maxUses: 10001,
      }),
    (error) => error.code === "MAX_USES_TOO_HIGH"
  );
});

test(
  "buildInviteStatusUpdate keeps reusable links pending before maxUses",
  () => {
    const now =
      new Date("2026-07-27T12:00:00.000Z");

    const result =
      buildInviteStatusUpdate({
        invite: {
          status:
            GroupInviteStatus.PENDING,
          type:
            GroupInviteType.LINK,
          useCount: 2,
          maxUses: 5,
        },
        nextStatus:
          GroupInviteStatus.ACCEPTED,
        actorUid: "user-123",
        now,
      });

    assert.equal(
      result.status,
      GroupInviteStatus.PENDING
    );

    assert.equal(
      result.useCount,
      3
    );

    assert.equal(
      result.lastAcceptedByUid,
      "user-123"
    );

    assert.equal(
      result.lastAcceptedAt,
      now
    );

    assert.equal(
      result.acceptedAt,
      undefined
    );
  }
);

test(
  "buildInviteStatusUpdate closes reusable links at maxUses",
  () => {
    const now =
      new Date("2026-07-27T12:00:00.000Z");

    const result =
      buildInviteStatusUpdate({
        invite: {
          status:
            GroupInviteStatus.PENDING,
          type:
            GroupInviteType.LINK,
          useCount: 4,
          maxUses: 5,
        },
        nextStatus:
          GroupInviteStatus.ACCEPTED,
        actorUid: "user-123",
        now,
      });

    assert.equal(
      result.status,
      GroupInviteStatus.ACCEPTED
    );

    assert.equal(
      result.useCount,
      5
    );

    assert.equal(
      result.acceptedAt,
      now
    );
  }
);
