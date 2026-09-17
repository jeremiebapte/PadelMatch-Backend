function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values)
        ? values
        : []
      )
        .map(asString)
        .filter(Boolean)
    )
  );
}


/**
 * Construit le modèle V2 lors de la création d'un match.
 *
 * Compatibilité :
 * - groupId reste conservé ailleurs dans le document ;
 * - un match sans groupId est considéré comme public ;
 * - un match avec groupId est initialement visible uniquement
 *   dans son groupe d'origine.
 */
export function buildInitialMatchDistribution({
  groupId,
}) {
  const normalizedGroupId =
    asString(groupId);

  if (normalizedGroupId) {
    return {
      origin: {
        type: "group",
        groupId: normalizedGroupId,
      },

      distribution: {
        public: false,
        groupIds: [
          normalizedGroupId,
        ],
      },
    };
  }

  return {
    origin: {
      type: "public",
      groupId: null,
    },

    distribution: {
      public: true,
      groupIds: [],
    },
  };
}


/**
 * Normalise aussi bien un match V2 qu'un ancien match.
 *
 * Important :
 * cette fonction ne modifie jamais le document fourni.
 */
export function normalizeMatchDistribution(
  match
) {
  const source =
    match && typeof match === "object"
      ? match
      : {};

  const legacyGroupId =
    asString(source.groupId);

  const originType =
    source.origin?.type === "group"
      || source.origin?.type === "public"
      ? source.origin.type
      : legacyGroupId
        ? "group"
        : "public";

  const originGroupId =
    originType === "group"
      ? (
          asString(
            source.origin?.groupId
          )
          || legacyGroupId
          || null
        )
      : null;

  const existingGroupIds =
    uniqueStrings(
      source.distribution?.groupIds
    );

  const groupIds =
    uniqueStrings([
      ...existingGroupIds,
      ...(legacyGroupId
        ? [legacyGroupId]
        : []),
      ...(originGroupId
        ? [originGroupId]
        : []),
    ]);

  const hasExplicitPublic =
    typeof source.distribution?.public
    === "boolean";

  const isPublic =
    hasExplicitPublic
      ? source.distribution.public
      : !legacyGroupId;

  return {
    origin: {
      type: originType,
      groupId: originGroupId,
    },

    distribution: {
      public: isPublic,
      groupIds,
    },
  };
}


export function isMatchPublic(match) {
  return normalizeMatchDistribution(
    match
  ).distribution.public === true;
}


export function getMatchDistributionGroupIds(
  match
) {
  return normalizeMatchDistribution(
    match
  ).distribution.groupIds;
}


export function isMatchDistributedToGroup(
  match,
  groupId
) {
  const normalizedGroupId =
    asString(groupId);

  if (!normalizedGroupId) {
    return false;
  }

  return getMatchDistributionGroupIds(
    match
  ).includes(normalizedGroupId);
}


export function addMatchDistributionGroup(
  match,
  groupId
) {
  const normalizedGroupId =
    asString(groupId);

  if (!normalizedGroupId) {
    throw new Error(
      "INVALID_GROUP_ID"
    );
  }

  const normalized =
    normalizeMatchDistribution(match);

  return {
    origin:
      normalized.origin,

    distribution: {
      public:
        normalized
          .distribution
          .public,

      groupIds:
        uniqueStrings([
          ...normalized
            .distribution
            .groupIds,

          normalizedGroupId,
        ]),
    },
  };
}


export function makeMatchPublic(
  match
) {
  const normalized =
    normalizeMatchDistribution(match);

  return {
    origin:
      normalized.origin,

    distribution: {
      public: true,

      groupIds:
        normalized
          .distribution
          .groupIds,
    },
  };
}


export function sameMatchDistribution(
  left,
  right
) {
  const a =
    normalizeMatchDistribution(left);

  const b =
    normalizeMatchDistribution(right);

  return (
    a.origin.type ===
      b.origin.type
    &&
    a.origin.groupId ===
      b.origin.groupId
    &&
    a.distribution.public ===
      b.distribution.public
    &&
    JSON.stringify(
      [...a.distribution.groupIds].sort()
    )
      ===
    JSON.stringify(
      [...b.distribution.groupIds].sort()
    )
  );
}
