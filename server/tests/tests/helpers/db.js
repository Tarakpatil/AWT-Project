/**
 * tests/helpers/db.js — shared database helpers for the test suite.
 */
const mongoose = require("mongoose");
const ChainState = require("../../models/ChainState");
const { GENESIS_HASH } = require("../../utils/hashChain");
const { resetAll: resetRateLimiters } = require("../../middleware/limiters");

/** Waits for the in-memory replica set to be up and mongoose to be connected. */
async function connect() {
  const ready = globalThis.__TEST_DB_READY__;
  if (!ready) {
    throw new Error(
      "The test bootstrap did not run. Add a [test] preload entry to bunfig.toml."
    );
  }
  await ready;
  return mongoose.connection;
}

/**
 * Empties every collection and resets the hash-chain tip to genesis.
 *
 * `deleteMany` is used rather than `drop` so the indexes (notably the
 * unique `{eventId, seatNumber}` index) survive the reset.
 */
async function resetDatabase() {
  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  for (const collection of collections) {
    await mongoose.connection.db.collection(collection.name).deleteMany({});
  }

  await ChainState.deleteMany({});
  await ChainState.create({ _id: "main", seq: 0, lastHash: GENESIS_HASH });

  // The rate limiters are process-wide; without a reset a test suite
  // trips its own limits and starts failing with 429.
  resetRateLimiters();
}

module.exports = { connect, resetDatabase };
