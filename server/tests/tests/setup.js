/**
 * tests/setup.js — test bootstrap (loaded via `bunfig.toml` -> `[test] preload`).
 *
 * RESPONSIBILITIES
 *   1. Pin the environment variables the server reads, BEFORE any module
 *      that captures them is loaded.  `dotenv` does not override variables
 *      that are already set, so these win over `server/.env`.
 *   2. Start an in-memory MongoDB **replica set**.  A replica set (not a
 *      standalone mongod) is required because the hash-chain append path
 *      uses multi-document transactions.
 *   3. Make sure every model has created its indexes.  The whole point of
 *      the "seat can only be sold once" fix is the unique index — a test
 *      suite that runs before the index exists would silently pass.
 *
 * The replica set is started once per test process; Bun runs every test
 * file in the same process, so the cost is paid once.
 */

const path = require("path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");

// ---------------------------------------------------------------------------
// 1. Environment
// ---------------------------------------------------------------------------

process.env.NODE_ENV = "test";

// 32+ characters, and not one of the placeholders the server rejects.
process.env.JWT_SECRET =
  "test-only-jwt-secret-0123456789abcdef-0123456789abcdef";
process.env.QR_SIGNING_SECRET =
  "test-only-qr-secret-0123456789abcdef-0123456789abcdef";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/ticketing-test";
process.env.JWT_EXPIRES_IN = "1h";
process.env.PORT = "5001";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.SIGN_QR = "true";

// The demo endpoints are opt-in; the tests need them to be ON so the
// simulate-tamper endpoint can be exercised (and its guard verified).
process.env.ENABLE_DEMO_ENDPOINTS = "true";

process.env.DOOR_WINDOW_MINUTES_BEFORE = "240";
process.env.DOOR_WINDOW_MINUTES_AFTER = "360";

// ---------------------------------------------------------------------------
// 2. Database
// ---------------------------------------------------------------------------

mongoose.set("strictQuery", true);

/**
 * Starts the replica set and connects mongoose.  The promise is stored on
 * `globalThis` synchronously, so a test file's `beforeAll` can await it
 * even if the replica set is still coming up.
 */
const ready = (async () => {
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
      name: "testrs",
    },
  });

  const uri = replSet.getUri();

  await mongoose.connect(uri, {
    dbName: "ticketing-test",
    serverSelectionTimeoutMS: 20_000,
  });

  // Build the indexes explicitly.  `Model.init()` resolves once the index
  // build finished, so a test that relies on the unique seat index can
  // never run before it exists.
  const User = require("../models/User");
  const Event = require("../models/Event");
  const Ticket = require("../models/Ticket");
  const EntryLog = require("../models/EntryLog");
  const ChainState = require("../models/ChainState");
  const Payment = require("../models/Payment");

  await Promise.all([
    User.init(),
    Event.init(),
    Ticket.init(),
    EntryLog.init(),
    ChainState.init(),
    Payment.init(),
  ]);

  // Make sure the mongod child process dies with the test run.  Bun runs
  // every test file in one process, so this fires exactly once.
  process.on("exit", () => {
    const child = replSet.instance && replSet.instance.process;
    if (child && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* the process is already gone */
      }
    }
  });

  return { replSet, uri };
})();

globalThis.__TEST_DB_READY__ = ready;

// Surface an unhandled rejection from the bootstrap instead of hanging.
ready.catch((err) => {
  console.error("[tests] failed to start the in-memory MongoDB:", err);
  process.exitCode = 1;
});

module.exports = { ready };
