const { HttpError } = require("./httpError");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query = {}, options = {}) {
  const {
    defaultPage = DEFAULT_PAGE,
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = MAX_LIMIT,
  } = options;

  const page = parsePositiveInt(
    query.page,
    defaultPage,
    "page",
    { min: 1, max: 1_000_000 }
  );
  const limit = parsePositiveInt(
    query.limit,
    defaultLimit,
    "limit",
    { min: 1, max: maxLimit }
  );

  return { page, limit, skip: (page - 1) * limit };
}

function parsePositiveInt(raw, fallback, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (raw === undefined || raw === null || raw === "") return fallback;

  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, `Invalid '${name}' parameter: expected a positive integer.`);
  }

  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new HttpError(400, `Invalid '${name}' parameter: expected a positive integer.`);
  }
  return Math.min(max, Math.max(min, n));
}

module.exports = { parsePagination, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };
