
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const Event = require("./models/Event");
const Ticket = require("./models/Ticket");
const EntryLog = require("./models/EntryLog");
const ChainState = require("./models/ChainState");
const {
  appendTicket,
  withChainTransaction,
  computeStatusHash,
  verifyFullChain,
  GENESIS_HASH,
} = require("./utils/hashChain");
const { buildQrPayloadString } = require("./utils/qr");

const BCRYPT_ROUNDS = 10;

const OWNED_COLLECTIONS = [
  "users",
  "events",
  "tickets",
  "entrylogs",
  "chainstates",
  "payments",
];

const USERS = [
  { name: "Alice Organizer", email: "alice@demo.com", password: "password123", role: "organizer" },
  { name: "Bob Buyer", email: "bob@demo.com", password: "password123", role: "buyer" },
  { name: "Carol Buyer", email: "carol@demo.com", password: "password123", role: "buyer" },
  { name: "Dave Staff", email: "dave@demo.com", password: "password123", role: "staff" },
  { name: "Eve Admin", email: "eve@demo.com", password: "password123", role: "admin" },
];

async function issue(ticketData) {
  try {
    return await withChainTransaction((session) =>
      appendTicket(ticketData, { session })
    );
  } catch (err) {
    if (err.status === 503) {
      // This deployment has no transaction support.
      return appendTicket(ticketData);
    }
    throw err;
  }
}

async function setStatus(ticket, status, extra = {}) {
  const statusUpdatedAt = new Date();
  const statusHash = computeStatusHash({
    currentHash: ticket.currentHash,
    status,
    statusUpdatedAt,
  });

  const update = {
    $set: { status, statusHash, statusUpdatedAt, ...extra },
  };

  const updated = await Ticket.findByIdAndUpdate(ticket._id, update, {
    returnDocument: "after",
  });

  return updated;
}

async function seed() {
  await connectDB();
  console.log("\nSeeding database...\n");

  // ── Drop ONLY the collections this app owns ──
  const existing = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const existingNames = new Set(existing.map((c) => c.name));

  for (const name of OWNED_COLLECTIONS) {
    if (existingNames.has(name)) {
      await mongoose.connection.db.dropCollection(name);
    }
  }
  console.log(`✓ Dropped ${OWNED_COLLECTIONS.length} application collections`);

  // ── Create users ──
  const userDocs = [];
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
    const user = await User.create({
      name: u.name,
      email: u.email,
      passwordHash,
      role: u.role,
    });
    userDocs.push(user);
  }
  const [organizer, buyer1, buyer2, staff, admin] = userDocs;

  console.log("✓ Created 5 users:");
  console.table(
    USERS.map((u) => ({
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
    }))
  );

  // ── Create events (dates in the future) ──
  const futureDate1 = new Date();
  futureDate1.setMonth(futureDate1.getMonth() + 1);
  const futureDate2 = new Date();
  futureDate2.setMonth(futureDate2.getMonth() + 2);

  const event1 = await Event.create({
    title: "Tech Conference 2027",
    description:
      "Annual technology conference featuring AI, blockchain, and cloud computing talks.",
    date: futureDate1,
    venue: "Convention Center Hall A",
    seatMap: ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"],
    price: 50,
    capacity: 10,
    organizerId: organizer._id,
  });

  const event2 = await Event.create({
    title: "Music Festival Night",
    description:
      "Live performances from indie bands and solo artists under the stars.",
    date: futureDate2,
    venue: "Open Air Amphitheater",
    seatMap: null, // General admission — no assigned seats
    price: 25,
    capacity: 100,
    organizerId: organizer._id,
  });

  console.log(`✓ Created events: "${event1.title}", "${event2.title}"`);

  // ── Issue tickets through the real appendTicket() path ──
  // This ensures the hash chain is genuinely valid.

  const seatTickets = [];
  const seatSpecs = [
    [event1, buyer1, "A1"],
    [event1, buyer1, "A2"],
    [event1, buyer2, "A3"],
    [event1, buyer2, "B1"],
  ];

  for (const [event, buyer, seat] of seatSpecs) {
    const ticket = await issue({
      eventId: event._id,
      buyerId: buyer._id,
      seatNumber: seat,
      status: "valid",
      issuedAt: new Date(),
    });
    await Ticket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          qrPayload: buildQrPayloadString({
            hash: ticket.currentHash,
            ticketId: ticket._id,
          }),
        },
      }
    );
    seatTickets.push(ticket);
  }

  // General-admission tickets (no seat).
  const gaTickets = [];
  for (const buyer of [buyer1, buyer1, buyer2, buyer2]) {
    const ticket = await issue({
      eventId: event2._id,
      buyerId: buyer._id,
      seatNumber: null,
      status: "valid",
      issuedAt: new Date(),
    });
    await Ticket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          qrPayload: buildQrPayloadString({
            hash: ticket.currentHash,
            ticketId: ticket._id,
          }),
        },
      }
    );
    gaTickets.push(ticket);
  }

  console.log("✓ Issued 8 tickets through appendTicket()");

  const usedTicket = await setStatus(seatTickets[1], "used");

  const original = seatTickets[0];
  const transferred = await setStatus(original, "transferred", {
    seatActive: false,
  });

  const replacement = await issue({
    eventId: event1._id,
    buyerId: buyer2._id,
    seatNumber: "A1",
    seatActive: true,
    status: "valid",
    issuedAt: new Date(),
    transferredFrom: transferred._id,
    originTicketId: transferred.originTicketId || transferred._id,
  });
  await Ticket.updateOne(
    { _id: replacement._id },
    {
      $set: {
        qrPayload: buildQrPayloadString({
          hash: replacement.currentHash,
          ticketId: replacement._id,
        }),
      },
    }
  );

  console.log("✓ Simulated 1 transfer (seat A1: Bob -> Carol)");

  for (const event of [event1, event2]) {
    const sold = await Ticket.countDocuments({
      eventId: event._id,
      status: { $in: ["valid", "used"] },
    });
    await Event.updateOne({ _id: event._id }, { $set: { ticketsSold: sold } });
  }

  // ── Create EntryLogs for admin stats ──
  const now = Date.now();

  // 1. A successful scan of the GA ticket.
  await EntryLog.create({
    ticketId: gaTickets[0]._id,
    eventId: event2._id,
    scannedBy: staff._id,
    scanResult: "valid",
    scannedHash: gaTickets[0].currentHash,
    timestamp: new Date(now - 3 * 60_000),
  });

  // 2. The scanned ticket's status becomes "used".
  await setStatus(gaTickets[0], "used");

  // 3. The SAME ticket scanned a second time -> already_used.
  await EntryLog.create({
    ticketId: gaTickets[0]._id,
    eventId: event2._id,
    scannedBy: staff._id,
    scanResult: "already_used",
    scannedHash: gaTickets[0].currentHash,
    timestamp: new Date(now - 2 * 60_000),
  });

  // 4. A forged hash -> invalid.
  await EntryLog.create({
    ticketId: null,
    eventId: event1._id,
    scannedBy: staff._id,
    scanResult: "invalid",
    scannedHash:
      "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    timestamp: new Date(now - 60_000),
  });

  // 5. Another forged hash -> invalid.
  await EntryLog.create({
    ticketId: null,
    eventId: event1._id,
    scannedBy: staff._id,
    scanResult: "invalid",
    scannedHash:
      "00000000000000000000000000000000000000000000000000000000000000ff",
    timestamp: new Date(now),
  });

  console.log("✓ Created 4 EntryLogs (valid, already_used, 2× invalid)");

  // ── Verify the chain ──
  //
  const chain = await verifyFullChain();

  if (!chain.valid) {
    console.error("\n✗ SEED FAILED — the hash chain does not verify:");
    console.error(JSON.stringify(chain.summary, null, 2));
    const broken = chain.links.find((l) => l.check.isBroken);
    if (broken) console.error(JSON.stringify(broken, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── Summary ──
  console.log(`  Seed complete. Chain has ${chain.summary.totalLinks} valid links.`);
  console.log(`  Genesis hash: ${GENESIS_HASH.slice(0, 16)}…`);
  console.log(
    `  Tickets: ${chain.summary.totalLinks} (seat A1 transferred, 2 scanned)`
  );

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
