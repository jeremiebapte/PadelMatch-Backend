import assert from "node:assert/strict";
import test from "node:test";

import {
  GroupJoinPolicy,
  GroupJoinRequestStatus,
  GroupMembershipSource,
  GroupMembershipStatus,
  GroupRole,
} from "../../../domain/groups/GroupEnums.js";

import {
  approveGroupJoinRequest,
  assertCanManageJoinRequests,
  assertRequestCanBeCreated,
  buildMembershipFromApprovedJoinRequest,
  buildPendingGroupJoinRequest,
  cancelGroupJoinRequest,
  deterministicJoinRequestId,
  rejectGroupJoinRequest,
} from "../../../domain/groups/GroupJoinRequestService.js";

const NOW =
  new Date("2026-07-30T10:00:00.000Z");

function activeGroup() {
  return {
    groupId: "group_123",
    name: "Padel Paris",
    imageUrl:
      "https://example.com/group.jpg",
    status: "active",
    joinPolicy:
      GroupJoinPolicy.APPROVAL_REQUIRED,
  };
}

function requester() {
  return {
    pseudo: "Jérémie",
    avatar:
      "https://example.com/avatar.jpg",
    level: 7,
  };
}

function pendingRequest() {
  return buildPendingGroupJoinRequest({
    requestId:
      "group_123_user_123",
    groupId:
      "group_123",
    requesterUid:
      "user_123",
    group: activeGroup(),
    requesterUser: requester(),
    now: NOW,
  });
}

test(
  "deterministicJoinRequestId is stable",
  () => {
    assert.equal(
      deterministicJoinRequestId({
        groupId: "group_123",
        requesterUid: "user_123",
      }),
      "group_123_user_123"
    );
  }
);

test(
  "buildPendingGroupJoinRequest creates snapshots and expiration",
  () => {
    const request = pendingRequest();

    assert.equal(
      request.status,
      GroupJoinRequestStatus.PENDING
    );

    assert.equal(
      request.requesterPseudoSnapshot,
      "Jérémie"
    );

    assert.equal(
      request.requesterLevelSnapshot,
      7
    );

    assert.equal(
      request.groupNameSnapshot,
      "Padel Paris"
    );

    assert.equal(
      request.expiresAt.toISOString(),
      "2026-08-29T10:00:00.000Z"
    );
  }
);

test(
  "assertRequestCanBeCreated rejects active members",
  () => {
    assert.throws(
      () =>
        assertRequestCanBeCreated({
          group: activeGroup(),
          existingMembership: {
            status:
              GroupMembershipStatus.ACTIVE,
          },
          existingRequest: null,
        }),
      {
        code: "ALREADY_GROUP_MEMBER",
      }
    );
  }
);

test(
  "assertRequestCanBeCreated rejects banned users",
  () => {
    assert.throws(
      () =>
        assertRequestCanBeCreated({
          group: activeGroup(),
          existingMembership: {
            status:
              GroupMembershipStatus.BANNED,
          },
          existingRequest: null,
        }),
      {
        code:
          "USER_BANNED_FROM_GROUP",
      }
    );
  }
);

test(
  "assertRequestCanBeCreated rejects pending duplicates",
  () => {
    assert.throws(
      () =>
        assertRequestCanBeCreated({
          group: activeGroup(),
          existingMembership: null,
          existingRequest: {
            status:
              GroupJoinRequestStatus.PENDING,
          },
        }),
      {
        code:
          "JOIN_REQUEST_ALREADY_PENDING",
      }
    );
  }
);

test(
  "requester can cancel a pending request",
  () => {
    const result =
      cancelGroupJoinRequest({
        request: pendingRequest(),
        requesterUid: "user_123",
        now: NOW,
      });

    assert.equal(
      result.status,
      GroupJoinRequestStatus.CANCELLED
    );

    assert.equal(
      result.resolvedByUid,
      "user_123"
    );
  }
);

test(
  "another user cannot cancel a request",
  () => {
    assert.throws(
      () =>
        cancelGroupJoinRequest({
          request: pendingRequest(),
          requesterUid: "other_user",
          now: NOW,
        }),
      {
        code:
          "JOIN_REQUEST_NOT_OWNED_BY_USER",
      }
    );
  }
);

test(
  "owner and admin can manage requests",
  () => {
    assert.equal(
      assertCanManageJoinRequests({
        membership: {
          status:
            GroupMembershipStatus.ACTIVE,
          role: GroupRole.OWNER,
        },
      }),
      true
    );

    assert.equal(
      assertCanManageJoinRequests({
        membership: {
          status:
            GroupMembershipStatus.ACTIVE,
          role: GroupRole.ADMIN,
        },
      }),
      true
    );
  }
);

test(
  "ordinary members cannot manage requests",
  () => {
    assert.throws(
      () =>
        assertCanManageJoinRequests({
          membership: {
            status:
              GroupMembershipStatus.ACTIVE,
            role: GroupRole.MEMBER,
          },
        }),
      {
        code:
          "JOIN_REQUEST_MANAGEMENT_FORBIDDEN",
      }
    );
  }
);

test(
  "approval creates an active membership",
  () => {
    const approved =
      approveGroupJoinRequest({
        request: pendingRequest(),
        approverUid: "admin_123",
        now: NOW,
      });

    const membership =
      buildMembershipFromApprovedJoinRequest({
        request: approved,
        approvedByUid: "admin_123",
        now: NOW,
      });

    assert.equal(
      membership.membershipId,
      "group_123_user_123"
    );

    assert.equal(
      membership.status,
      GroupMembershipStatus.ACTIVE
    );

    assert.equal(
      membership.role,
      GroupRole.MEMBER
    );

    assert.equal(
      membership.source,
      GroupMembershipSource.JOIN_REQUEST
    );

    assert.equal(
      membership.approvedByUid,
      "admin_123"
    );
  }
);

test(
  "a resolved request cannot be resolved twice",
  () => {
    const rejected =
      rejectGroupJoinRequest({
        request: pendingRequest(),
        rejectedByUid: "admin_123",
        now: NOW,
      });

    assert.throws(
      () =>
        approveGroupJoinRequest({
          request: rejected,
          approverUid: "admin_123",
          now: NOW,
        }),
      {
        code:
          "INVALID_JOIN_REQUEST_TRANSITION",
      }
    );
  }
);
