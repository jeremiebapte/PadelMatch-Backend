import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSetMatchReservation,
  buildConfirmMatchReservation,
  buildUnconfirmMatchReservation,
  buildClearMatchReservation,
} from "../matchCompletion.js";


class FakeHttpsError extends Error {
  constructor(
    code,
    message,
    details
  ) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}


function clone(value) {
  if (
    value === undefined
    || value === null
  ) {
    return value;
  }

  return structuredClone(value);
}


function createEnvironment({
  initialDocuments = {},
} = {}) {
  const store = new Map();
  const writes = [];
  const notifications = [];
  const tokenRequests = [];

  let clock = Date.now() + 100_000;

  for (
    const [path, data]
    of Object.entries(initialDocuments)
  ) {
    store.set(
      path,
      clone(data)
    );
  }


  function ref(path) {
    const parts =
      path.split("/");

    return {
      path,
      id:
        parts[
          parts.length - 1
        ],

      async get() {
        return snapshot(this);
      },
    };
  }


  function snapshot(reference) {
    const exists =
      store.has(reference.path);

    const data =
      exists
        ? clone(
            store.get(reference.path)
          )
        : undefined;

    return {
      id:
        reference.id,

      exists,

      data() {
        return data;
      },

      get(field) {
        return data?.[field];
      },

      ref: reference,
    };
  }


  function applyPatch(
    previous,
    patch
  ) {
    const next =
      clone(previous ?? {});

    for (
      const [key, value]
      of Object.entries(patch)
    ) {
      if (
        !key.includes(".")
      ) {
        next[key] =
          clone(value);

        continue;
      }

      const segments =
        key.split(".");

      let cursor = next;

      for (
        let index = 0;
        index < segments.length - 1;
        index += 1
      ) {
        const segment =
          segments[index];

        if (
          !cursor[segment]
          || typeof cursor[segment]
            !== "object"
          || Array.isArray(
            cursor[segment]
          )
        ) {
          cursor[segment] = {};
        }

        cursor =
          cursor[segment];
      }

      cursor[
        segments[
          segments.length - 1
        ]
      ] = clone(value);
    }

    return next;
  }


  const db = {
    collection(name) {
      return {
        doc(id) {
          return ref(
            `${name}/${id}`
          );
        },
      };
    },

    async runTransaction(
      callback
    ) {
      const transaction = {
        async get(reference) {
          return snapshot(
            reference
          );
        },

        update(
          reference,
          patch
        ) {
          if (
            !store.has(
              reference.path
            )
          ) {
            throw new Error(
              `UPDATE_MISSING:${reference.path}`
            );
          }

          store.set(
            reference.path,
            applyPatch(
              store.get(
                reference.path
              ),
              patch
            )
          );

          writes.push({
            operation:
              "update",
            path:
              reference.path,
            data:
              clone(patch),
          });
        },
      };

      return callback(
        transaction
      );
    },
  };


  const FieldValue = {
    serverTimestamp() {
      clock += 1;

      return clock;
    },
  };


  function onCall(
    _runtime,
    handler
  ) {
    return handler;
  }


  async function tokensOf(uid) {
    tokenRequests.push(uid);

    return [
      `token_${uid}`,
    ];
  }


  async function sendVisibleHybrid(
    tokens,
    payload
  ) {
    notifications.push({
      tokens:
        clone(tokens),
      payload:
        clone(payload),
    });
  }


  function document(path) {
    return clone(
      store.get(path)
    );
  }


  return {
    db,
    FieldValue,
    onCall,
    HttpsError:
      FakeHttpsError,
    runtime: {
      region:
        "europe-west1",
    },

    tokensOf,
    sendVisibleHybrid,

    logger: {
      warn() {},
    },

    writes,
    notifications,
    tokenRequests,
    document,
  };
}


function buildCallables(env) {
  return {
    setMatchReservation:
      buildSetMatchReservation({
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
        tokensOf:
          env.tokensOf,
        sendVisibleHybrid:
          env.sendVisibleHybrid,
        logger:
          env.logger,
      }),

    confirmMatchReservation:
      buildConfirmMatchReservation({
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
        tokensOf:
          env.tokensOf,
        sendVisibleHybrid:
          env.sendVisibleHybrid,
        logger:
          env.logger,
      }),

    unconfirmMatchReservation:
      buildUnconfirmMatchReservation({
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
      }),

    clearMatchReservation:
      buildClearMatchReservation({
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
      }),
  };
}


function futureDate() {
  return (
    Date.now()
    + 24 * 60 * 60 * 1000
  );
}


function fullMatch(
  overrides = {}
) {
  return {
    createurUid:
      "owner_1",

    dateHeure:
      futureDate(),

    lieu:
      "4PADEL",

    capacity:
      4,

    participants: [
      "owner_1",
      "player_2",
      "player_3",
      "player_4",
    ],

    ...overrides,
  };
}


async function expectHttpsError(
  promise,
  code,
  message = null
) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(
        error.name,
        "HttpsError"
      );

      assert.equal(
        error.code,
        code
      );

      if (message) {
        assert.equal(
          error.message,
          message
        );
      }

      return true;
    }
  );
}


test(
  "setMatchReservation exige auth",
  async () => {
    const env =
      createEnvironment();

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      setMatchReservation({
        auth: null,
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "https://4padel.fr/r/abc",
        },
      }),
      "unauthenticated"
    );
  }
);


test(
  "setMatchReservation refuse URL non HTTPS",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch(),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      setMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "http://4padel.fr/r/abc",
        },
      }),
      "invalid-argument",
      "RESERVATION_URL_MUST_BE_HTTPS"
    );
  }
);


test(
  "seul le créateur peut publier la réservation",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch(),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      setMatchReservation({
        auth: {
          uid: "player_2",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "https://4padel.fr/r/abc",
        },
      }),
      "permission-denied"
    );
  }
);


test(
  "la réservation exige un match complet",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              participants: [
                "owner_1",
                "player_2",
                "player_3",
              ],
            }),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      setMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "https://4padel.fr/r/abc",
        },
      }),
      "failed-precondition",
      "MATCH_NOT_FULL"
    );
  }
);


test(
  "setMatchReservation détecte 4padel et confirme automatiquement le créateur",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch(),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    const result =
      await setMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "https://www.4padel.fr/reservation/abc",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.changed,
      true
    );

    const match =
      env.document(
        "matches/match_1"
      );

    assert.equal(
      match.completion
        .reservationStatus,
      "reserved"
    );

    assert.equal(
      match.completion
        .reservationProvider,
      "4padel"
    );

    assert.deepEqual(
      match.completion
        .reservationConfirmedUids,
      [
        "owner_1",
      ]
    );
  }
);


test(
  "setMatchReservation détecte matchi anybuddy et external",
  async () => {
    const cases = [
      [
        "https://www.matchi.se/facilities/test",
        "matchi",
      ],
      [
        "https://anybuddyapp.com/reservation/123",
        "anybuddy",
      ],
      [
        "https://club-example.fr/reservation/123",
        "external",
      ],
    ];

    for (
      const [
        url,
        expectedProvider,
      ] of cases
    ) {
      const env =
        createEnvironment({
          initialDocuments: {
            "matches/match_1":
              fullMatch(),
          },
        });

      const {
        setMatchReservation,
      } =
        buildCallables(env);

      await setMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            url,
        },
      });

      assert.equal(
        env.document(
          "matches/match_1"
        ).completion
          .reservationProvider,
        expectedProvider
      );
    }
  }
);


test(
  "le partage notifie uniquement les vrais participants hors créateur",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              participants: [
                "owner_1",
                "player_2",
                "ami_de_player_2_Lucas",
                "player_4",
              ],
            }),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    const result =
      await setMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          reservationUrl:
            "https://4padel.fr/r/abc",
        },
      });

    assert.deepEqual(
      env.tokenRequests,
      [
        "player_2",
        "player_4",
      ]
    );

    assert.equal(
      env.notifications.length,
      2
    );

    assert.equal(
      result.notifiedUserCount,
      2
    );

    for (
      const notification
      of env.notifications
    ) {
      assert.equal(
        notification.payload
          .data.subtype,
        "reservation_shared"
      );
    }
  }
);


test(
  "rejouer setMatchReservation avec le même lien est idempotent",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch(),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    const request = {
      auth: {
        uid: "owner_1",
      },
      data: {
        matchId:
          "match_1",
        reservationUrl:
          "https://4padel.fr/r/abc",
      },
    };

    await setMatchReservation(
      request
    );

    const writesAfterFirst =
      env.writes.length;

    const notificationsAfterFirst =
      env.notifications.length;

    const second =
      await setMatchReservation(
        request
      );

    assert.equal(
      second.changed,
      false
    );

    assert.equal(
      env.writes.length,
      writesAfterFirst
    );

    assert.equal(
      env.notifications.length,
      notificationsAfterFirst
    );
  }
);


test(
  "remplacer le lien réinitialise les confirmations sauf créateur",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://old.example/reservation",
                reservationProvider:
                  "external",
                reservationConfirmedUids: [
                  "owner_1",
                  "player_2",
                  "player_3",
                ],
              },
            }),
        },
      });

    const {
      setMatchReservation,
    } =
      buildCallables(env);

    await setMatchReservation({
      auth: {
        uid: "owner_1",
      },
      data: {
        matchId:
          "match_1",
        reservationUrl:
          "https://4padel.fr/new-link",
      },
    });

    const completion =
      env.document(
        "matches/match_1"
      ).completion;

    assert.deepEqual(
      completion
        .reservationConfirmedUids,
      [
        "owner_1",
      ]
    );

    assert.equal(
      completion
        .reservationProvider,
      "4padel"
    );
  }
);


test(
  "confirmMatchReservation refuse un non participant",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                ],
              },
            }),

          "users/outsider": {
            pseudo:
              "Outsider",
          },
        },
      });

    const {
      confirmMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      confirmMatchReservation({
        auth: {
          uid: "outsider",
        },
        data: {
          matchId:
            "match_1",
        },
      }),
      "permission-denied",
      "NOT_MATCH_PARTICIPANT"
    );
  }
);


test(
  "un participant peut confirmer et le créateur est notifié",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                ],
              },
            }),

          "users/player_2": {
            pseudo:
              "Walid",
          },
        },
      });

    const {
      confirmMatchReservation,
    } =
      buildCallables(env);

    const result =
      await confirmMatchReservation({
        auth: {
          uid: "player_2",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      result.confirmedCount,
      2
    );

    assert.equal(
      result.confirmableCount,
      4
    );

    assert.deepEqual(
      env.document(
        "matches/match_1"
      ).completion
        .reservationConfirmedUids,
      [
        "owner_1",
        "player_2",
      ]
    );

    assert.deepEqual(
      env.tokenRequests,
      [
        "owner_1",
      ]
    );

    assert.equal(
      env.notifications[0]
        .payload.body,
      "Walid a rejoint la réservation (2/4)."
    );
  }
);


test(
  "confirmMatchReservation est idempotent",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                  "player_2",
                ],
              },
            }),

          "users/player_2": {
            pseudo:
              "Walid",
          },
        },
      });

    const {
      confirmMatchReservation,
    } =
      buildCallables(env);

    const result =
      await confirmMatchReservation({
        auth: {
          uid: "player_2",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.changed,
      false
    );

    assert.equal(
      result.confirmedCount,
      2
    );

    assert.equal(
      env.writes.length,
      0
    );

    assert.equal(
      env.notifications.length,
      0
    );
  }
);


test(
  "allConfirmed ignore les placeholders ami_de",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              participants: [
                "owner_1",
                "player_2",
                "ami_de_player_2_Lucas",
                "player_4",
              ],

              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                  "player_2",
                ],
              },
            }),

          "users/player_4": {
            pseudo:
              "Marcio",
          },
        },
      });

    const {
      confirmMatchReservation,
    } =
      buildCallables(env);

    const result =
      await confirmMatchReservation({
        auth: {
          uid: "player_4",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.confirmableCount,
      3
    );

    assert.equal(
      result.confirmedCount,
      3
    );

    assert.equal(
      result.allConfirmed,
      true
    );
  }
);


test(
  "un participant peut retirer sa confirmation",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                  "player_2",
                  "player_3",
                ],
              },
            }),
        },
      });

    const {
      unconfirmMatchReservation,
    } =
      buildCallables(env);

    const result =
      await unconfirmMatchReservation({
        auth: {
          uid: "player_2",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.deepEqual(
      env.document(
        "matches/match_1"
      ).completion
        .reservationConfirmedUids,
      [
        "owner_1",
        "player_3",
      ]
    );
  }
);


test(
  "le créateur ne peut pas retirer sa propre confirmation",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                ],
              },
            }),
        },
      });

    const {
      unconfirmMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      unconfirmMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
        },
      }),
      "failed-precondition",
      "CREATOR_CONFIRMATION_LOCKED"
    );
  }
);


test(
  "seul le créateur peut supprimer la réservation",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationConfirmedUids: [
                  "owner_1",
                ],
              },
            }),
        },
      });

    const {
      clearMatchReservation,
    } =
      buildCallables(env);

    await expectHttpsError(
      clearMatchReservation({
        auth: {
          uid: "player_2",
        },
        data: {
          matchId:
            "match_1",
        },
      }),
      "permission-denied"
    );
  }
);


test(
  "clearMatchReservation remet le flow en attente",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            fullMatch({
              completion: {
                reservationStatus:
                  "reserved",
                reservationUrl:
                  "https://4padel.fr/r/abc",
                reservationProvider:
                  "4padel",
                reservationSharedAt:
                  123,
                reservationSharedByUid:
                  "owner_1",
                reservationConfirmedUids: [
                  "owner_1",
                  "player_2",
                ],
              },
            }),
        },
      });

    const {
      clearMatchReservation,
    } =
      buildCallables(env);

    const result =
      await clearMatchReservation({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.changed,
      true
    );

    assert.deepEqual(
      env.document(
        "matches/match_1"
      ).completion,
      {
        reservationStatus:
          "awaiting_reservation",

        reservationUrl:
          null,

        reservationProvider:
          null,

        reservationSharedAt:
          null,

        reservationSharedByUid:
          null,

        reservationConfirmedUids:
          [],
      }
    );
  }
);


test(
  "reconciliation retire la confirmation du joueur qui quitte sans supprimer la réservation",
  async () => {
    const {
      reconcileMatchCompletionAfterParticipantsChange,
    } = await import(
      "../matchCompletion.js"
    );

    const completion = {
      reservationStatus:
        "reserved",

      reservationUrl:
        "https://4padel.fr/r/abc",

      reservationProvider:
        "4padel",

      reservationSharedByUid:
        "owner_1",

      reservationConfirmedUids: [
        "owner_1",
        "player_2",
        "player_3",
      ],
    };

    const result =
      reconcileMatchCompletionAfterParticipantsChange({
        completion,

        participants: [
          "owner_1",
          "player_3",
          "player_4",
        ],
      });

    assert.equal(
      result.changed,
      true
    );

    assert.deepEqual(
      result.reservationConfirmedUids,
      [
        "owner_1",
        "player_3",
      ]
    );

    assert.equal(
      completion.reservationUrl,
      "https://4padel.fr/r/abc"
    );

    assert.equal(
      completion.reservationStatus,
      "reserved"
    );
  }
);


test(
  "reconciliation ignore les placeholders ami_de",
  async () => {
    const {
      reconcileMatchCompletionAfterParticipantsChange,
    } = await import(
      "../matchCompletion.js"
    );

    const result =
      reconcileMatchCompletionAfterParticipantsChange({
        completion: {
          reservationStatus:
            "reserved",

          reservationConfirmedUids: [
            "owner_1",
            "player_2",
            "ami_de_player_2_Lucas",
          ],
        },

        participants: [
          "owner_1",
          "player_2",
          "ami_de_player_2_Lucas",
        ],
      });

    assert.equal(
      result.changed,
      true
    );

    assert.deepEqual(
      result.reservationConfirmedUids,
      [
        "owner_1",
        "player_2",
      ]
    );
  }
);


test(
  "reconciliation ne modifie rien sans réservation active",
  async () => {
    const {
      reconcileMatchCompletionAfterParticipantsChange,
    } = await import(
      "../matchCompletion.js"
    );

    const result =
      reconcileMatchCompletionAfterParticipantsChange({
        completion: {
          reservationStatus:
            "awaiting_reservation",

          reservationConfirmedUids: [
            "owner_1",
            "player_2",
          ],
        },

        participants: [
          "owner_1",
        ],
      });

    assert.equal(
      result.changed,
      false
    );

    assert.deepEqual(
      result.reservationConfirmedUids,
      [
        "owner_1",
        "player_2",
      ]
    );
  }
);


test(
  "match nouvellement complet notifie le créateur de réserver",
  async () => {
    const {
      buildNotifyMatchCompletionAfterJoin,
    } = await import(
      "../matchCompletion.js"
    );

    const notifications = [];
    const requestedUids = [];

    const notify =
      buildNotifyMatchCompletionAfterJoin({
        async tokensOf(uid) {
          requestedUids.push(uid);
          return [
            `token_${uid}`,
          ];
        },

        async sendVisibleHybrid(
          tokens,
          payload
        ) {
          notifications.push({
            tokens,
            payload,
          });
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await notify({
        matchId:
          "match_1",

        joinedUid:
          "player_4",

        becameFull:
          true,

        match: {
          createurUid:
            "owner_1",

          lieu:
            "4PADEL",

          participants: [
            "owner_1",
            "player_2",
            "player_3",
            "player_4",
          ],
        },
      });

    assert.equal(
      result.type,
      "reservation_required"
    );

    assert.deepEqual(
      requestedUids,
      [
        "owner_1",
      ]
    );

    assert.equal(
      notifications.length,
      1
    );

    assert.equal(
      notifications[0]
        .payload.data.subtype,
      "reservation_required"
    );
  }
);


test(
  "remplaçant rejoint un match avec terrain réservé et reçoit la notif",
  async () => {
    const {
      buildNotifyMatchCompletionAfterJoin,
    } = await import(
      "../matchCompletion.js"
    );

    const notifications = [];
    const requestedUids = [];

    const notify =
      buildNotifyMatchCompletionAfterJoin({
        async tokensOf(uid) {
          requestedUids.push(uid);
          return [
            `token_${uid}`,
          ];
        },

        async sendVisibleHybrid(
          tokens,
          payload
        ) {
          notifications.push({
            tokens,
            payload,
          });
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await notify({
        matchId:
          "match_1",

        joinedUid:
          "replacement_4",

        becameFull:
          true,

        match: {
          createurUid:
            "owner_1",

          lieu:
            "4PADEL",

          participants: [
            "owner_1",
            "player_2",
            "player_3",
            "replacement_4",
          ],

          completion: {
            reservationStatus:
              "reserved",

            reservationUrl:
              "https://4padel.fr/r/abc",

            reservationProvider:
              "4padel",

            reservationConfirmedUids: [
              "owner_1",
              "player_2",
              "player_3",
            ],
          },
        },
      });

    assert.equal(
      result.type,
      "reservation_available"
    );

    assert.deepEqual(
      requestedUids,
      [
        "replacement_4",
      ]
    );

    assert.equal(
      notifications.length,
      1
    );

    assert.equal(
      notifications[0]
        .payload.data.subtype,
      "reservation_available"
    );
  }
);


test(
  "terrain déjà réservé évite la notif reservation_required au créateur",
  async () => {
    const {
      buildNotifyMatchCompletionAfterJoin,
    } = await import(
      "../matchCompletion.js"
    );

    const requestedUids = [];

    const notify =
      buildNotifyMatchCompletionAfterJoin({
        async tokensOf(uid) {
          requestedUids.push(uid);
          return [];
        },

        async sendVisibleHybrid() {},

        logger: {
          warn() {},
        },
      });

    await notify({
      matchId:
        "match_1",

      joinedUid:
        "replacement_4",

      becameFull:
        true,

      match: {
        createurUid:
          "owner_1",

        completion: {
          reservationStatus:
            "reserved",

          reservationUrl:
            "https://4padel.fr/r/abc",
        },
      },
    });

    assert.deepEqual(
      requestedUids,
      [
        "replacement_4",
      ]
    );
  }
);


test(
  "join sans match complet ni réservation ne déclenche rien",
  async () => {
    const {
      buildNotifyMatchCompletionAfterJoin,
    } = await import(
      "../matchCompletion.js"
    );

    const requestedUids = [];

    const notify =
      buildNotifyMatchCompletionAfterJoin({
        async tokensOf(uid) {
          requestedUids.push(uid);
          return [];
        },

        async sendVisibleHybrid() {},

        logger: {
          warn() {},
        },
      });

    const result =
      await notify({
        matchId:
          "match_1",

        joinedUid:
          "player_2",

        becameFull:
          false,

        match: {
          createurUid:
            "owner_1",
        },
      });

    assert.equal(
      result.type,
      null
    );

    assert.equal(
      result.sentUserCount,
      0
    );

    assert.deepEqual(
      requestedUids,
      []
    );
  }
);
