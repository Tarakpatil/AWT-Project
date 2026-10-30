const crypto = require("crypto");

/** Minimum acceptable length for a signing secret (256 bits of entropy). */
const MIN_SECRET_LENGTH = 32;


// const KNOWN_PLACEHOLDER_SECRETS = new Set([
//   "change_me_to_a_long_random_string",
//   "change_me",
//   "changeme",
//   "secret",
//   "your_secret_here",
//   "your_secret",
//   "fallback_dev_secret",
//   "replace_me",
//   "t0p_s3cr3t",
// ]);

/** Valid values for `NODE_ENV`. */
const VALID_NODE_ENVS = ["development", "test", "production"];

class ConfigError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function parseInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Splits a comma-separated origin list into an array of trimmed origins.
 * A single value with no comma becomes a one-element array.
 */
function parseOrigins(value, fallback) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  if (Array.isArray(raw)) return raw.map((o) => String(o).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** True when the value is missing, blank, or a known placeholder. */
function isPlaceholderSecret(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return KNOWN_PLACEHOLDER_SECRETS.has(trimmed.toLowerCase());
}

/**
 * Detects whether a MongoDB connection string carries an explicit database
 * name. Without one, MongoDB silently uses the `test` database — a classic
 * production footgun.
 */
function hasDatabaseName(uri) {
  try {
    const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, "");
    const queryIndex = withoutScheme.indexOf("?");
    const beforeQuery = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);
    const slashIndex = beforeQuery.indexOf("/");
    if (slashIndex === -1) return false;
    const dbPart = beforeQuery.slice(slashIndex + 1);
    return dbPart.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the validated configuration object from a source of environment
 * variables. Throws `ConfigError` when the configuration is unusable.
 *
 * @param {NodeJS.ProcessEnv} source
 * @returns {Readonly<object>} frozen configuration
 */
function loadEnv(source = process.env) {
  const warnings = [];

  const nodeEnv = String(source.NODE_ENV || "development").trim().toLowerCase();
  if (!VALID_NODE_ENVS.includes(nodeEnv)) {
    throw new ConfigError(
      `Invalid NODE_ENV "${nodeEnv}".`,
      `Expected one of: ${VALID_NODE_ENVS.join(", ")}`
    );
  }
  const isProduction = nodeEnv === "production";
  const isDevelopment = nodeEnv === "development";
  const isTest = nodeEnv === "test";

  const mongoUri = String(source.MONGO_URI || "").trim();
  if (!mongoUri) {
    throw new ConfigError(
      "MONGO_URI is not defined.",
      "Copy server/.env.example to server/.env and set MONGO_URI."
    );
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
    throw new ConfigError(
      "MONGO_URI is not a valid MongoDB connection string.",
      "It must start with mongodb:// or mongodb+srv://"
    );
  }
  if (!hasDatabaseName(mongoUri)) {
    warnings.push(
      "MONGO_URI has no database name — MongoDB will use the 'test' database. " +
        "Add a path segment, e.g. mongodb://localhost:27017/ticketing"
    );
  }

  const jwtSecret = String(source.JWT_SECRET || "");
  if (isPlaceholderSecret(jwtSecret)) {
    throw new ConfigError(
      "JWT_SECRET is missing or is still the placeholder value.",
      "Generate a real one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `JWT_SECRET is too short (${jwtSecret.length} characters, minimum ${MIN_SECRET_LENGTH}).`,
      "Generate a real one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }

  // A dedicated secret is preferred so that rotating the JWT secret does not
  // silently invalidate every QR code already printed on a ticket.
  let qrSigningSecret = String(source.QR_SIGNING_SECRET || "").trim();
  if (!qrSigningSecret) {
    qrSigningSecret = jwtSecret;
    warnings.push(
      "QR_SIGNING_SECRET is not set — falling back to JWT_SECRET. " +
        "Set a separate value so QR signatures survive a JWT secret rotation."
    );
  } else if (isPlaceholderSecret(qrSigningSecret) || qrSigningSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      "QR_SIGNING_SECRET is missing or too weak.",
      "Use at least 32 characters, or leave it unset to derive it from JWT_SECRET."
    );
  }

  const port = parseInteger(source.PORT, 5000, { min: 1, max: 65535 });
  const jwtExpiresIn = String(source.JWT_EXPIRES_IN || "7d").trim();
  const clientUrls = parseOrigins(source.CLIENT_URL, ["http://localhost:5173"]);
  if (clientUrls.length === 0) {
    throw new ConfigError(
      "CLIENT_URL resolved to an empty list.",
      "Set CLIENT_URL to one or more comma-separated origins."
    );
  }
  const signQr = parseBoolean(source.SIGN_QR, true);
  const enableDemoEndpoints = parseBoolean(source.ENABLE_DEMO_ENDPOINTS, false);

  const doorOpensBeforeMinutes = parseInteger(
    source.DOOR_WINDOW_MINUTES_BEFORE,
    240,
    { min: 0, max: 7 * 24 * 60 }
  );
  const doorClosesAfterMinutes = parseInteger(
    source.DOOR_WINDOW_MINUTES_AFTER,
    360,
    { min: 0, max: 30 * 24 * 60 }
  );

  if (isProduction && enableDemoEndpoints) {
    throw new ConfigError(
      "ENABLE_DEMO_ENDPOINTS cannot be enabled in production.",
      "The simulate-tamper endpoint mutates the database without recomputing hashes."
    );
  }

  return Object.freeze({
    nodeEnv,
    isProduction,
    isDevelopment,
    isTest,
    port,
    mongoUri,
    jwtSecret,
    jwtExpiresIn,
    qrSigningSecret,
    signQr,
    enableDemoEndpoints,
    doorOpensBeforeMinutes,
    doorClosesAfterMinutes,
    // Demo endpoints require an explicit opt-in AND a non-production environment.
    // Checking only NODE_ENV would leave the endpoint live when NODE_ENV is unset.
    demoEndpointsEnabled: !isProduction && enableDemoEndpoints,
    clientUrls: Object.freeze(clientUrls),
    warnings: Object.freeze(warnings),
  });
}

let cached = null;

/**
 * Returns the validated configuration, loading it on first use.
 * Throws `ConfigError` if the environment is invalid.
 */
function getEnv() {
  if (cached === null) {
    cached = loadEnv(process.env);
  }
  return cached;
}

/**
 * Loads and validates the configuration, exiting the process with a clear
 * message when it is invalid. Call once, as the very first thing in the
 * startup sequence.
 */
function initEnv() {
  let config;
  try {
    config = loadEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[FATAL] Invalid environment configuration: ${err.message}`);
      if (err.hint) console.error(`        ${err.hint}`);
      console.error("");
      console.error("        The server will not start with an insecure or incomplete configuration.\n");
      process.exit(1);
    }
    throw err;
  }

  cached = config;
  for (const warning of config.warnings) {
    console.warn(`[WARN] ${warning}`);
  }
  console.log(
    `[CONFIG] environment=${config.nodeEnv} signQr=${config.signQr} ` +
      `demoEndpoints=${config.demoEndpointsEnabled} origins=${config.clientUrls.join(",")}`
  );
  return config;
}

/**
 * Generates a strong secret. Exposed so operators can run
 * `node -e "require('./config/env').generateSecret()"` instead of
 * copy-pasting a placeholder.
 */
function generateSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString("hex");
}

module.exports = {
  env: {
    // Lazy proxy so `require("./config/env").env` always reflects the loaded
    // configuration without forcing a load at import time, which would make
    // the module un-importable from tests that set their own environment.
    get nodeEnv() { return getEnv().nodeEnv; },
    get isProduction() { return getEnv().isProduction; },
    get isDevelopment() { return getEnv().isDevelopment; },
    get isTest() { return getEnv().isTest; },
    get port() { return getEnv().port; },
    get mongoUri() { return getEnv().mongoUri; },
    get jwtSecret() { return getEnv().jwtSecret; },
    get jwtExpiresIn() { return getEnv().jwtExpiresIn; },
    get qrSigningSecret() { return getEnv().qrSigningSecret; },
    get signQr() { return getEnv().signQr; },
    get enableDemoEndpoints() { return getEnv().enableDemoEndpoints; },
    get doorOpensBeforeMinutes() { return getEnv().doorOpensBeforeMinutes; },
    get doorClosesAfterMinutes() { return getEnv().doorClosesAfterMinutes; },
    get demoEndpointsEnabled() { return getEnv().demoEndpointsEnabled; },
    get clientUrls() { return getEnv().clientUrls; },
    get warnings() { return getEnv().warnings; },
  },
  initEnv,
  getEnv,
  loadEnv,
  generateSecret,
  ConfigError,
};
