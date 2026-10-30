function describeDuplicateKey(err) {
  const candidates = [
    err?.keyPattern,
    err?.errorResponse?.keyPattern,
    err?.writeErrors?.[0]?.keyPattern,
    err?.writeErrors?.[0]?.err?.keyPattern,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return { keyPattern: candidate, indexName: null };
    }
  }

  // Fall back to the index name in the message.
  const match = /index:\s*([A-Za-z0-9_]+)/.exec(String(err?.message || ""));
  return { keyPattern: null, indexName: match ? match[1] : null };
}

function errorMiddleware(err, _req, res, _next) {
  //Mongoose ValidationError → 400 with per-field messages
  if (err.name === "ValidationError") {
    const fields = {};
    for (const [field, detail] of Object.entries(err.errors)) {
      fields[field] = detail.message;
    }
    return res.status(400).json({ error: "Validation failed", fields });
  }

  //Mongoose CastError (e.g. invalid ObjectId) → 400
  if (err.name === "CastError") {
    return res.status(400).json({
      error: `Invalid ${err.kind}: "${err.value}" for ${err.path}`,
    });
  }

  //Mongoose / MongoDB duplicate-key → 409
  if (err.code === 11000) {
    const { keyPattern, indexName } = describeDuplicateKey(err);
    const field = keyPattern ? Object.keys(keyPattern).join(", ") : null;

    if (
      (keyPattern && keyPattern.seatNumber !== undefined) ||
      indexName === "eventId_1_seatNumber_1"
    ) {
      return res.status(409).json({
        error: "Seat is already taken",
        code: "SEAT_TAKEN",
      });
    }
    if (
      (keyPattern && keyPattern.seq !== undefined) ||
      indexName === "seq_1"
    ) {
      return res.status(409).json({
        error: "Hash chain sequence conflict — please retry",
        code: "CHAIN_CONFLICT",
      });
    }

    return res.status(409).json({
      error: `Duplicate value for: ${field || indexName || "unique field"}`,
    });
  }

  // JWT errors → 401
  if (
    err.name === "JsonWebTokenError" ||
    err.name === "TokenExpiredError"
  ) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Explicit status set by controllers (e.g. err.status = 404)
  const status = err.status || err.statusCode || 500;

  // Always log the full error server-side for debugging
  if (status >= 500) {
    console.error("Unhandled error:", err);
  }

  const message =
    status === 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  const body = { error: message };

  // Structured detail
  const details =
    err.details && typeof err.details === "object" ? { ...err.details } : null;

  let code = typeof err.code === "string" ? err.code : undefined;
  if (code === undefined && details && typeof details.code === "string") {
    code = details.code;
    delete details.code;
  }

  if (code !== undefined && status < 500) {
    body.code = code;
  }
  if (details && Object.keys(details).length > 0) {
    body.details = details;
  }

  return res.status(status).json(body);
}

module.exports = errorMiddleware;
module.exports.describeDuplicateKey = describeDuplicateKey;
