import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecordMatchView,
  buildGetMatchViewers,
} from "../matchViews.js";


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
  const store = new Map();
  const writes = [];

  let clock = 1_000;

  for (
    const [
      path,
      data,
    ] of Object.entries(
      initialDocuments
    )
  ) {
    store.set(
      path,
      clone(data)
    );
  }


  function snapshot(
    reference
  ) {
    const exists =
      store.has(reference.path);

    const data =
      exists
        ? clone(
            store.get(reference.path)
          )
        : undefined;

    return {
      id: reference.id,
      exists,
      data: () => data,
      ref: reference,
    };
  }


  function documentReference(
    path
  ) {
    const parts =
      path.split("/");

    const id =
      parts[parts.length - 1];

    return {
      id,
      path,

      collection(
        collectionName
      ) {
        return collectionReference(
          `${path}/${collectionName}`
        );
      },

      async get() {
        return snapshot(this);
      },
    };
  }


  function queryForCollection(
    collectionPath,
    {
      orderField = null,
      orderDirection = "asc",
      limitValue = null,
    } = {}
  ) {
    return {
      __query: true,
      collectionPath,
      orderField,
      orderDirection,
      limitValue,

      orderBy(
        field,
        direction = "asc"
      ) {
        return queryForCollection(
          collectionPath,
          {
            orderField: field,
            orderDirection: direction,
            limitValue,
          }
        );
      },

      limit(
        value
      ) {
        return queryForCollection(
          collectionPath,
          {
            orderField,
            orderDirection,
            limitValue: value,
          }
        );
      },

      async get() {
        return querySnapshot(
          this
        );
      },
    };
  }


  function collectionReference(
    collectionPath
  ) {
    return {
      path: collectionPath,

      doc(id) {
        if (!id) {
          throw new Error(
            `AUTO_ID_NOT_SUPPORTED:${collectionPath}`
          );
        }

        return documentReference(
          `${collectionPath}/${id}`
        );
      },

      orderBy(
        field,
        direction = "asc"
      ) {
        return queryForCollection(
          collectionPath,
          {
            orderField: field,
            orderDirection: direction,
          }
        );
      },

      limit(
        value
      ) {
        return queryForCollection(
          collectionPath,
          {
            limitValue: value,
          }
        );
      },
    };
  }


  function querySnapshot(
    query
  ) {
    const prefix =
      `${query.collectionPath}/`;

    let rows =
      [...store.entries()]
        .filter(
          ([
            path,
          ]) => {
            if (
              !path.startsWith(
                prefix
              )
            ) {
              return false;
            }

            const remainder =
              path.slice(
                prefix.length
              );

            return !remainder.includes(
              "/"
            );
          }
        )
        .map(([
          path,
        ]) =>
          snapshot(
            documentReference(path)
          )
        );

    if (query.orderField) {
      rows.sort(
        (
          left,
          right
        ) => {
          const leftValue =
            left.data()?.[
              query.orderField
            ];

          const rightValue =
            right.data()?.[
              query.orderField
            ];

          const a =
            typeof leftValue ===
              "number"
              ? leftValue
              : 0;

          const b =
            typeof rightValue ===
              "number"
              ? rightValue
              : 0;

          if (
            query.orderDirection
            === "desc"
          ) {
            return b - a;
          }

          return a - b;
        }
      );
    }

    if (
      Number.isInteger(
        query.limitValue
      )
    ) {
      rows =
        rows.slice(
          0,
          query.limitValue
        );
    }

    return {
      empty:
        rows.length === 0,
      size:
        rows.length,
      docs:
        rows,
    };
  }


  const db = {
    collection(
      collectionName
    ) {
      return collectionReference(
        collectionName
      );
    },

    async runTransaction(
      callback
    ) {
      const transaction = {
        async get(
          reference
        ) {
          if (
            reference?.__query
          ) {
            return querySnapshot(
              reference
            );
          }

          return snapshot(
            reference
          );
        },

        set(
          reference,
          data,
          options = {}
        ) {
          const previous =
            store.get(
              reference.path
            );

          const next =
            options.merge
              ? {
                  ...(
                    previous
                    ?? {}
                  ),
                  ...clone(data),
                }
              : clone(data);

          store.set(
            reference.path,
            next
          );

          writes.push({
            operation: "set",
            path:
              reference.path,
            data:
              clone(data),
            options:
              clone(options),
          });
        },

        update(
          reference,
          data
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

          const previous =
            store.get(
              reference.path
            );

          store.set(
            reference.path,
            {
              ...previous,
              ...clone(data),
            }
          );

          writes.push({
            operation:
              "update",
            path:
              reference.path,
            data:
              clone(data),
          });
        },
      };

      return callback(
        transaction
      );
    },

    async getAll(
      ...references
    ) {
      return references.map(
        (reference) =>
          snapshot(reference)
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


  function document(
    path
  ) {
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
    writes,
    document,
  };
}


function buildCallables(
  env
) {
  return {
    recordMatchView:
      buildRecordMatchView({
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

    getMatchViewers:
      buildGetMatchViewers({
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


async function expectHttpsError(
  promise,
  code
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

      return true;
    }
  );
}


test(
  "recordMatchView exige une authentification",
  async () => {
    const env =
      createEnvironment();

    const {
      recordMatchView,
    } =
      buildCallables(env);

    await expectHttpsError(
      recordMatchView({
        auth: null,
        data: {
          matchId:
            "match_1",
        },
      }),
      "unauthenticated"
    );
  }
);


test(
  "recordMatchView exige matchId",
  async () => {
    const env =
      createEnvironment();

    const {
      recordMatchView,
    } =
      buildCallables(env);

    await expectHttpsError(
      recordMatchView({
        auth: {
          uid: "viewer_1",
        },
        data: {},
      }),
      "invalid-argument"
    );
  }
);


test(
  "recordMatchView refuse un match inexistant",
  async () => {
    const env =
      createEnvironment();

    const {
      recordMatchView,
    } =
      buildCallables(env);

    await expectHttpsError(
      recordMatchView({
        auth: {
          uid: "viewer_1",
        },
        data: {
          matchId:
            "missing",
        },
      }),
      "not-found"
    );
  }
);


test(
  "le créateur ne compte jamais comme viewer",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
            participants: [
              "owner_1",
            ],
          },
        },
      });

    const {
      recordMatchView,
    } =
      buildCallables(env);

    const result =
      await recordMatchView({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.recorded,
      false
    );

    assert.equal(
      result.isCreator,
      true
    );

    assert.equal(
      result.uniqueViewCount,
      0
    );

    assert.equal(
      result.totalViewCount,
      0
    );

    assert.equal(
      env.document(
        "matchViews/match_1"
      ),
      undefined
    );

    assert.equal(
      env.document(
        "matchViews/match_1/users/owner_1"
      ),
      undefined
    );

    assert.equal(
      env.writes.length,
      0
    );
  }
);


test(
  "première ouverture crée une vue unique et une vue totale",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
            participants: [
              "owner_1",
            ],
          },
        },
      });

    const {
      recordMatchView,
    } =
      buildCallables(env);

    const result =
      await recordMatchView({
        auth: {
          uid: "viewer_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.recorded,
      true
    );

    assert.equal(
      result.isUnique,
      true
    );

    assert.equal(
      result.uniqueViewCount,
      1
    );

    assert.equal(
      result.totalViewCount,
      1
    );

    const stats =
      env.document(
        "matchViews/match_1"
      );

    assert.equal(
      stats.uniqueViewCount,
      1
    );

    assert.equal(
      stats.totalViewCount,
      1
    );

    const viewer =
      env.document(
        "matchViews/match_1/users/viewer_1"
      );

    assert.equal(
      viewer.uid,
      "viewer_1"
    );

    assert.equal(
      viewer.viewCount,
      1
    );

    assert.equal(
      viewer.firstViewedAt,
      viewer.lastViewedAt
    );
  }
);


test(
  "deuxième ouverture du même joueur incrémente seulement le total",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
          },
        },
      });

    const {
      recordMatchView,
    } =
      buildCallables(env);

    const first =
      await recordMatchView({
        auth: {
          uid: "viewer_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    const firstViewer =
      env.document(
        "matchViews/match_1/users/viewer_1"
      );

    const second =
      await recordMatchView({
        auth: {
          uid: "viewer_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    const secondViewer =
      env.document(
        "matchViews/match_1/users/viewer_1"
      );

    assert.equal(
      first.isUnique,
      true
    );

    assert.equal(
      second.isUnique,
      false
    );

    assert.equal(
      second.uniqueViewCount,
      1
    );

    assert.equal(
      second.totalViewCount,
      2
    );

    assert.equal(
      secondViewer.viewCount,
      2
    );

    assert.equal(
      secondViewer.firstViewedAt,
      firstViewer.firstViewedAt
    );

    assert.ok(
      secondViewer.lastViewedAt
      > firstViewer.lastViewedAt
    );
  }
);


test(
  "deux viewers différents donnent deux vues uniques",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
          },
        },
      });

    const {
      recordMatchView,
    } =
      buildCallables(env);

    await recordMatchView({
      auth: {
        uid: "viewer_1",
      },
      data: {
        matchId:
          "match_1",
      },
    });

    const result =
      await recordMatchView({
        auth: {
          uid: "viewer_2",
        },
        data: {
          matchId:
            "match_1",
      },
    });

    assert.equal(
      result.uniqueViewCount,
      2
    );

    assert.equal(
      result.totalViewCount,
      2
    );
  }
);


test(
  "recordMatchView ne modifie jamais matches/{matchId}",
  async () => {
    const originalMatch = {
      createurUid:
        "owner_1",
      participants: [
        "owner_1",
      ],
      lieu:
        "Padel Club",
    };

    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1":
            originalMatch,
        },
      });

    const {
      recordMatchView,
    } =
      buildCallables(env);

    await recordMatchView({
      auth: {
        uid: "viewer_1",
      },
      data: {
        matchId:
          "match_1",
      },
    });

    assert.deepEqual(
      env.document(
        "matches/match_1"
      ),
      originalMatch
    );

    assert.equal(
      env.writes.some(
        (write) =>
          write.path
          === "matches/match_1"
      ),
      false
    );
  }
);


test(
  "getMatchViewers est interdit à un non-créateur",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
          },
        },
      });

    const {
      getMatchViewers,
    } =
      buildCallables(env);

    await expectHttpsError(
      getMatchViewers({
        auth: {
          uid: "viewer_1",
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
  "getMatchViewers renvoie pseudo avatar niveau et état participant",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
            participants: [
              "owner_1",
              "viewer_joined",
              "ami_de_owner_1_1",
            ],
          },

          "matchViews/match_1": {
            matchId:
              "match_1",
            uniqueViewCount:
              2,
            totalViewCount:
              3,
          },

          "matchViews/match_1/users/viewer_joined": {
            uid:
              "viewer_joined",
            firstViewedAt:
              100,
            lastViewedAt:
              300,
            viewCount:
              2,
          },

          "matchViews/match_1/users/viewer_other": {
            uid:
              "viewer_other",
            firstViewedAt:
              150,
            lastViewedAt:
              200,
            viewCount:
              1,
          },

          "users/viewer_joined": {
            pseudo:
              "Walid92",
            photoUrl:
              "https://example.com/walid.jpg",
            niveau:
              6,
          },

          "users/viewer_other": {
            pseudo:
              "Marcio",
            avatar:
              "https://example.com/marcio.jpg",
            level:
              5,
          },
        },
      });

    const {
      getMatchViewers,
    } =
      buildCallables(env);

    const result =
      await getMatchViewers({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.uniqueViewCount,
      2
    );

    assert.equal(
      result.totalViewCount,
      3
    );

    assert.equal(
      result.viewers.length,
      2
    );

    assert.equal(
      result.viewers[0].uid,
      "viewer_joined"
    );

    assert.equal(
      result.viewers[0].pseudo,
      "Walid92"
    );

    assert.equal(
      result.viewers[0].avatarUrl,
      "https://example.com/walid.jpg"
    );

    assert.equal(
      result.viewers[0].level,
      6
    );

    assert.equal(
      result.viewers[0].viewCount,
      2
    );

    assert.equal(
      result.viewers[0].hasJoinedMatch,
      true
    );

    assert.equal(
      result.viewers[1].uid,
      "viewer_other"
    );

    assert.equal(
      result.viewers[1].hasJoinedMatch,
      false
    );
  }
);


test(
  "getMatchViewers trie les viewers du plus récent au plus ancien",
  async () => {
    const env =
      createEnvironment({
        initialDocuments: {
          "matches/match_1": {
            createurUid:
              "owner_1",
          },

          "matchViews/match_1": {
            uniqueViewCount:
              3,
            totalViewCount:
              3,
          },

          "matchViews/match_1/users/old": {
            lastViewedAt:
              100,
            viewCount:
              1,
          },

          "matchViews/match_1/users/recent": {
            lastViewedAt:
              900,
            viewCount:
              1,
          },

          "matchViews/match_1/users/middle": {
            lastViewedAt:
              500,
            viewCount:
              1,
          },

          "users/old": {
            pseudo: "Old",
          },

          "users/recent": {
            pseudo: "Recent",
          },

          "users/middle": {
            pseudo: "Middle",
          },
        },
      });

    const {
      getMatchViewers,
    } =
      buildCallables(env);

    const result =
      await getMatchViewers({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
        },
      });

    assert.deepEqual(
      result.viewers.map(
        (viewer) =>
          viewer.uid
      ),
      [
        "recent",
        "middle",
        "old",
      ]
    );
  }
);


test(
  "getMatchViewers borne la limite à 100",
  async () => {
    const initialDocuments = {
      "matches/match_1": {
        createurUid:
          "owner_1",
      },

      "matchViews/match_1": {
        uniqueViewCount:
          105,
        totalViewCount:
          105,
      },
    };

    for (
      let index = 0;
      index < 105;
      index += 1
    ) {
      const uid =
        `viewer_${index}`;

      initialDocuments[
        `matchViews/match_1/users/${uid}`
      ] = {
        lastViewedAt:
          index,
        viewCount:
          1,
      };

      initialDocuments[
        `users/${uid}`
      ] = {
        pseudo: uid,
      };
    }

    const env =
      createEnvironment({
        initialDocuments,
      });

    const {
      getMatchViewers,
    } =
      buildCallables(env);

    const result =
      await getMatchViewers({
        auth: {
          uid: "owner_1",
        },
        data: {
          matchId:
            "match_1",
          limit:
            10_000,
        },
      });

    assert.equal(
      result.viewers.length,
      100
    );

    assert.equal(
      result.viewers[0].uid,
      "viewer_104"
    );
  }
);
