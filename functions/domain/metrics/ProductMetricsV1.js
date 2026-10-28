// PADIMA product metrics V1 — pure, side-effect-free calculations.
// Inputs are sanitized Firestore records; no network or database access here.
const string = v => typeof v === "string" ? v.trim() : "";
const millis = v => {
  if (v == null) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return null;
};
export const isRealPlayerId = v => !!string(v) && !string(v).startsWith("ami_de_") && !string(v).includes(":");
export function participantIds(match = {}) {
  const items = Array.isArray(match.participants) ? match.participants : [];
  return [...new Set(items.map(p => typeof p === "string" ? p : (p?.uid || p?.userId || p?.playerUid)).map(string).filter(isRealPlayerId))];
}
export function matchCapacity(match = {}) {
  const n = Number(match.capacity ?? 4);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
}
export function isMatchFull(match = {}) {
  return participantIds(match).length >= matchCapacity(match);
}
export function firstBecameFull(before = {}, after = {}) {
  return !isMatchFull(before) && isMatchFull(after);
}
export function newParticipantIds(before = {}, after = {}) {
  const previous = new Set(participantIds(before));
  return participantIds(after).filter(id => !previous.has(id));
}
export function isActivatedWithin7Days({ userCreatedAt, firstMatchActionAt }) {
  const start = millis(userCreatedAt), action = millis(firstMatchActionAt);
  return start !== null && action !== null && action >= start && action < start + 7 * 86400000;
}
export function aggregateMatchChanges(changes = []) {
  const creations = new Set(), joins = new Set(), completions = new Set();
  for (const { matchId, before = null, after = null } of changes) {
    const id = string(matchId);
    if (!id || !after) continue;
    if (!before) creations.add(id);
    for (const uid of newParticipantIds(before || {}, after)) joins.add(id + "|" + uid);
    if (firstBecameFull(before || {}, after)) completions.add(id);
  }
  return { matchesCreated: creations.size, participantJoins: joins.size, matchesFirstFull: completions.size };
}
