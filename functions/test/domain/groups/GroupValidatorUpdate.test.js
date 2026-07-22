import test from "node:test";
import assert from "node:assert/strict";

import {
  GroupValidationError,
  validateUpdateGroupInput,
} from "../../../domain/groups/index.js";

function currentGroup(overrides = {}) {
  return {
    groupId: "group_123",
    name: "Padel Paris",
    nameNormalized: "padel paris",
    description: "",
    ownerUid: "owner_123",
    type: "friends",
    status: "active",
    discoverability: "searchable",
    joinPolicy: "invite_only",
    city: "Paris",
    countryCode: "FR",
    tags: ["paris"],
    levelMin: 3,
    levelMax: 7,
    settings: {},
    stats: {},
    health: {},
    schemaVersion: 1,
    ...overrides,
  };
}

function assertValidationError(
  callback,
  expectedCode,
  expectedField
) {
  assert.throws(
    callback,
    (error) => {
      assert.ok(
        error instanceof GroupValidationError
      );
      assert.equal(
        error.code,
        expectedCode
      );
      assert.equal(
        error.field,
        expectedField
      );
      return true;
    }
  );
}

test(
  "validateUpdateGroupInput normalizes mutable fields",
  () => {
    const result =
      validateUpdateGroupInput(
        {
          groupId: "group_123",
          name: "  Padel After Work  ",
          description: "  Groupe du soir  ",
          tags: [
            "Paris",
            "After Work",
            "paris",
          ],
          levelMin: 4,
          preferredWeekdays: [5, 2, 5],
          preferredTimeSlots: [
            "evening",
            "late_evening",
            "evening",
          ],
        },
        currentGroup()
      );

    assert.deepEqual(result, {
      name: "Padel After Work",
      nameNormalized:
        "padel after work",
      description:
        "Groupe du soir",
      tags: [
        "paris",
        "after_work",
      ],
      levelMin: 4,
      preferredWeekdays: [2, 5],
      preferredTimeSlots: [
        "evening",
        "late_evening",
      ],
    });
  }
);

test(
  "validateUpdateGroupInput rejects an empty update",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            groupId: "group_123",
          },
          currentGroup()
        ),
      "EMPTY_UPDATE",
      "payload"
    );
  }
);

test(
  "validateUpdateGroupInput rejects immutable fields",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            ownerUid: "other_user",
          },
          currentGroup()
        ),
      "IMMUTABLE_FIELD",
      "ownerUid"
    );

    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            stats: {
              memberCount: 999,
            },
          },
          currentGroup()
        ),
      "IMMUTABLE_FIELD",
      "stats"
    );
  }
);

test(
  "validateUpdateGroupInput rejects unknown fields",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            randomField: true,
          },
          currentGroup()
        ),
      "UNKNOWN_FIELD",
      "randomField"
    );
  }
);

test(
  "validateUpdateGroupInput validates the merged level range",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            levelMin: 8,
          },
          currentGroup({
            levelMax: 7,
          })
        ),
      "INVALID_LEVEL_RANGE",
      "levelMax"
    );

    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            levelMax: 2,
          },
          currentGroup({
            levelMin: 3,
          })
        ),
      "INVALID_LEVEL_RANGE",
      "levelMax"
    );
  }
);

test(
  "validateUpdateGroupInput requires a location for searchable groups",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            city: "",
            latitude: null,
            longitude: null,
          },
          currentGroup({
            latitude: 48.8566,
            longitude: 2.3522,
          })
        ),
      "SEARCHABLE_GROUP_REQUIRES_LOCATION",
      "discoverability"
    );
  }
);

test(
  "validateUpdateGroupInput accepts coordinate removal for a hidden group",
  () => {
    const result =
      validateUpdateGroupInput(
        {
          discoverability: "hidden",
          city: "",
          latitude: null,
          longitude: null,
        },
        currentGroup({
          latitude: 48.8566,
          longitude: 2.3522,
        })
      );

    assert.deepEqual(result, {
      discoverability: "hidden",
      city: "",
      latitude: null,
      longitude: null,
    });
  }
);

test(
  "validateUpdateGroupInput requires both coordinates",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            latitude: 48.8566,
          },
          currentGroup()
        ),
      "INCOMPLETE_LOCATION",
      "location"
    );
  }
);

test(
  "validateUpdateGroupInput requires a club for club communities",
  () => {
    assertValidationError(
      () =>
        validateUpdateGroupInput(
          {
            type: "club_community",
          },
          currentGroup({
            defaultClubId: undefined,
          })
        ),
      "CLUB_COMMUNITY_REQUIRES_CLUB",
      "defaultClubId"
    );
  }
);

test(
  "validateUpdateGroupInput accepts a club community with a club",
  () => {
    const result =
      validateUpdateGroupInput(
        {
          type: "club_community",
          defaultClubId: "club_123",
          defaultClubNameSnapshot:
            "Padel Central",
        },
        currentGroup()
      );

    assert.deepEqual(result, {
      type: "club_community",
      defaultClubId: "club_123",
      defaultClubNameSnapshot:
        "Padel Central",
    });
  }
);

test(
  "validateUpdateGroupInput can clear optional club fields",
  () => {
    const result =
      validateUpdateGroupInput(
        {
          type: "friends",
          defaultClubId: "",
          defaultClubNameSnapshot: "",
        },
        currentGroup({
          type: "club_community",
          defaultClubId: "club_123",
          defaultClubNameSnapshot:
            "Padel Central",
        })
      );

    assert.deepEqual(result, {
      type: "friends",
      defaultClubId: null,
      defaultClubNameSnapshot: null,
    });
  }
);
