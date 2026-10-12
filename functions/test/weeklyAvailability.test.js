import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWeekKey,
  normalizeSlots,
  computeGroupOpportunities,
  rankHomeOpportunities,
  buildSetWeeklyAvailability,
  buildGetMyWeeklyAvailability,
  buildClearWeeklyAvailability,
  buildGetWeeklyAvailabilityHome,
  buildWeeklyAvailabilityReminderCron,
  weekKeyForDate,
} from "../weeklyAvailability.js";


class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}


function clone(value) {
  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  return structuredClone(value);
}


function createEnvironment({
  initialDocuments = {},
} = {}) {
  const store =
    new Map(
      Object.entries(
        initialDocuments
      ).map(
        ([path, value]) => [
          path,
          clone(value),
        ]
      )
    );

  const writes = [];
  const notifications = [];
  const tokenRequests = [];
  const eligibleRecipientRequests = [];


  class FakeSnapshot {
    constructor(
      ref,
      exists,
      data
    ) {
      this.ref = ref;
      this.id = ref.id;
      this.exists = exists;
      this._data =
        exists
          ? clone(data)
          : undefined;
    }

    data() {
      return clone(
        this._data
      );
    }

    get(field) {
      return this._data?.[field];
    }
  }


  class FakeDocumentRef {
    constructor(path) {
      this.path = path;

      const parts =
        path.split("/");

      this.id =
        parts[
          parts.length - 1
        ];
    }

    async get() {
      const exists =
        store.has(this.path);

      return new FakeSnapshot(
        this,
        exists,
        exists
          ? store.get(this.path)
          : undefined
      );
    }

    async set(
      data,
      options = {}
    ) {
      const previous =
        store.get(this.path)
        || {};

      const next =
        options?.merge
          ? {
              ...clone(previous),
              ...clone(data),
            }
          : clone(data);

      store.set(
        this.path,
        next
      );

      writes.push({
        type: "set",
        path: this.path,
        data:
          clone(next),
      });
    }

    collection(name) {
      return new FakeCollectionRef(
        `${this.path}/${name}`
      );
    }
  }


  class FakeQuery {
    constructor(
      collectionPath,
      filters = [],
      max = null
    ) {
      this.collectionPath =
        collectionPath;

      this.filters =
        filters;

      this.max =
        max;
    }

    where(
      field,
      operator,
      value
    ) {
      assert.equal(
        operator,
        "=="
      );

      return new FakeQuery(
        this.collectionPath,
        [
          ...this.filters,
          {
            field,
            value,
          },
        ],
        this.max
      );
    }

    limit(value) {
      return new FakeQuery(
        this.collectionPath,
        this.filters,
        value
      );
    }

    async get() {
      const prefix =
        `${this.collectionPath}/`;

      const expectedParts =
        this.collectionPath
          .split("/")
          .length + 1;

      let docs =
        [...store.entries()]
          .filter(
            ([path]) =>
              path.startsWith(prefix)
              && path.split("/")
                .length
                === expectedParts
          )
          .map(
            ([path, data]) => {
              const ref =
                new FakeDocumentRef(
                  path
                );

              return new FakeSnapshot(
                ref,
                true,
                data
              );
            }
          )
          .filter(
            (snapshot) =>
              this.filters.every(
                ({ field, value }) =>
                  snapshot
                    .data()?.[field]
                    === value
              )
          );

      if (
        Number.isInteger(
          this.max
        )
      ) {
        docs =
          docs.slice(
            0,
            this.max
          );
      }

      return {
        empty:
          docs.length === 0,
        size:
          docs.length,
        docs,
      };
    }
  }


  class FakeCollectionRef
    extends FakeQuery {
    constructor(path) {
      super(path);
      this.path = path;
    }

    doc(id) {
      return new FakeDocumentRef(
        `${this.path}/${id}`
      );
    }
  }


  const db = {
    collection(name) {
      return new FakeCollectionRef(
        name
      );
    },

    async runTransaction(
      handler
    ) {
      const tx = {
        async get(ref) {
          return ref.get();
        },

        set(
          ref,
          data,
          options = {}
        ) {
          const previous =
            store.get(ref.path)
            || {};

          const next =
            options?.merge
              ? {
                  ...clone(
                    previous
                  ),
                  ...clone(
                    data
                  ),
                }
              : clone(data);

          store.set(
            ref.path,
            next
          );

          writes.push({
            type: "set",
            path: ref.path,
            data:
              clone(next),
          });
        },

        delete(ref) {
          store.delete(
            ref.path
          );

          writes.push({
            type: "delete",
            path: ref.path,
          });
        },
      };

      return handler(tx);
    },
  };


  const FieldValue = {
    serverTimestamp() {
      return {
        __serverTimestamp:
          true,
      };
    },
  };


  function onCall(
    runtime,
    handler
  ) {
    return handler;
  }


  function document(path) {
    return clone(
      store.get(path)
    );
  }


  async function getEligibleGroupRecipients({
    groupId,
    preference = "general",
    excludedUserIds = [],
  }) {
    eligibleRecipientRequests.push({
      groupId,
      preference,
      excludedUserIds:
        [...excludedUserIds],
    });

    const excluded =
      new Set(
        excludedUserIds
      );

    const prefix =
      "groupMemberships/";

    return [...store.entries()]
      .filter(
        ([path, data]) =>
          path.startsWith(prefix)
          && path.split("/")
            .length === 2
          && data?.groupId
            === groupId
          && data?.status
            === "active"
          && data
            ?.notificationsEnabled
            !== false
          && !excluded.has(
            data?.userId
          )
      )
      .map(
        ([path, data]) => ({
          membershipId:
            path.split("/")[1],
          ...clone(data),
        })
      );
  }


  async function tokensOf(uid) {
    tokenRequests.push(uid);

    const user =
      store.get(
        `users/${uid}`
      );

    if (
      !user
      || user.notificationsEnabled
        !== true
    ) {
      return [];
    }

    const prefix =
      `users/${uid}/fcmTokens/`;

    return [...store.keys()]
      .filter(
        (path) =>
          path.startsWith(prefix)
          && path.split("/")
            .length === 4
      )
      .map(
        (path) =>
          path.split("/")[3]
      );
  }


  async function sendVisibleHybrid(
    tokens,
    payload
  ) {
    notifications.push({
      tokens:
        [...tokens],
      payload:
        clone(payload),
    });
  }


  const logger = {
    info() {},
    warn() {},
    error() {},
  };


  return {
    db,
    FieldValue,
    HttpsError:
      FakeHttpsError,
    onCall,
    runtime: {
      region:
        "europe-west1",
    },
    writes,
    document,
    store,

    notifications,
    tokenRequests,
    eligibleRecipientRequests,

    getEligibleGroupRecipients,
    tokensOf,
    sendVisibleHybrid,
    logger,
  };
}


function buildCallables(env) {
  return {
    set:
      buildSetWeeklyAvailability({
        onCall:
          env.onCall,
        HttpsError:
          env.HttpsError,
        runtime:
          env.runtime,
        db:
          env.db,
        FieldValue:
          env.FieldValue,

        getEligibleGroupRecipients:
          env.getEligibleGroupRecipients,

        tokensOf:
          env.tokensOf,

        sendVisibleHybrid:
          env.sendVisibleHybrid,

        logger:
          env.logger,
      }),

    get:
      buildGetMyWeeklyAvailability({
        onCall:
          env.onCall,
        HttpsError:
          env.HttpsError,
        runtime:
          env.runtime,
        db:
          env.db,
      }),

    clear:
      buildClearWeeklyAvailability({
        onCall:
          env.onCall,
        HttpsError:
          env.HttpsError,
        runtime:
          env.runtime,
        db:
          env.db,
      }),

    home:
      buildGetWeeklyAvailabilityHome({
        onCall:
          env.onCall,
        HttpsError:
          env.HttpsError,
        runtime:
          env.runtime,
        db:
          env.db,
      }),
  };
}


function authRequest(
  uid,
  data
) {
  return {
    auth: {
      uid,
    },
    data,
  };
}


const WEEK =
  "2026-10-12";


test(
  "weekKey accepte uniquement un lundi",
  () => {
    assert.equal(
      normalizeWeekKey(
        WEEK,
        FakeHttpsError
      ),
      WEEK
    );

    assert.throws(
      () =>
        normalizeWeekKey(
          "2026-10-13",
          FakeHttpsError
        ),
      (error) =>
        error.code
          === "invalid-argument"
        && error.message
          === "WEEK_KEY_MUST_BE_MONDAY"
    );
  }
);


test(
  "normalizeSlots fusionne les créneaux adjacents",
  () => {
    const slots =
      normalizeSlots(
        [
          {
            weekday: 4,
            startMinutes: 1200,
            endMinutes: 1260,
          },
          {
            weekday: 4,
            startMinutes: 1260,
            endMinutes: 1320,
          },
        ],
        FakeHttpsError
      );

    assert.deepEqual(
      slots,
      [
        {
          weekday: 4,
          startMinutes: 1200,
          endMinutes: 1320,
        },
      ]
    );
  }
);


test(
  "normalizeSlots refuse un créneau inférieur à 30 minutes",
  () => {
    assert.throws(
      () =>
        normalizeSlots(
          [
            {
              weekday: 2,
              startMinutes: 1200,
              endMinutes: 1215,
            },
          ],
          FakeHttpsError
        ),
      (error) =>
        error.message
          === "SLOT_TOO_SHORT"
    );
  }
);


test(
  "computeGroupOpportunities détecte un chevauchement de trois joueurs",
  () => {
    const result =
      computeGroupOpportunities({
        groupId:
          "group_1",
        groupName:
          "Potes Padel",
        currentUid:
          "user_a",

        shares: [
          {
            uid:
              "user_a",
            groupId:
              "group_1",
            pseudoSnapshot:
              "A",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
          {
            uid:
              "user_b",
            groupId:
              "group_1",
            pseudoSnapshot:
              "B",
            slots: [
              {
                weekday: 4,
                startMinutes: 1230,
                endMinutes: 1320,
              },
            ],
          },
          {
            uid:
              "user_c",
            groupId:
              "group_1",
            pseudoSnapshot:
              "C",
            slots: [
              {
                weekday: 4,
                startMinutes: 1230,
                endMinutes: 1290,
              },
            ],
          },
        ],
      });

    const best =
      result.find(
        (item) =>
          item.totalAvailable
            === 3
      );

    assert.ok(best);

    assert.equal(
      best.matchingMyAvailability,
      true
    );

    assert.equal(
      best.startMinutes,
      1230
    );

    assert.equal(
      best.endMinutes,
      1290
    );
  }
);


test(
  "rankHomeOpportunities privilégie mes overlaps puis le nombre de joueurs",
  () => {
    const result =
      rankHomeOpportunities([
        {
          matchingMyAvailability:
            false,
          totalAvailable: 4,
          weekday: 1,
          startMinutes: 900,
        },
        {
          matchingMyAvailability:
            true,
          totalAvailable: 2,
          weekday: 2,
          startMinutes: 1200,
        },
        {
          matchingMyAvailability:
            true,
          totalAvailable: 4,
          weekday: 3,
          startMinutes: 1200,
        },
      ]);

    assert.equal(
      result[0]
        .matchingMyAvailability,
      true
    );

    assert.equal(
      result[0]
        .totalAvailable,
      4
    );
  }
);


test(
  "setWeeklyAvailability exige auth",
  async () => {
    const env =
      createEnvironment();

    const callables =
      buildCallables(env);

    await assert.rejects(
      callables.set({
        auth: null,
        data: {
          weekKey: WEEK,
          slots: [],
          sharedGroupIds: [],
        },
      }),
      (error) =>
        error.code
          === "unauthenticated"
    );
  }
);


test(
  "setWeeklyAvailability refuse un groupe sans membership actif",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
          },

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "left",
          },
        },
      });

    const callables =
      buildCallables(env);

    await assert.rejects(
      callables.set(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      ),
      (error) =>
        error.code
          === "permission-denied"
    );
  }
);


test(
  "setWeeklyAvailability écrit la donnée privée et sa diffusion groupe",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            photoUrl:
              "https://example.com/a.jpg",
          },

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.set(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,
            timeZone:
              "Europe/Paris",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      );

    assert.equal(
      result.ok,
      true
    );

    const availability =
      env.document(
        `weeklyAvailabilities/user_a_${WEEK}`
      );

    assert.deepEqual(
      availability
        .sharedGroupIds,
      [
        "group_1",
      ]
    );

    const share =
      env.document(
        `weeklyAvailabilityShares/${WEEK}_group_1_user_a`
      );

    assert.equal(
      share.uid,
      "user_a"
    );

    assert.equal(
      share.groupId,
      "group_1"
    );

    assert.equal(
      share.pseudoSnapshot,
      "Jeremie"
    );
  }
);


test(
  "modifier les groupes retire les anciennes diffusions",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
          },

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },

          "groupMemberships/group_2_user_a": {
            groupId:
              "group_2",
            userId:
              "user_a",
            status:
              "active",
          },

          [`weeklyAvailabilities/user_a_${WEEK}`]: {
            uid:
              "user_a",
            weekKey:
              WEEK,
            sharedGroupIds: [
              "group_1",
            ],
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_a`]: {
            uid:
              "user_a",
            groupId:
              "group_1",
            weekKey:
              WEEK,
          },
        },
      });

    const callables =
      buildCallables(env);

    await callables.set(
      authRequest(
        "user_a",
        {
          weekKey: WEEK,
          slots: [
            {
              weekday: 5,
              startMinutes: 1140,
              endMinutes: 1260,
            },
          ],
          sharedGroupIds: [
            "group_2",
          ],
        }
      )
    );

    assert.equal(
      env.document(
        `weeklyAvailabilityShares/${WEEK}_group_1_user_a`
      ),
      undefined
    );

    assert.ok(
      env.document(
        `weeklyAvailabilityShares/${WEEK}_group_2_user_a`
      )
    );
  }
);


test(
  "getMyWeeklyAvailability retourne un flow vide sans document",
  async () => {
    const env =
      createEnvironment();

    const callables =
      buildCallables(env);

    const result =
      await callables.get(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,
          }
        )
      );

    assert.equal(
      result.ok,
      true
    );

    assert.deepEqual(
      result.availability.slots,
      []
    );

    assert.deepEqual(
      result
        .availability
        .sharedGroupIds,
      []
    );
  }
);


test(
  "clearWeeklyAvailability supprime disponibilité et diffusions",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          [`weeklyAvailabilities/user_a_${WEEK}`]: {
            uid:
              "user_a",
            weekKey:
              WEEK,
            sharedGroupIds: [
              "group_1",
              "group_2",
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_a`]: {
            uid:
              "user_a",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_2_user_a`]: {
            uid:
              "user_a",
          },
        },
      });

    const callables =
      buildCallables(env);

    await callables.clear(
      authRequest(
        "user_a",
        {
          weekKey: WEEK,
        }
      )
    );

    assert.equal(
      env.document(
        `weeklyAvailabilities/user_a_${WEEK}`
      ),
      undefined
    );

    assert.equal(
      env.document(
        `weeklyAvailabilityShares/${WEEK}_group_1_user_a`
      ),
      undefined
    );

    assert.equal(
      env.document(
        `weeklyAvailabilityShares/${WEEK}_group_2_user_a`
      ),
      undefined
    );
  }
);


test(
  "Home retourne les overlaps des groupes actifs uniquement",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },

          "groupMemberships/group_1_user_b": {
            groupId:
              "group_1",
            userId:
              "user_b",
            status:
              "active",
          },

          "groupMemberships/group_2_user_a": {
            groupId:
              "group_2",
            userId:
              "user_a",
            status:
              "left",
          },

          "groups/group_1": {
            name:
              "Potes Padel",
          },

          "groups/group_2": {
            name:
              "Ancien groupe",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_a`]: {
            uid:
              "user_a",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Jeremie",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid:
              "user_b",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_2_user_c`]: {
            uid:
              "user_c",
            groupId:
              "group_2",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Karim",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.home(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,
          }
        )
      );

    assert.equal(
      result.ok,
      true
    );

    assert.ok(
      result.opportunities
        .length > 0
    );

    assert.ok(
      result.opportunities
        .every(
          (item) =>
            item.groupId
              === "group_1"
        )
    );

    assert.equal(
      result.opportunities[0]
        .matchingMyAvailability,
      true
    );

    assert.equal(
      result.opportunities[0]
        .totalAvailable,
      2
    );
  }
);


test(
  "3 joueurs disponibles déclenchent une notification Ça matche",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            notificationsEnabled:
              true,
          },

          "users/user_b": {
            pseudo:
              "Mehdi",
            notificationsEnabled:
              true,
          },

          "users/user_c": {
            pseudo:
              "Karim",
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},
          "users/user_b/fcmTokens/token_b": {},
          "users/user_c/fcmTokens/token_c": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_b": {
            groupId:
              "group_1",
            userId:
              "user_b",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_c": {
            groupId:
              "group_1",
            userId:
              "user_c",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groups/group_1": {
            name:
              "Potes Padel",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid:
              "user_b",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_c`]: {
            uid:
              "user_c",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Karim",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.set(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,

            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],

            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      );

    assert.equal(
      result
        .matchNotifications
        .attempted,
      3
    );

    assert.equal(
      result
        .matchNotifications
        .sent,
      3
    );

    assert.equal(
      env.notifications.length,
      3
    );

    assert.ok(
      env.notifications.every(
        (item) =>
          item.payload.data.type
            === "weekly_availability"
          && item.payload.data.subtype
            === "match"
          && item.payload.data.groupId
            === "group_1"
          && item.payload.data.weekKey
            === WEEK
          && item.payload.data.destination
            === "home_availability"
      )
    );
  }
);


test(
  "2 joueurs disponibles alimentent le Home mais ne déclenchent aucun push",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            notificationsEnabled:
              true,
          },

          "users/user_b": {
            pseudo:
              "Mehdi",
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},
          "users/user_b/fcmTokens/token_b": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_b": {
            groupId:
              "group_1",
            userId:
              "user_b",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groups/group_1": {
            name:
              "Potes Padel",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid:
              "user_b",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.set(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,

            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],

            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      );

    assert.equal(
      result
        .matchNotifications
        .attempted,
      0
    );

    assert.equal(
      result
        .matchNotifications
        .sent,
      0
    );

    assert.equal(
      env.notifications.length,
      0
    );

    const home =
      await callables.home(
        authRequest(
          "user_a",
          {
            weekKey:
              WEEK,
          }
        )
      );

    assert.ok(
      home.opportunities
        .some(
          (item) =>
            item.groupId
              === "group_1"
            && item.totalAvailable
              === 2
        )
    );
  }
);


test(
  "rejouer exactement les mêmes disponibilités ne renvoie pas les notifications",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            notificationsEnabled:
              true,
          },

          "users/user_b": {
            pseudo:
              "Mehdi",
            notificationsEnabled:
              true,
          },

          "users/user_c": {
            pseudo:
              "Karim",
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},
          "users/user_b/fcmTokens/token_b": {},
          "users/user_c/fcmTokens/token_c": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_b": {
            groupId:
              "group_1",
            userId:
              "user_b",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_c": {
            groupId:
              "group_1",
            userId:
              "user_c",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groups/group_1": {
            name:
              "Potes Padel",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid:
              "user_b",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_c`]: {
            uid:
              "user_c",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Karim",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const request =
      authRequest(
        "user_a",
        {
          weekKey: WEEK,

          slots: [
            {
              weekday: 4,
              startMinutes: 1200,
              endMinutes: 1320,
            },
          ],

          sharedGroupIds: [
            "group_1",
          ],
        }
      );

    const first =
      await callables.set(
        request
      );

    assert.equal(
      first
        .matchNotifications
        .sent,
      3
    );

    assert.equal(
      env.notifications.length,
      3
    );

    const second =
      await callables.set(
        request
      );

    assert.equal(
      second
        .matchNotifications
        .attempted,
      0
    );

    assert.equal(
      second
        .matchNotifications
        .sent,
      0
    );

    assert.equal(
      env.notifications.length,
      3
    );
  }
);


test(
  "un joueur avec notifications globales désactivées ne reçoit aucun push Ça matche",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            notificationsEnabled:
              true,
          },

          "users/user_b": {
            pseudo:
              "Mehdi",
            notificationsEnabled:
              false,
          },

          "users/user_c": {
            pseudo:
              "Karim",
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},
          "users/user_b/fcmTokens/token_b": {},
          "users/user_c/fcmTokens/token_c": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_b": {
            groupId:
              "group_1",
            userId:
              "user_b",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groupMemberships/group_1_user_c": {
            groupId:
              "group_1",
            userId:
              "user_c",
            status:
              "active",
            notificationsEnabled:
              true,
          },

          "groups/group_1": {
            name:
              "Potes Padel",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid:
              "user_b",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_c`]: {
            uid:
              "user_c",
            groupId:
              "group_1",
            weekKey:
              WEEK,
            pseudoSnapshot:
              "Karim",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.set(
        authRequest(
          "user_a",
          {
            weekKey:
              WEEK,

            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],

            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      );

    assert.equal(
      result
        .matchNotifications
        .attempted,
      3
    );

    assert.equal(
      result
        .matchNotifications
        .sent,
      2
    );

    assert.equal(
      env.notifications.length,
      2
    );

    assert.ok(
      env.notifications.every(
        (item) =>
          !item.tokens.includes(
            "token_b"
          )
      )
    );

    assert.ok(
      env.tokenRequests.includes(
        "user_b"
      )
    );

    const noTokenRecord =
      [...env.store.entries()]
        .find(
          ([path, data]) =>
            path.startsWith(
              "weeklyAvailabilityNotifications/"
            )
            && data
              ?.recipientUid
              === "user_b"
        );

    assert.ok(
      noTokenRecord
    );

    assert.equal(
      noTokenRecord[1].status,
      "no_tokens"
    );
  }
);


test(
  "une ancienne diffusion d'un joueur qui a quitté le groupe ne compte plus dans les overlaps",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo: "Jeremie",
            notificationsEnabled: true,
          },

          "users/user_b": {
            pseudo: "Mehdi",
            notificationsEnabled: true,
          },

          "users/user_c": {
            pseudo: "Karim",
            notificationsEnabled: true,
          },

          "users/user_a/fcmTokens/token_a": {},
          "users/user_b/fcmTokens/token_b": {},
          "users/user_c/fcmTokens/token_c": {},

          "groupMemberships/group_1_user_a": {
            groupId: "group_1",
            userId: "user_a",
            status: "active",
            notificationsEnabled: true,
          },

          "groupMemberships/group_1_user_b": {
            groupId: "group_1",
            userId: "user_b",
            status: "active",
            notificationsEnabled: true,
          },

          "groupMemberships/group_1_user_c": {
            groupId: "group_1",
            userId: "user_c",
            status: "left",
            notificationsEnabled: true,
          },

          "groups/group_1": {
            name: "Potes Padel",
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_b`]: {
            uid: "user_b",
            groupId: "group_1",
            weekKey: WEEK,
            pseudoSnapshot: "Mehdi",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },

          [`weeklyAvailabilityShares/${WEEK}_group_1_user_c`]: {
            uid: "user_c",
            groupId: "group_1",
            weekKey: WEEK,
            pseudoSnapshot: "Karim",
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
          },
        },
      });

    const callables =
      buildCallables(env);

    const result =
      await callables.set(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,

            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],

            sharedGroupIds: [
              "group_1",
            ],
          }
        )
      );

    // user_c a quitté : A + B = seulement 2.
    assert.equal(
      result
        .matchNotifications
        .attempted,
      0
    );

    assert.equal(
      env.notifications.length,
      0
    );

    const home =
      await callables.home(
        authRequest(
          "user_a",
          {
            weekKey: WEEK,
          }
        )
      );

    assert.ok(
      home.opportunities.length > 0
    );

    assert.equal(
      home.opportunities[0]
        .totalAvailable,
      2
    );

    assert.ok(
      home.opportunities.every(
        (item) =>
          item.availablePlayers.every(
            (player) =>
              player.uid !== "user_c"
          )
      )
    );
  }
);


function buildReminderCron(
  env,
  {
    now =
      new Date(
        "2026-10-12T07:00:00.000Z"
      ),
  } = {}
) {
  let scheduleOptions = null;

  function onSchedule(
    options,
    handler
  ) {
    scheduleOptions =
      options;

    return handler;
  }

  const cron =
    buildWeeklyAvailabilityReminderCron({
      onSchedule,

      runtime:
        env.runtime,

      db:
        env.db,

      FieldValue:
        env.FieldValue,

      tokensOf:
        env.tokensOf,

      sendVisibleHybrid:
        env.sendVisibleHybrid,

      logger:
        env.logger,

      nowProvider:
        () => now,
    });

  return {
    cron,

    get scheduleOptions() {
      return scheduleOptions;
    },
  };
}


test(
  "weekKeyForDate calcule le lundi de la semaine en heure de Paris",
  () => {
    assert.equal(
      weekKeyForDate(
        new Date(
          "2026-10-15T12:00:00.000Z"
        )
      ),
      "2026-10-12"
    );

    /*
     * 18 octobre 22h30 UTC =
     * 19 octobre 00h30 à Paris.
     * On doit donc basculer sur
     * la semaine du lundi 19.
     */
    assert.equal(
      weekKeyForDate(
        new Date(
          "2026-10-18T22:30:00.000Z"
        )
      ),
      "2026-10-19"
    );
  }
);


test(
  "le cron weekly availability est planifié lundi 9h heure de Paris",
  () => {
    const env =
      createEnvironment();

    const reminder =
      buildReminderCron(env);

    assert.equal(
      reminder
        .scheduleOptions
        .schedule,
      "0 9 * * 1"
    );

    assert.equal(
      reminder
        .scheduleOptions
        .timeZone,
      "Europe/Paris"
    );
  }
);


test(
  "un membre actif sans disponibilité reçoit un seul rappel hebdomadaire",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            pseudo:
              "Jeremie",
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },
        },
      });

    const reminder =
      buildReminderCron(env);

    const result =
      await reminder.cron();

    assert.equal(
      result.weekKey,
      WEEK
    );

    assert.equal(
      result.uniqueUsers,
      1
    );

    assert.equal(
      result.eligible,
      1
    );

    assert.equal(
      result.attempted,
      1
    );

    assert.equal(
      result.sent,
      1
    );

    assert.equal(
      env.notifications.length,
      1
    );

    assert.deepEqual(
      env.notifications[0]
        .tokens,
      [
        "token_a",
      ]
    );

    assert.equal(
      env.notifications[0]
        .payload
        .data
        .type,
      "weekly_availability"
    );

    assert.equal(
      env.notifications[0]
        .payload
        .data
        .subtype,
      "weekly_reminder"
    );

    assert.equal(
      env.notifications[0]
        .payload
        .data
        .destination,
      "availability_editor"
    );

    const record =
      env.document(
        `weeklyAvailabilityNotifications/weekly_reminder__${WEEK}__user_a`
      );

    assert.equal(
      record.status,
      "sent"
    );
  }
);


test(
  "plusieurs memberships actifs du même joueur produisent un seul rappel",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },

          "groupMemberships/group_2_user_a": {
            groupId:
              "group_2",
            userId:
              "user_a",
            status:
              "active",
          },
        },
      });

    const reminder =
      buildReminderCron(env);

    const result =
      await reminder.cron();

    assert.equal(
      result.uniqueUsers,
      1
    );

    assert.equal(
      result.sent,
      1
    );

    assert.equal(
      env.notifications.length,
      1
    );
  }
);


test(
  "un joueur ayant déjà renseigné ses disponibilités ne reçoit pas le rappel",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },

          [`weeklyAvailabilities/user_a_${WEEK}`]: {
            uid:
              "user_a",
            weekKey:
              WEEK,
            slots: [
              {
                weekday: 4,
                startMinutes: 1200,
                endMinutes: 1320,
              },
            ],
            sharedGroupIds: [
              "group_1",
            ],
          },
        },
      });

    const reminder =
      buildReminderCron(env);

    const result =
      await reminder.cron();

    assert.equal(
      result.uniqueUsers,
      1
    );

    assert.equal(
      result.eligible,
      0
    );

    assert.equal(
      result.attempted,
      0
    );

    assert.equal(
      result.sent,
      0
    );

    assert.equal(
      env.notifications.length,
      0
    );
  }
);


test(
  "rejouer le cron la même semaine ne renvoie jamais le même rappel",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            notificationsEnabled:
              true,
          },

          "users/user_a/fcmTokens/token_a": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },
        },
      });

    const reminder =
      buildReminderCron(env);

    const first =
      await reminder.cron();

    assert.equal(
      first.sent,
      1
    );

    assert.equal(
      env.notifications.length,
      1
    );

    const second =
      await reminder.cron();

    assert.equal(
      second.attempted,
      0
    );

    assert.equal(
      second.sent,
      0
    );

    assert.equal(
      env.notifications.length,
      1
    );
  }
);


test(
  "notifications globales désactivées signifie aucun push de rappel",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "users/user_a": {
            notificationsEnabled:
              false,
          },

          "users/user_a/fcmTokens/token_a": {},

          "groupMemberships/group_1_user_a": {
            groupId:
              "group_1",
            userId:
              "user_a",
            status:
              "active",
          },
        },
      });

    const reminder =
      buildReminderCron(env);

    const result =
      await reminder.cron();

    assert.equal(
      result.eligible,
      1
    );

    assert.equal(
      result.attempted,
      1
    );

    assert.equal(
      result.sent,
      0
    );

    assert.equal(
      env.notifications.length,
      0
    );

    const record =
      env.document(
        `weeklyAvailabilityNotifications/weekly_reminder__${WEEK}__user_a`
      );

    assert.equal(
      record.status,
      "no_tokens"
    );
  }
);
