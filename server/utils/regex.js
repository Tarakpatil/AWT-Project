const { HttpError } = require("./httpError");

const MAX_SEARCH_LENGTH = 64;

/** Escapes every regular-expression metacharacter in `str`. */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegex(raw, options = {}) {
  const { maxLength = MAX_SEARCH_LENGTH, flags = "i" } = options;

  if (raw === undefined || raw === null) return null;

  const value = String(raw);
  if (value.length > maxLength) {
    throw new HttpError(
      400,
      `Search term is too long (maximum ${maxLength} characters).`
    );
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  return new RegExp(escapeRegExp(trimmed), flags);
}

module.exports = { escapeRegExp, buildSearchRegex, MAX_SEARCH_LENGTH };
