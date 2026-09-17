import {
  applicationDefault,
  initializeApp,
} from "firebase-admin/app";

import {
  FieldPath,
  getFirestore,
} from "firebase-admin/firestore";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPlayerNetworkStats,
} from "../domain/network/PlayerNetworkStatsAggregator.js";

import {
  buildPlayerNetworkStatsDocument,
} from "../domain/network/PlayerNetworkStatsProjection.js";


const EXPECTED_PROJECT_ID =
  "padelmatch-32186";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT
  || EXPECTED_PROJECT_ID;

const APPLY =
  process.argv.includes("--apply");

const CONFIRM_WRITE =
  process.env.PADIMA_CONFIRM_NETWORK_STATS_WRITE
  === "YES_WRITE_PLAYER_NETWORK_STATS";


if (PROJECT_ID !== EXPECTED_PROJECT_ID) {
  throw new Error(
    `Projet refusé: ${PROJECT_ID}. Attendu: ${EXPECTED_PROJECT_ID}`,
  );
}


if (APPLY && !CONFIRM_WRITE) {
  throw new Error(
    "Mode --apply refusé. "
    + "Définir PADIMA_CONFIRM_NETWORK_STATS_WRITE="
    + "YES_WRITE_PLAYER_NETWORK_STATS pour confirmer.",
  );
}


initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});

const db =
  getFirestore();


function csvEscape(value) {
  if (
    value === null
    || value === undefined
  ) {
    return "";
  }

  const str =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  if (
    str.includes(",")
    || str.includes('"')
    || str.includes("\n")
  ) {
    return `"${str.replaceAll('"', '""')}"`;
  }

  return str;
}


function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(
      filePath,
      "",
      "utf8",
    );
    return;
  }

  const headers =
    Object.keys(rows[0]);

  const content = [
    headers.join(","),
    ...rows.map(
      (row) =>
        headers
          .map(
            (header) =>
              csvEscape(
                row[header],
              ),
          )
          .join(","),
    ),
  ].join("\n");

  fs.writeFileSync(
    filePath,
    content,
    "utf8",
  );
}


async function loadMatches() {
  const snapshot =
    await db
      .collection("matches")
      .orderBy(
        FieldPath.documentId(),
      )
      .get();

  return snapshot.docs.map(
    (doc) => ({
      id: doc.id,
      ...doc.data(),
    }),
  );
}


async function loadValidUserIds() {
  const snapshot =
    await db
      .collection("users")
      .select()
      .get();

  return new Set(
    snapshot.docs.map(
      (doc) => doc.id,
    ),
  );
}


async function applyProjection(
  projectedRows,
) {
  const CHUNK_SIZE = 400;

  let written = 0;

  for (
    let start = 0;
    start < projectedRows.length;
    start += CHUNK_SIZE
  ) {
    const chunk =
      projectedRows.slice(
        start,
        start + CHUNK_SIZE,
      );

    const batch =
      db.batch();

    for (const row of chunk) {
      const ref =
        db
          .collection(
            "playerNetworkStats",
          )
          .doc(
            row.uid,
          );

      batch.set(
        ref,
        row,
        {
          merge: false,
        },
      );
    }

    await batch.commit();

    written +=
      chunk.length;

    console.log(
      `Écriture: ${written}/${projectedRows.length}`,
    );
  }

  return written;
}


async function main() {
  console.log(
    "============================================================",
  );

  console.log(
    "PADIMA — PLAYER NETWORK STATS BACKFILL",
  );

  console.log(
    "============================================================",
  );

  console.log(
    `Project: ${PROJECT_ID}`,
  );

  console.log(
    `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  );

  console.log("");


  const matches =
    await loadMatches();

  const validUserIds =
    await loadValidUserIds();

  const stats =
    buildPlayerNetworkStats(
      matches,
      {
        validUserIds,
      },
    );

  const generatedAtMs =
    Date.now();

  const projectedRows =
    stats.map(
      (row) =>
        buildPlayerNetworkStatsDocument(
          row,
          {
            generatedAtMs,
          },
        ),
    );


  const stamp =
    new Date()
      .toISOString()
      .replaceAll(":", "")
      .replaceAll(".", "")
      .replace("T", "_")
      .replace("Z", "");

  const outputDir =
    path.join(
      os.homedir(),
      "Desktop",
      `Padima_PlayerNetworkStats_Backfill_${APPLY ? "APPLY" : "DRYRUN"}_${stamp}`,
    );

  fs.mkdirSync(
    outputDir,
    {
      recursive: true,
    },
  );


  writeCsv(
    path.join(
      outputDir,
      "playerNetworkStats.csv",
    ),
    projectedRows,
  );


  fs.writeFileSync(
    path.join(
      outputDir,
      "playerNetworkStats.json",
    ),
    JSON.stringify(
      projectedRows,
      null,
      2,
    ),
    "utf8",
  );


  const summary = {
    projectId:
      PROJECT_ID,

    mode:
      APPLY
        ? "APPLY"
        : "DRY_RUN",

    sourceCollection:
      "matches",

    targetCollection:
      "playerNetworkStats",

    matchesRead:
      matches.length,

    validUsersRead:
      validUserIds.size,

    projectedPlayers:
      projectedRows.length,

    generatedAtMs,

    writesPerformed:
      0,
  };


  if (APPLY) {
    summary.writesPerformed =
      await applyProjection(
        projectedRows,
      );
  }


  fs.writeFileSync(
    path.join(
      outputDir,
      "summary.json",
    ),
    JSON.stringify(
      summary,
      null,
      2,
    ),
    "utf8",
  );


  fs.writeFileSync(
    path.join(
      outputDir,
      "summary.txt",
    ),
    [
      "PADIMA — PLAYER NETWORK STATS BACKFILL",
      "",
      `Project: ${PROJECT_ID}`,
      `Mode: ${summary.mode}`,
      `Matches read: ${summary.matchesRead}`,
      `Valid users read: ${summary.validUsersRead}`,
      `Players projected: ${summary.projectedPlayers}`,
      `Writes performed: ${summary.writesPerformed}`,
      "",
      `Output: ${outputDir}`,
    ].join("\n"),
    "utf8",
  );


  console.log(
    `Matches lus: ${matches.length}`,
  );

  console.log(
    `Utilisateurs valides lus: ${validUserIds.size}`,
  );

  console.log(
    `Joueurs projetés: ${projectedRows.length}`,
  );

  console.log(
    `Écritures Firestore: ${summary.writesPerformed}`,
  );

  console.log(
    `Output: ${outputDir}`,
  );


  if (!APPLY) {
    console.log("");
    console.log(
      "DRY RUN TERMINE — AUCUNE ECRITURE FIRESTORE",
    );
  }
}


main().catch(
  (error) => {
    console.error("");
    console.error(
      "ERREUR BACKFILL PLAYER NETWORK STATS",
    );

    console.error(error);

    process.exitCode = 1;
  },
);
