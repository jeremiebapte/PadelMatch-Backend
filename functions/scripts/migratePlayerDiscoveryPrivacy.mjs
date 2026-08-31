/*
 * Padima — Player Discovery Privacy Migration
 *
 * Par défaut : DRY-RUN.
 * Pour écrire réellement : --apply
 *
 * Migration :
 * - ajoute isDiscoverable=true UNIQUEMENT si le champ est absent ;
 * - ajoute isPublicProfile=true UNIQUEMENT si le champ est absent ;
 * - ne modifie jamais un choix existant true/false ;
 * - ne touche à aucun autre champ.
 */

import {
  applicationDefault,
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";


const PROJECT_ID =
  process.env.GCLOUD_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT
  || "padelmatch-32186";

const APPLY =
  process.argv.includes("--apply");


initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});

const db =
  getFirestore();


function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(
    data,
    key
  );
}


console.log(
  "============================================================"
);

console.log(
  "PADIMA — PLAYER DISCOVERY PRIVACY MIGRATION"
);

console.log(
  `project=${PROJECT_ID}`
);

console.log(
  `mode=${APPLY ? "APPLY" : "DRY_RUN"}`
);

console.log(
  "============================================================"
);


const usersSnapshot =
  await db
    .collection("users")
    .get();


let totalUsers = 0;

let alreadyComplete = 0;

let missingDiscoverable = 0;
let missingPublicProfile = 0;

let missingBoth = 0;

const candidates = [];


for (
  const document
  of usersSnapshot.docs
) {

  totalUsers += 1;

  const data =
    document.data() ?? {};

  const hasDiscoverable =
    hasOwn(
      data,
      "isDiscoverable"
    );

  const hasPublicProfile =
    hasOwn(
      data,
      "isPublicProfile"
    );

  if (
    hasDiscoverable
    && hasPublicProfile
  ) {
    alreadyComplete += 1;
    continue;
  }

  if (!hasDiscoverable) {
    missingDiscoverable += 1;
  }

  if (!hasPublicProfile) {
    missingPublicProfile += 1;
  }

  if (
    !hasDiscoverable
    && !hasPublicProfile
  ) {
    missingBoth += 1;
  }

  candidates.push({
    ref: document.ref,
    updateTime: document.updateTime,
    needsDiscoverable:
      !hasDiscoverable,
    needsPublicProfile:
      !hasPublicProfile,
  });
}


console.log();
console.log(
  "=== AUDIT ==="
);

console.log(
  `totalUsers=${totalUsers}`
);

console.log(
  `alreadyComplete=${alreadyComplete}`
);

console.log(
  `usersToMigrate=${candidates.length}`
);

console.log(
  `missingIsDiscoverable=${missingDiscoverable}`
);

console.log(
  `missingIsPublicProfile=${missingPublicProfile}`
);

console.log(
  `missingBoth=${missingBoth}`
);


if (!APPLY) {

  console.log();
  console.log(
    "============================================================"
  );

  console.log(
    "DRY RUN TERMINÉ — 0 écriture"
  );

  console.log(
    "Relancer avec --apply uniquement après validation."
  );

  console.log(
    "============================================================"
  );

  process.exit(0);
}


console.log();
console.log(
  "=== APPLY ==="
);


let migrated = 0;
let skippedBecauseChanged = 0;
let failures = 0;


/*
 * Transaction par utilisateur :
 *
 * On relit le document au moment exact de l'écriture.
 * Si entre le dry-run et l'apply l'utilisateur a choisi
 * une valeur, elle est conservée.
 */
for (const candidate of candidates) {

  try {

    const result =
      await db.runTransaction(
        async (transaction) => {

          const freshSnapshot =
            await transaction.get(
              candidate.ref
            );

          if (!freshSnapshot.exists) {
            return "SKIPPED";
          }

          const freshData =
            freshSnapshot.data() ?? {};

          const patch = {};

          if (
            !hasOwn(
              freshData,
              "isDiscoverable"
            )
          ) {
            patch.isDiscoverable =
              true;
          }

          if (
            !hasOwn(
              freshData,
              "isPublicProfile"
            )
          ) {
            patch.isPublicProfile =
              true;
          }

          if (
            Object.keys(patch)
              .length === 0
          ) {
            return "SKIPPED";
          }

          transaction.update(
            candidate.ref,
            patch
          );

          return "MIGRATED";
        }
      );

    if (result === "MIGRATED") {
      migrated += 1;
    } else {
      skippedBecauseChanged += 1;
    }

  } catch (error) {

    failures += 1;

    console.error(
      JSON.stringify({
        uid:
          candidate.ref.id,
        error:
          error?.message
          || String(error),
      })
    );
  }
}


console.log();
console.log(
  "=== RESULTAT ==="
);

console.log(
  `migrated=${migrated}`
);

console.log(
  `skippedBecauseChanged=${skippedBecauseChanged}`
);

console.log(
  `failures=${failures}`
);


if (failures > 0) {

  console.log();
  console.log(
    "MIGRATION TERMINÉE AVEC ERREURS"
  );

  process.exitCode = 1;

} else {

  console.log();
  console.log(
    "============================================================"
  );

  console.log(
    "MIGRATION TERMINÉE"
  );

  console.log(
    "Aucun choix existant n'a été écrasé."
  );

  console.log(
    "============================================================"
  );
}
