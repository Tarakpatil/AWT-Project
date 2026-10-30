const { createRateLimiter, ipKeyGenerator } = require("./rateLimit.middleware");
const { env } = require("../config/env");

/** Login: 10 attempts per 15 minutes per IP (1000 in dev). */
const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: env.isDevelopment ? 1000 : 10,
  keyPrefix: "rl:login",
  keyGenerator: ipKeyGenerator,
  message: "Too many login attempts. Please try again in a few minutes.",
});

/** Register: 5 attempts per 15 minutes per IP (500 in dev). */
const registerRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: env.isDevelopment ? 500 : 5,
  keyPrefix: "rl:register",
  keyGenerator: ipKeyGenerator,
  message: "Too many registration attempts. Please try again in a few minutes.",
});

/** Door-scanner: 60 scans per minute per staff member. */
const verifyRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: "rl:verify",
  message: "Too many verification attempts. Please slow down.",
});

/** Purchase: 20 attempts per minute per buyer. */
const purchaseRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  keyPrefix: "rl:purchase",
  message: "Too many purchase attempts. Please slow down.",
});

/** Transfer: 10 attempts per minute per buyer. */
const transferRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "rl:transfer",
  message: "Too many transfer attempts. Please slow down.",
});

const ALL_LIMITERS = [
  loginRateLimit,
  registerRateLimit,
  verifyRateLimit,
  purchaseRateLimit,
  transferRateLimit,
];

/** Clears every counter. Used by the test suite. */
function resetAll() {
  for (const limiter of ALL_LIMITERS) limiter.reset();
}

module.exports = {
  loginRateLimit,
  registerRateLimit,
  verifyRateLimit,
  purchaseRateLimit,
  transferRateLimit,
  resetAll,
};
