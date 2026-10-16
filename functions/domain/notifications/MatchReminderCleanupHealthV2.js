const FAILURE_THRESHOLD = 3;

export function evaluateMatchReminderCleanupHealthV2(state) {
  const failures = state?.consecutiveFailures;

  if (
    !Number.isSafeInteger(failures)
    || failures < 0
  ) {
    return {
      status: "unknown",
      consecutiveFailures: 0,
      needsAttention: false,
    };
  }

  if (failures >= FAILURE_THRESHOLD) {
    return {
      status: "blocked",
      consecutiveFailures: failures,
      needsAttention: true,
    };
  }

  if (failures > 0) {
    return {
      status: "degraded",
      consecutiveFailures: failures,
      needsAttention: false,
    };
  }

  return {
    status: "healthy",
    consecutiveFailures: 0,
    needsAttention: false,
  };
}

export { FAILURE_THRESHOLD };
