import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

const PROJECT_ID =
  "padelmatch-32186";

const APPLY =
  process.argv.includes("--apply");


if (getApps().length === 0) {
  initializeApp({
    credential:
      applicationDefault(),

    projectId:
      PROJECT_ID,
  });
}

const db =
  getFirestore();


function cleanUid(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const cleaned =
    value.trim();

  return cleaned.length > 0
    ? cleaned
    : null;
}


console.log(
  "============================================================"
);

console.log(
  "PADIMA — PLAYER CONVERSATIONS PARTICIPANTS MIGRATION"
);

console.log(
  "MODE:",
  APPLY
    ? "APPLY"
    : "DRY-RUN"
);

console.log(
  "============================================================"
);


const snapshot =
  await db
    .collection(
      "playerConversations"
    )
    .get();


const stats = {
  total:
    snapshot.size,

  alreadyCorrect:
    0,

  needsMigration:
    0,

  invalidParticipants:
    0,

  migrated:
    0,
};


for (const document of snapshot.docs) {
  const data =
    document.data();

  const participants =
    Array.isArray(
      data.participantUids
    )
      ? data
          .participantUids
          .map(cleanUid)
          .filter(Boolean)
          .sort()
      : [];


  if (
    participants.length !== 2
    || participants[0]
      === participants[1]
  ) {
    stats.invalidParticipants += 1;

    console.log(
      "",
      "INVALID:",
      document.id,
      JSON.stringify({
        participantUids:
          data.participantUids
          ?? null,
      })
    );

    continue;
  }


  const participantAUid =
    participants[0];

  const participantBUid =
    participants[1];


  const alreadyCorrect =
    data.participantAUid
      === participantAUid
    &&
    data.participantBUid
      === participantBUid;


  if (alreadyCorrect) {
    stats.alreadyCorrect += 1;

    console.log(
      "OK:",
      document.id,
      participantAUid,
      participantBUid
    );

    continue;
  }


  stats.needsMigration += 1;

  console.log(
    "",
    APPLY
      ? "MIGRATE:"
      : "WOULD MIGRATE:",

    document.id,

    JSON.stringify({
      current: {
        participantAUid:
          data.participantAUid
          ?? null,

        participantBUid:
          data.participantBUid
          ?? null,
      },

      expected: {
        participantAUid,
        participantBUid,
      },

      participantUids:
        participants,
    })
  );


  if (!APPLY) {
    continue;
  }


  await document.ref.update({
    participantUids:
      participants,

    participantAUid,

    participantBUid,

    participantFieldsUpdatedAt:
      FieldValue
        .serverTimestamp(),
  });


  stats.migrated += 1;
}


console.log("");
console.log(
  "============================================================"
);

console.log(
  "RESULT"
);

console.log(
  "============================================================"
);

console.log(
  JSON.stringify(
    stats,
    null,
    2
  )
);


if (
  stats.invalidParticipants > 0
) {
  console.log("");
  console.log(
    "ATTENTION : conversations invalides détectées."
  );

  process.exitCode =
    2;
}


if (!APPLY) {
  console.log("");
  console.log(
    "DRY-RUN UNIQUEMENT — AUCUNE ÉCRITURE FIRESTORE."
  );

  console.log(
    "Pour appliquer : relancer avec --apply"
  );
}
