/**
 * tests/chain.test.js — unit tests for the hash-chain primitives.
 *
 * These cover the invariants that the API tests only exercise indirectly:
 *   - the canonical payload does NOT contain `status`
 *   - `statusHash` covers the status and its timestamp
 *   - `verifyChainLink` detects a tampered field and a tampered status
 *   - `verifyFullChain` detects a broken field, a broken link and a gap
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const {
  GENESIS_HASH,
  canonicalPayload,
  computeHash,
  computeStatusHash,
  verifyChainLink,
  verifyFullChain,
} = require("../utils/hashChain");
const Ticket = require("../models/Ticket");
const { createUser } = require("./helpers/fixtures");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** A complete, self-consistent link. */
function link(overrides = {}) {
  const base = {
    eventId: "65f0000000000000000000a1",
    buyerId: "65f0000000000000000000b1",
    seatNumber: "A1",
    seq: 1,
    previousHash: GENESIS_HASH,
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    transferredFrom: null,
    originTicketId: null,
    status: "valid",
    statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const fields = { ...base, ...overrides };
  const currentHash = computeHash(fields);
  const statusHash = computeStatusHash({
    currentHash,
    status: fields.status,
    statusUpdatedAt: fields.statusUpdatedAt,
  });

  return { ...fields, currentHash, statusHash };
}

describe("canonicalPayload", () => {
  test("does not contain the status", () => {
    const payload = canonicalPayload({
      eventId: "e",
      buyerId: "b",
      seatNumber: "A1",
      seq: 1,
      previousHash: GENESIS_HASH,
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      transferredFrom: null,
      originTicketId: null,
      status: "valid",
    });

    expect(payload).not.toContain("valid");
    expect(payload.split("|")).toHaveLength(8);
  });

  test("two links that differ only in status hash identically", () => {
    const a = link({ status: "valid" });
    const b = link({ status: "used" });

    expect(computeHash(a)).toBe(computeHash(b));
  });

  test("a changed seat changes the hash", () => {
    const a = link({ seatNumber: "A1" });
    const b = link({ seatNumber: "A2" });

    expect(computeHash(a)).not.toBe(computeHash(b));
  });

  test("a changed buyer changes the hash", () => {
    const a = link({ buyerId: "65f0000000000000000000b1" });
    const b = link({ buyerId: "65f0000000000000000000b2" });

    expect(computeHash(a)).not.toBe(computeHash(b));
  });

  test("the transfer trail is part of the payload", () => {
    const a = link();
    const b = link({
      transferredFrom: "65f0000000000000000000c1",
      originTicketId: "65f0000000000000000000c1",
    });

    expect(computeHash(a)).not.toBe(computeHash(b));
  });
});

describe("computeStatusHash", () => {
  test("changes when the status changes", () => {
    const valid = computeStatusHash({
      currentHash: "abc",
      status: "valid",
      statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const used = computeStatusHash({
      currentHash: "abc",
      status: "used",
      statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(valid).not.toBe(used);
  });

  test("changes when the status timestamp changes", () => {
    const first = computeStatusHash({
      currentHash: "abc",
      status: "valid",
      statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = computeStatusHash({
      currentHash: "abc",
      status: "valid",
      statusUpdatedAt: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(first).not.toBe(second);
  });

  test("changes when the chain hash changes", () => {
    const first = computeStatusHash({
      currentHash: "abc",
      status: "valid",
      statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = computeStatusHash({
      currentHash: "abd",
      status: "valid",
      statusUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(first).not.toBe(second);
  });
});

describe("verifyChainLink", () => {
  test("accepts an untouched link", () => {
    expect(verifyChainLink(link())).toBe(true);
  });

  test("rejects a link whose seat was edited", () => {
    const tampered = link();
    tampered.seatNumber = "B9";

    expect(verifyChainLink(tampered)).toBe(false);
  });

  test("rejects a link whose buyer was edited", () => {
    const tampered = link();
    tampered.buyerId = "65f0000000000000000000ff";

    expect(verifyChainLink(tampered)).toBe(false);
  });

  test("rejects a link whose status was changed without updating statusHash", () => {
    const tampered = link();
    tampered.status = "used";

    expect(verifyChainLink(tampered)).toBe(false);
  });

  test("rejects a link with no status hash at all", () => {
    const tampered = link();
    tampered.statusHash = undefined;

    expect(verifyChainLink(tampered)).toBe(false);
  });

  test("rejects a missing ticket", () => {
    expect(verifyChainLink(null)).toBe(false);
  });
});

describe("verifyFullChain", () => {
  async function seedChain(count = 3) {
    const buyer = await createUser({ role: "buyer" });
    const organizer = await createUser({ role: "organizer" });

    const Event = require("../models/Event");
    const { appendTicket, withChainTransaction } = require("../utils/hashChain");

    const event = await Event.create({
      title: "Chain Event",
      description: "An event used by the chain tests",
      date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      venue: "Venue",
      seatMap: ["A1", "A2", "A3", "A4"],
      capacity: 4,
      price: 10,
      organizerId: organizer._id,
    });

    const tickets = [];
    for (let i = 0; i < count; i++) {
      const ticket = await withChainTransaction((session) =>
        appendTicket(
          {
            eventId: event._id,
            buyerId: buyer._id,
            seatNumber: `A${i + 1}`,
            status: "valid",
            issuedAt: new Date(),
          },
          { session }
        )
      );
      tickets.push(ticket);
    }

    return { event, tickets };
  }

  test("an empty chain is valid", async () => {
    const chain = await verifyFullChain();

    expect(chain.valid).toBe(true);
    expect(chain.summary.totalLinks).toBe(0);
    expect(chain.summary.firstBrokenSeq).toBeNull();
  });

  test("a freshly built chain is valid and contiguous", async () => {
    const { tickets } = await seedChain(3);
    const chain = await verifyFullChain();

    expect(chain.valid).toBe(true);
    expect(chain.summary.totalLinks).toBe(3);
    expect(chain.summary.valid).toBe(3);
    expect(chain.summary.firstBrokenSeq).toBeNull();
    expect(chain.links.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  test("the first link is anchored to the genesis hash", async () => {
    const { tickets } = await seedChain(1);
    const chain = await verifyFullChain();

    expect(chain.links[0].previousHash).toBe(GENESIS_HASH);
    expect(tickets[0].previousHash).toBe(GENESIS_HASH);
  });

  test("detects a field that was edited behind the application's back", async () => {
    const { tickets } = await seedChain(3);

    // Bypass Mongoose entirely — this is a raw database edit.
    await Ticket.collection.updateOne(
      { _id: tickets[1]._id },
      { $set: { seatNumber: "Z9" } }
    );

    const chain = await verifyFullChain();

    expect(chain.valid).toBe(false);
    expect(chain.summary.firstBrokenSeq).toBe(2);
    expect(chain.links[1].check.isBroken).toBe(true);
    expect(chain.links[1].check.fieldIntegrityOk).toBe(false);
    // The links before and after the tampered one are still self-consistent.
    expect(chain.links[0].check.isBroken).toBe(false);
  });

  test("detects a status that was changed without updating the status hash", async () => {
    const { tickets } = await seedChain(2);

    await Ticket.collection.updateOne(
      { _id: tickets[0]._id },
      { $set: { status: "used" } }
    );

    const chain = await verifyFullChain();

    expect(chain.valid).toBe(false);
    expect(chain.summary.firstBrokenSeq).toBe(1);
    expect(chain.links[0].check.statusIntegrityOk).toBe(false);
  });

  test("detects a broken link", async () => {
    const { tickets } = await seedChain(3);

    await Ticket.collection.updateOne(
      { _id: tickets[1]._id },
      { $set: { previousHash: GENESIS_HASH } }
    );

    const chain = await verifyFullChain();

    expect(chain.valid).toBe(false);
    expect(chain.links[1].check.linkageOk).toBe(false);
  });

  test("detects a gap in the sequence", async () => {
    const { tickets } = await seedChain(3);

    // Remove the middle link — the chain is now 1, 3.
    await Ticket.collection.deleteOne({ _id: tickets[1]._id });

    const chain = await verifyFullChain();

    expect(chain.valid).toBe(false);
    expect(chain.links[1].seq).toBe(3);
    expect(chain.links[1].check.contiguityOk).toBe(false);
    expect(chain.links[1].check.failureReason).toContain("Expected seq 2");
  });

  test("a legitimate status change keeps the chain valid", async () => {
    const { tickets } = await seedChain(2);

    const now = new Date();
    const statusHash = computeStatusHash({
      currentHash: tickets[0].currentHash,
      status: "used",
      statusUpdatedAt: now,
    });

    await Ticket.collection.updateOne(
      { _id: tickets[0]._id },
      { $set: { status: "used", statusHash, statusUpdatedAt: now } }
    );

    const chain = await verifyFullChain();

    expect(chain.valid).toBe(true);
    expect(chain.summary.valid).toBe(2);
  });
});
