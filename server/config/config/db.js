const mongoose = require("mongoose");
const { env } = require("./env");

/**
 * Multi-document transactions require a replica set. The hash-chain append
 * path relies on transactions to stay gap-free, so we probe once at startup
 * and report clearly rather than failing later with a confusing error.
 */

mongoose.set("strictQuery", true);

/** @type {null | { supported: boolean, reason: string }} */
let transactionSupport = null;

async function connectDB() {
  const uri = env.mongoUri;

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      // Fail fast instead of buffering operations when the database is unreachable.
      bufferCommands: false,
    });

    console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);

    await probeTransactionSupport();

    return conn;
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Detects whether the connected deployment supports multi-document
 * transactions, and warns loudly when it does not.
 */
async function probeTransactionSupport() {
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    const hasReplicaSet =
      Boolean(info.setName) || Boolean(info.msg === "isdbgrid");

    transactionSupport = {
      supported: hasReplicaSet,
      reason: hasReplicaSet
        ? "replica set detected"
        : "connected to a standalone mongod",
    };

    if (!hasReplicaSet) {
      console.warn(
        "\n[WARN] This MongoDB deployment does NOT support transactions.\n" +
          "       The hash-chain append path will fall back to optimistic\n" +
          "       concurrency control, which can leave a gap in the chain if\n" +
          "       a ticket insert fails. For a replica set, start mongod with\n" +
          "       `--replSet rs0` and run `rs.initiate()`.\n"
      );
    } else {
      console.log(`MongoDB transactions: available (${transactionSupport.reason})`);
    }
  } catch (err) {
    transactionSupport = { supported: false, reason: `probe failed: ${err.message}` };
    console.warn(`[WARN] Could not determine transaction support: ${err.message}`);
  }
}

/** @returns {boolean} true when the deployment supports transactions */
function supportsTransactions() {
  return Boolean(transactionSupport?.supported);
}

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.supportsTransactions = supportsTransactions;
