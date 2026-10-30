const { HttpError } = require("../utils/httpError");

/**
 * @param {object} [options]
 * @param {number} [options.windowMs=60000]   length of the counting window
 * @param {number} [options.max=60]            requests allowed per window
 * @param {string} [options.keyPrefix="rl"]    namespace for the counters
 * @param {string} [options.message]           429 body message
 * @param {function} [options.keyGenerator]    (req) => string
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    keyPrefix = "rl",
    message = "Too many requests. Please slow down and try again shortly.",
    keyGenerator = defaultKeyGenerator,
  } = options;

  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  if (typeof sweeper.unref === "function") sweeper.unref();

  const middleware = function rateLimit(req, res, next) {
    const key = `${keyPrefix}:${keyGenerator(req)}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return next(new HttpError(429, message));
    }

    return next();
  };

  /** Exposed for tests and for graceful shutdown. */
  middleware.reset = () => buckets.clear();
  middleware.stop = () => clearInterval(sweeper);
  middleware.buckets = buckets;

  return middleware;
}

function defaultKeyGenerator(req) {
  if (req.user?.userId) return `u:${req.user.userId}`;
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

function ipKeyGenerator(req) {
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

module.exports = { createRateLimiter, defaultKeyGenerator, ipKeyGenerator };
