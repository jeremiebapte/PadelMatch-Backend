import {
  GROUP_HEALTH_VERSION,
  GROUP_INITIAL_HEALTH_COMPONENTS,
} from "./GroupConstants.js";
import { GroupHealthStatus } from "./GroupEnums.js";

const WEIGHTS = Object.freeze({
  activity: 0.20,
  matchFrequency: 0.20,
  fillRate: 0.20,
  activeMembers: 0.15,
  retention: 0.15,
  reliability: 0.10,
});

function clamp(value, min = 0, max = 100) {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeComponents(components = {}) {
  return Object.fromEntries(
    Object.keys(GROUP_INITIAL_HEALTH_COMPONENTS).map((key) => [
      key,
      clamp(components[key]),
    ])
  );
}

export function healthStatusForScore(score, hasEnoughData = true) {
  if (!hasEnoughData) return GroupHealthStatus.NEW;
  if (score >= 75) return GroupHealthStatus.HEALTHY;
  if (score >= 50) return GroupHealthStatus.MODERATE;
  if (score >= 20) return GroupHealthStatus.LOW_ACTIVITY;
  return GroupHealthStatus.DORMANT;
}

export function calculateGroupHealth({
  components = {},
  calculatedAt,
  hasEnoughData = true,
} = {}) {
  const normalized = normalizeComponents(components);
  const score = Math.round(
    Object.entries(WEIGHTS).reduce(
      (total, [key, weight]) => total + normalized[key] * weight,
      0
    ) * 100
  ) / 100;

  return {
    score,
    version: GROUP_HEALTH_VERSION,
    status: healthStatusForScore(score, hasEnoughData),
    components: normalized,
    ...(calculatedAt ? { calculatedAt } : {}),
  };
}

export { WEIGHTS as GROUP_HEALTH_WEIGHTS };
