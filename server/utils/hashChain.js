const crypto = require("crypto");
const mongoose = require("mongoose");
const Ticket = require("../models/Ticket");
const ChainState = require("../models/ChainState");
const { HttpError } = require("./httpError");

const GENESIS_HASH = crypto
  .createHash("sha256")
  .update("GENESIS")
  .digest("hex");

const SEP = "|";

function canonicalPayload(fields) {
  const {
    eventId,
    buyerId,
    seatNumber,
    seq,
    previousHash,
    issuedAt,
    transferredFrom,
    originTicketId,
  } = fields;

  return [
    String(eventId),
    String(buyerId),
    seatNumber === null || seatNumber === undefined ? "null" : String(seatNumber),
    String(seq),
    String(previousHash),
    new Date(issuedAt).toISOString(),
    transferredFrom === null || transferredFrom === undefined
      ? "null"
      : String(transferredFrom),
    originTicketId === null || originTicketId === undefined
      ? "null"
      : String(originTicketId),
  ].join(SEP);
}

/** SHA-256 of the canonical payload. */
function computeHash(fields) {
  const payload = canonicalPayload(fields);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function computeStatusHash({ currentHash, status, statusUpdatedAt }) {
  const ts = statusUpdatedAt
    ? new Date(statusUpdatedAt).toISOString()
    : new Date(0).toISOString();
  return crypto
    .createHash("sha256")
    .update(`${String(currentHash)}${SEP}${String(status)}${SEP}${ts}`)
    .digest("hex");
}

function verifyChainLink(ticket) {
  if (!ticket) return false;
  if (computeHash(ticket) !== ticket.currentHash) return false;
  if (!ticket.statusHash) return false;
  if (computeStatusHash(ticket) !== ticket.statusHash) return false;
  return true;
}

async function ensureChainState() {
  try {
    await ChainState.updateOne(
      { _id: "main" },
      { $setOnInsert: { seq: 0, lastHash: GENESIS_HASH } },
      { upsert: true }
    );
  } catch (err) {
    // 11000 = another writer inserted it first. That is a success for us.
    if (err.code !== 11000) throw err;
  }
}

async function appendTicket(ticketData, options = {}) {
  const { session } = options;

  if (session) {
    return appendTransactional(ticketData, session);
  }
  return appendOptimistic(ticketData);
}

async function appendTransactional(ticketData, session) {
  await ensureChainState();

  const state = await ChainState.findById("main", null, { session });
  if (!state) {
    throw new HttpError(500, "Hash chain tip is missing and could not be created.");
  }

  const seq = state.seq + 1;
  const previousHash = state.lastHash;
  const issuedAt = ticketData.issuedAt || new Date();
  const status = ticketData.status || "valid";

  const currentHash = computeHash({
    ...ticketData,
    seq,
    previousHash,
    issuedAt,
  });

  const updatedState = await ChainState.findOneAndUpdate(
    { _id: "main", seq: state.seq },
    { $set: { seq, lastHash: currentHash } },
    { session, returnDocument: "after" }
  );

  if (!updatedState) {
    const err = new HttpError(409, "Hash chain tip changed concurrently; please retry.");
    err.retryable = true;
    throw err;
  }

  const seatNumber = ticketData.seatNumber ?? null;
  const seatActive =
    ticketData.seatActive !== undefined
      ? Boolean(ticketData.seatActive)
      : seatNumber !== null;

  const [ticket] = await Ticket.create(
    [
      {
        ...ticketData,
        seatNumber,
        seatActive,
        seq,
        previousHash,
        currentHash,
        issuedAt,
        status,
        statusHash: computeStatusHash({
          currentHash,
          status,
          statusUpdatedAt: issuedAt,
        }),
        statusUpdatedAt: issuedAt,
      },
    ],
    { session }
  );

  return ticket;
}

/** Optimistic append — used only when transactions are unavailable. */
async function appendOptimistic(ticketData) {
  await ensureChainState();

  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const state = await ChainState.findById("main");
    if (!state) {
      throw new HttpError(500, "Hash chain tip is missing.");
    }

    const seq = state.seq + 1;
    const previousHash = state.lastHash;
    const issuedAt = ticketData.issuedAt || new Date();
    const status = ticketData.status || "valid";

    const currentHash = computeHash({
      ...ticketData,
      seq,
      previousHash,
      issuedAt,
    });

    const updatedState = await ChainState.findOneAndUpdate(
      { _id: "main", seq: state.seq },
      { $set: { seq, lastHash: currentHash } },
      { returnDocument: "after" }
    );

    if (!updatedState) {
      // The tip advanced while we were computing — try again.
      continue;
    }

    const seatNumber = ticketData.seatNumber ?? null;
    const seatActive =
      ticketData.seatActive !== undefined
        ? Boolean(ticketData.seatActive)
        : seatNumber !== null;

    try {
      const [ticket] = await Ticket.create([
        {
          ...ticketData,
          seatNumber,
          seatActive,
          seq,
          previousHash,
          currentHash,
          issuedAt,
          status,
          statusHash: computeStatusHash({
            currentHash,
            status,
            statusUpdatedAt: issuedAt,
          }),
          statusUpdatedAt: issuedAt,
        },
      ]);
      return ticket;
    } catch (err) {
      // Roll the tip back — but ONLY if it is still the one we advanced.
      // Rolling back the wrong tip would destroy a seq another writer owns.
      const rolledBack = await ChainState.updateOne(
        { _id: "main", seq },
        { $set: { seq: state.seq, lastHash: state.lastHash } }
      );

      if (rolledBack.matchedCount === 0) {
        // Somebody advanced the tip past us; our seq is now burned and the
        // chain has a gap. Fail loudly rather than silently corrupting the chain.
        throw new HttpError(
          503,
          "Ticket append failed and the hash chain could not be rolled back " +
            "(concurrent write). This deployment must support MongoDB " +
            "transactions — run a replica set."
        );
      }

      throw err;
    }
  }

  throw new HttpError(503, "Failed to append ticket to the hash chain due to high concurrency.");
}

async function withChainTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (isTransactionUnsupported(err)) {
      throw new HttpError(
        503,
        "This MongoDB deployment does not support transactions. The hash chain " +
          "requires a replica set (MongoDB Atlas always provides one; locally run " +
          "`mongod --replSet rs0` and then `rs.initiate()`)."
      );
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/** Detects the "transactions not supported" server error. */
function isTransactionUnsupported(err) {
  if (!err) return false;
  const message = String(err.message || "");
  return (
    err.code === 20 ||
    /Transaction numbers are only allowed/i.test(message) ||
    /Transactions are not supported/i.test(message) ||
    /replica set member or mongos/i.test(message)
  );
}

async function verifyFullChain() {
  const tickets = await Ticket.find()
    .sort({ seq: 1 })
    .lean()
    .select({
      _id: 1,
      seq: 1,
      eventId: 1,
      buyerId: 1,
      seatNumber: 1,
      currentHash: 1,
      previousHash: 1,
      status: 1,
      statusHash: 1,
      statusUpdatedAt: 1,
      issuedAt: 1,
      transferredFrom: 1,
      originTicketId: 1,
    });

  const links = [];
  let expectedPreviousHash = GENESIS_HASH;
  let expectedSeq = 1;
  let validCount = 0;
  let firstBrokenSeq = null;

  for (const ticket of tickets) {
    const contiguityOk = ticket.seq === expectedSeq;
    const linkageOk = ticket.previousHash === expectedPreviousHash;
    const fieldIntegrityOk = computeHash(ticket) === ticket.currentHash;
    const statusIntegrityOk =
      Boolean(ticket.statusHash) && computeStatusHash(ticket) === ticket.statusHash;

    const isBroken =
      !contiguityOk || !linkageOk || !fieldIntegrityOk || !statusIntegrityOk;

    let failureReason = null;
    if (!contiguityOk) {
      failureReason = `Expected seq ${expectedSeq}, found ${ticket.seq}`;
    } else if (!linkageOk) {
      failureReason = "previousHash does not match the expected prior hash";
    } else if (!fieldIntegrityOk) {
      failureReason = "Recomputed hash does not match stored currentHash";
    } else if (!statusIntegrityOk) {
      failureReason = "status does not match stored statusHash";
    }

    if (isBroken && firstBrokenSeq === null) {
      firstBrokenSeq = ticket.seq;
    }
    if (!isBroken) validCount++;

    links.push({
      seq: ticket.seq,
      ticketId: ticket._id,
      eventId: ticket.eventId,
      buyerId: ticket.buyerId,
      seatNumber: ticket.seatNumber,
      currentHash: ticket.currentHash,
      previousHash: ticket.previousHash,
      status: ticket.status,
      issuedAt: ticket.issuedAt,
      transferredFrom: ticket.transferredFrom,
      originTicketId: ticket.originTicketId,
      check: {
        contiguityOk,
        linkageOk,
        fieldIntegrityOk,
        statusIntegrityOk,
        isBroken,
        failureReason,
      },
    });

    expectedPreviousHash = ticket.currentHash;
    expectedSeq = ticket.seq + 1;
  }

  const chainValid = firstBrokenSeq === null;

  return {
    valid: chainValid,
    summary: {
      totalLinks: links.length,
      valid: validCount,
      firstBrokenSeq,
      chainValid,
    },
    links,
  };
}

module.exports = {
  GENESIS_HASH,
  canonicalPayload,
  computeHash,
  computeStatusHash,
  appendTicket,
  ensureChainState,
  withChainTransaction,
  verifyChainLink,
  verifyFullChain,
};
