import {
  hashInviteToken,
} from "./domain/groups/index.js";

export function buildGetGroupInvitePreview({
  onCall,
  HttpsError,
  runtime,
  db,
  logger,
}) {

  return onCall(runtime, async (req) => {

    try {

      const token =
        typeof req.data?.token === "string"
          ? req.data.token.trim()
          : "";

      if (!token) {
        throw new HttpsError(
          "invalid-argument",
          "INVITE_TOKEN_REQUIRED"
        );
      }

      const tokenHash =
        hashInviteToken(token);

      logger?.info?.(
        "getGroupInvitePreview token debug",
        {
          tokenHash,
        }
      );

      const inviteQuery =
        await db
          .collection("groupInvites")
          .where(
            "tokenHash",
            "==",
            tokenHash
          )
          .limit(1)
          .get();

      logger?.info?.(
        "invite query result",
        {
          empty: inviteQuery.empty,
          count: inviteQuery.size,
        }
      );

      if (inviteQuery.empty) {
        throw new HttpsError(
          "not-found",
          "GROUP_INVITE_NOT_FOUND"
        );
      }

      const invite =
        inviteQuery.docs[0].data();

      const groupId =
        invite.groupId;

      const groupSnapshot =
        await db
          .collection("groups")
          .doc(groupId)
          .get();

      if (!groupSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "GROUP_NOT_FOUND"
        );
      }

      const group =
        groupSnapshot.data() ?? {};

      logger?.info?.(
        "getGroupInvitePreview ok",
        {
          groupId,
        }
      );

      return {
        groupId,
        groupName:
          group.name ?? "",
        groupImage:
          group.imageUrl ?? null,
        city:
          group.city ?? null,
        memberCount:
          group.stats?.memberCount ?? 0,
        levelMin:
          group.levelMin ?? null,
        levelMax:
          group.levelMax ?? null,
      };

    } catch (error) {

      logger?.error?.(
        "getGroupInvitePreview failed",
        {
          message:
            error.message,
        }
      );

      throw error;
    }
  });
}
