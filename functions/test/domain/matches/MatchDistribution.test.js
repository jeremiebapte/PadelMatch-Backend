import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInitialMatchDistribution,
  getMatchDistributionGroupIds,
  isMatchDistributedToGroup,
  isMatchPublic,
  normalizeMatchDistribution,
} from "../../../domain/matches/MatchDistribution.js";


test(
  "public match starts public with no groups",
  () => {
    assert.deepEqual(
      buildInitialMatchDistribution({
        groupId: null,
      }),
      {
        origin: {
          type: "public",
          groupId: null,
        },
        distribution: {
          public: true,
          groupIds: [],
        },
      }
    );
  }
);


test(
  "group match starts only in its origin group",
  () => {
    assert.deepEqual(
      buildInitialMatchDistribution({
        groupId: "group_A",
      }),
      {
        origin: {
          type: "group",
          groupId: "group_A",
        },
        distribution: {
          public: false,
          groupIds: [
            "group_A",
          ],
        },
      }
    );
  }
);


test(
  "legacy public match is normalized as public",
  () => {
    assert.deepEqual(
      normalizeMatchDistribution({
        createurUid: "user_A",
      }),
      {
        origin: {
          type: "public",
          groupId: null,
        },
        distribution: {
          public: true,
          groupIds: [],
        },
      }
    );
  }
);


test(
  "legacy group match preserves legacy groupId",
  () => {
    assert.deepEqual(
      normalizeMatchDistribution({
        groupId: "group_A",
      }),
      {
        origin: {
          type: "group",
          groupId: "group_A",
        },
        distribution: {
          public: false,
          groupIds: [
            "group_A",
          ],
        },
      }
    );
  }
);


test(
  "V2 group match can also be public",
  () => {
    const match = {
      groupId: "group_A",

      origin: {
        type: "group",
        groupId: "group_A",
      },

      distribution: {
        public: true,
        groupIds: [
          "group_A",
          "group_B",
        ],
      },
    };

    assert.equal(
      isMatchPublic(match),
      true
    );

    assert.deepEqual(
      getMatchDistributionGroupIds(
        match
      ),
      [
        "group_A",
        "group_B",
      ]
    );

    assert.equal(
      isMatchDistributedToGroup(
        match,
        "group_B"
      ),
      true
    );
  }
);


test(
  "normalizer deduplicates groups and keeps origin group",
  () => {
    const result =
      normalizeMatchDistribution({
        groupId: "group_A",

        origin: {
          type: "group",
          groupId: "group_A",
        },

        distribution: {
          public: false,
          groupIds: [
            "group_A",
            "group_B",
            "group_B",
          ],
        },
      });

    assert.deepEqual(
      result.distribution.groupIds,
      [
        "group_A",
        "group_B",
      ]
    );
  }
);
