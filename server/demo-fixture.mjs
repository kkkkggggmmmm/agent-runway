const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;

export const createDemoRateLimits = (now = Date.now()) => {
  const nowSeconds = Math.floor(now / 1_000);
  return {
    source: "demo",
    observedAt: now,
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        limitName: "Work + Codex shared",
        planType: "pro",
        primary: {
          usedPercent: 36,
          windowDurationMins: 300,
          resetsAt: nowSeconds + 4.13 * HOUR_SECONDS,
        },
        secondary: {
          usedPercent: 42,
          windowDurationMins: 10_080,
          resetsAt: nowSeconds + 4.9 * DAY_SECONDS,
        },
        credits: { hasCredits: true, unlimited: false, balance: "120.00" },
        rateLimitReachedType: null,
      },
    },
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [
        {
          id: "demo-reset-1",
          status: "available",
          expiresAt: nowSeconds + 14 * DAY_SECONDS,
          title: "Full reset",
        },
      ],
    },
  };
};
