import {
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

import {
  getFirestore,
} from "firebase-admin/firestore";

import {
  extractAffectedUserIds,
  buildNetworkSyncPlan,
} from "../../domain/network/PlayerNetworkStatsSynchronizer.js";


const MATCH_PATH =
  "matches/{matchId}";


export function buildSyncPlayerNetworkStatsOnMatchWrite({
  onDocumentWrittenFn =
    onDocumentWritten,

  getFirestoreFn =
    getFirestore,
} = {}) {
  return onDocumentWrittenFn(
    {
      document: MATCH_PATH,
      region: "europe-west1",
    },
    async (event) => {
      const db =
        getFirestoreFn();

      const beforeMatch =
        event.data?.before?.exists
          ? event.data.before.data()
          : null;

      const afterMatch =
        event.data?.after?.exists
          ? event.data.after.data()
          : null;


      const usersSnapshot =
        await db
          .collection("users")
          .select()
          .get();

      const validUserIds =
        new Set(
          usersSnapshot.docs.map(
            (doc) => doc.id,
          ),
        );


      const affectedUserIds =
        extractAffectedUserIds(
          beforeMatch,
          afterMatch,
          {
            validUserIds,
          },
        );


      if (affectedUserIds.size === 0) {
        console.log(
          "[playerNetworkStats] no current users affected",
        );

        return;
      }


      const matchesSnapshot =
        await db
          .collection("matches")
          .get();

      const matches =
        matchesSnapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data(),
          }),
        );


      const plan =
        buildNetworkSyncPlan({
          matches,
          validUserIds,
          affectedUserIds,
          generatedAtMs:
            Date.now(),
        });


      if (
        plan.upserts.length === 0
        && plan.deletes.length === 0
      ) {
        console.log(
          "[playerNetworkStats] no projection changes",
        );

        return;
      }


      const batch =
        db.batch();


      for (const row of plan.upserts) {
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


      for (const uid of plan.deletes) {
        const ref =
          db
            .collection(
              "playerNetworkStats",
            )
            .doc(uid);

        batch.delete(ref);
      }


      await batch.commit();


      console.log(
        "[playerNetworkStats] synchronized",
        {
          matchId:
            event.params?.matchId
            || null,

          affectedUsers:
            affectedUserIds.size,

          upserts:
            plan.upserts.length,

          deletes:
            plan.deletes.length,
        },
      );
    },
  );
}


export const syncPlayerNetworkStatsOnMatchWrite =
  buildSyncPlayerNetworkStatsOnMatchWrite();
