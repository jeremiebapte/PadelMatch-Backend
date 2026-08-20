import assert from "node:assert/strict";
import test from "node:test";

import {
  GroupMembershipStatus,
  GroupRole,
} from "../../../domain/groups/GroupEnums.js";

import {
  selectOwnershipSuccessor,
} from "../../../domain/groups/GroupOwnerLifecycleService.js";

function membership({
  userId,
  role,
  status = GroupMembershipStatus.ACTIVE,
  joinedAt,
  createdAt,
}) {
  return {
    userId,
    role,
    status,
    joinedAt,
    createdAt,
  };
}

test(
  "oldest active admin becomes owner before members",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "owner",
            role: GroupRole.OWNER,
            joinedAt: 1,
          }),
          membership({
            userId: "member_old",
            role: GroupRole.MEMBER,
            joinedAt: 2,
          }),
          membership({
            userId: "admin_new",
            role: GroupRole.ADMIN,
            joinedAt: 10,
          }),
          membership({
            userId: "admin_old",
            role: GroupRole.ADMIN,
            joinedAt: 5,
          }),
        ],
      });

    assert.equal(
      successor?.userId,
      "admin_old"
    );
  }
);

test(
  "oldest active member becomes owner when no admin exists",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "owner",
            role: GroupRole.OWNER,
            joinedAt: 1,
          }),
          membership({
            userId: "member_new",
            role: GroupRole.MEMBER,
            joinedAt: 8,
          }),
          membership({
            userId: "member_old",
            role: GroupRole.MEMBER,
            joinedAt: 3,
          }),
        ],
      });

    assert.equal(
      successor?.userId,
      "member_old"
    );
  }
);

test(
  "inactive memberships are ignored",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "admin_left",
            role: GroupRole.ADMIN,
            status:
              GroupMembershipStatus.LEFT,
            joinedAt: 1,
          }),
          membership({
            userId: "member_active",
            role: GroupRole.MEMBER,
            joinedAt: 5,
          }),
        ],
      });

    assert.equal(
      successor?.userId,
      "member_active"
    );
  }
);

test(
  "returns null when owner is the only active member",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "owner",
            role: GroupRole.OWNER,
            joinedAt: 1,
          }),
        ],
      });

    assert.equal(
      successor,
      null
    );
  }
);

test(
  "createdAt is fallback when joinedAt is unavailable",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "member_new",
            role: GroupRole.MEMBER,
            createdAt: 20,
          }),
          membership({
            userId: "member_old",
            role: GroupRole.MEMBER,
            createdAt: 10,
          }),
        ],
      });

    assert.equal(
      successor?.userId,
      "member_old"
    );
  }
);

test(
  "userId provides deterministic final tie break",
  () => {
    const successor =
      selectOwnershipSuccessor({
        departingOwnerUid: "owner",
        memberships: [
          membership({
            userId: "user_b",
            role: GroupRole.ADMIN,
            joinedAt: 10,
          }),
          membership({
            userId: "user_a",
            role: GroupRole.ADMIN,
            joinedAt: 10,
          }),
        ],
      });

    assert.equal(
      successor?.userId,
      "user_a"
    );
  }
);
