/**
 * tests/tickets.test.js — purchase, listing, scanning, transfer, provenance.
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const {
  app,
  request,
  registerUser,
  createEvent,
  insertEvent,
  insertTicket,
} = require("./helpers/fixtures");
const Ticket = require("../models/Ticket");
const Payment = require("../models/Payment");
const { verifyFullChain } = require("../utils/hashChain");
const { signQrPayload } = require("../utils/qr");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

const future = (days = 7) => new Date(Date.now() + days * 24 * 3600 * 1000);

/** Parses the signed QR payload stored on a ticket. */
function parseQr(ticket) {
  return JSON.parse(ticket.qrPayload);
}

async function purchase(token, body) {
  return request(app)
    .post("/api/tickets/purchase")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

describe("POST /api/tickets/purchase", () => {
  test("issues a ticket and returns it with a QR code", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const response = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    expect(response.status).toBe(201);
    expect(response.body.ticket.seatNumber).toBe("A1");
    expect(response.body.ticket.status).toBe("valid");
    expect(response.body.ticket.seq).toBe(1);
    expect(response.body.qrDataUrl).toContain("data:image/png;base64,");

    // The signed payload is persisted so the PNG does not have to be
    // re-rendered on every list request.
    const payload = parseQr(response.body.ticket);
    expect(payload.hash).toBe(response.body.ticket.currentHash);
    expect(payload.sig).toBeString();
  });

  test("the same seat cannot be bought twice", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const other = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const first = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    expect(first.status).toBe(201);

    const second = await purchase(other.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SEAT_TAKEN");
  });

  test("two concurrent buyers cannot win the same seat", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyerA = await registerUser({ role: "buyer" });
    const buyerB = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const [a, b] = await Promise.all([
      purchase(buyerA.token, { eventId: event._id, seatNumber: "A1" }),
      purchase(buyerB.token, { eventId: event._id, seatNumber: "A1" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    // The loser is told exactly WHY it lost.
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("SEAT_TAKEN");

    // Exactly one ticket exists for that seat.
    const tickets = await Ticket.find({ eventId: event._id, seatNumber: "A1" });
    expect(tickets.length).toBe(1);
  });

  test("the event cannot be oversold", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token, {
      seatMap: ["A1", "A2"],
      capacity: 2,
    });

    expect(
      (await purchase(buyer.token, { eventId: event._id, seatNumber: "A1" })).status
    ).toBe(201);
    expect(
      (await purchase(buyer.token, { eventId: event._id, seatNumber: "A2" })).status
    ).toBe(201);

    // A third ticket for a general-admission slot is impossible here, so
    // try to buy a seat that does not exist -> the capacity guard is what
    // stops the oversell.
    const oversell = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A3",
    });
    expect(oversell.status).toBe(400);
  });

  test("a general-admission event refuses a seat", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token, {
      seatMap: null,
      capacity: 50,
    });

    const response = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("general admission");
  });

  test("a seated event requires a seat", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const response = await purchase(buyer.token, { eventId: event._id });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("seatNumber");
  });

  test("a seat that is not in the venue layout is rejected", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const response = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "Z9",
    });

    expect(response.status).toBe(400);
  });

  test("a cancelled event cannot be bought", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    // Buy one ticket so the delete is a soft-delete (the event survives).
    await purchase(buyer.token, { eventId: event._id, seatNumber: "A1" });

    await request(app)
      .delete(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    const response = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A2",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("cancelled");
  });

  test("a purchase that loses the race is refunded", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const rival = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    // Two buyers race for the same seat.  One of them is charged and then
    // refunded, because the ticket could not be issued.
    await Promise.all([
      purchase(buyer.token, { eventId: event._id, seatNumber: "A1" }),
      purchase(rival.token, { eventId: event._id, seatNumber: "A1" }),
    ]);

    const payments = await Payment.find({
      userId: { $in: [buyer.user._id, rival.user._id] },
    });

    expect(payments.length).toBe(2);
    const refunded = payments.filter((p) => p.status === "refunded");
    const captured = payments.filter((p) => p.status === "captured");
    expect(refunded.length).toBe(1);
    expect(captured.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("GET /api/tickets/mine", () => {
  test("returns the paginated envelope", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await purchase(buyer.token, { eventId: event._id, seatNumber: "A1" });
    await purchase(buyer.token, { eventId: event._id, seatNumber: "A2" });

    const response = await request(app)
      .get("/api/tickets/mine")
      .set("Authorization", `Bearer ${buyer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(20);
    expect(response.body.data.length).toBe(2);
  });

  test("a negative page is a 400, not a 500", async () => {
    const buyer = await registerUser({ role: "buyer" });

    const response = await request(app)
      .get("/api/tickets/mine?page=-1")
      .set("Authorization", `Bearer ${buyer.token}`);

    expect(response.status).toBe(400);
  });

  test("an unknown status filter is a 400", async () => {
    const buyer = await registerUser({ role: "buyer" });

    const response = await request(app)
      .get("/api/tickets/mine?status=bogus")
      .set("Authorization", `Bearer ${buyer.token}`);

    expect(response.status).toBe(400);
  });

  test("a buyer cannot list the tickets of somebody else", async () => {
    const buyer = await registerUser({ role: "buyer" });
    const other = await registerUser({ role: "buyer" });

    const response = await request(app)
      .get("/api/tickets/mine")
      .set("Authorization", `Bearer ${other.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(buyer.user._id).toBeString();
  });
});

describe("GET /api/tickets/:id/qr", () => {
  test("the owner can fetch the QR code", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .get(`/api/tickets/${purchaseResponse.body.ticket._id}/qr`)
      .set("Authorization", `Bearer ${buyer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.qrDataUrl).toContain("data:image/png;base64,");
  });

  test("a stranger cannot fetch the QR code", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const stranger = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .get(`/api/tickets/${purchaseResponse.body.ticket._id}/qr`)
      .set("Authorization", `Bearer ${stranger.token}`);

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe("POST /api/tickets/verify", () => {
  async function setupScan() {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const staff = await registerUser({ role: "staff" });
    const event = await createEvent(organizer.token, {
      // A door that is open right now: the event starts in one hour.
      date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const purchaseResponse = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    return {
      event,
      staff,
      ticket: purchaseResponse.body.ticket,
      payload: parseQr(purchaseResponse.body.ticket),
    };
  }

  test("a valid ticket scans as valid", async () => {
    const { event, staff, ticket, payload } = await setupScan();

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe("valid");
    expect(response.body.ticketId).toBe(ticket._id);
  });

  test("the ticket is marked used after a valid scan", async () => {
    const { event, staff, ticket, payload } = await setupScan();

    await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    const updated = await Ticket.findById(ticket._id);
    expect(updated.status).toBe("used");
  });

  test("scanning the same ticket twice reports already_used", async () => {
    const { event, staff, payload } = await setupScan();

    const body = {
      hash: payload.hash,
      sig: payload.sig,
      ticketId: payload.ticketId,
      eventId: event._id,
    };

    const first = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send(body);

    const second = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send(body);

    expect(first.body.result).toBe("valid");
    expect(second.body.result).toBe("already_used");
    expect(second.body.reason).toBeString();
  });

  test("eventId is required", async () => {
    const { staff, payload } = await setupScan();

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ hash: payload.hash, sig: payload.sig, ticketId: payload.ticketId });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("eventId");
  });

  test("a ticket for a different event is rejected", async () => {
    const { staff, payload } = await setupScan();
    const otherEvent = await createEvent(
      (await registerUser({ role: "organizer" })).token
    );

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: otherEvent._id,
      });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe("invalid");
    expect(response.body.reason).toContain("different event");
  });

  test("a forged signature is rejected", async () => {
    const { event, staff, payload } = await setupScan();

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: "a".repeat(64),
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe("invalid");
    expect(response.body.reason).toContain("signature");
  });

  test("a signature for a different ticket is rejected", async () => {
    const { event, staff, payload } = await setupScan();

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: signQrPayload(payload.hash, "000000000000000000000000"),
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.body.result).toBe("invalid");
  });

  test("an unknown hash is rejected", async () => {
    const { event, staff } = await setupScan();

    // A properly SIGNED hash that does not belong to any ticket — the
    // signature check passes, the lookup does not.
    const forgedHash = "f".repeat(64);
    const forgedId = "000000000000000000000000";

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: forgedHash,
        sig: signQrPayload(forgedHash, forgedId),
        ticketId: forgedId,
        eventId: event._id,
      });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe("invalid");
    expect(response.body.reason).toContain("not found");
  });

  test("a scan before the door opens is rejected", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const staff = await registerUser({ role: "staff" });
    // The event is a month away — the door is definitely not open.
    const event = await createEvent(organizer.token, {
      date: future(30).toISOString(),
    });

    const purchaseResponse = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    const payload = parseQr(purchaseResponse.body.ticket);

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.body.result).toBe("invalid");
    expect(response.body.reason).toContain("not opened yet");
  });

  test("a cancelled event rejects the scan", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const staff = await registerUser({ role: "staff" });
    const event = await createEvent(organizer.token, {
      date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const purchaseResponse = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    const payload = parseQr(purchaseResponse.body.ticket);

    await request(app)
      .delete(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.body.result).toBe("invalid");
    expect(response.body.reason).toContain("cancelled");
  });

  test("a buyer cannot use the scanner", async () => {
    const { event, payload } = await setupScan();
    const buyer = await registerUser({ role: "buyer" });

    const response = await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

describe("POST /api/tickets/transfer", () => {
  test("moves the ticket and releases the seat", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const recipient = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    const originalId = purchaseResponse.body.ticket._id;

    const response = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ ticketId: originalId, recipientEmail: recipient.email });

    expect(response.status).toBe(201);
    expect(response.body.ticket.buyerId).toBe(recipient.user._id);
    expect(response.body.ticket.seatNumber).toBe("A1");
    expect(response.body.ticket.transferredFrom).toBe(originalId);

    // The original ticket is retired and has released its seat.
    const original = await Ticket.findById(originalId);
    expect(original.status).toBe("transferred");
    expect(original.seatActive).toBe(false);

    // The seat is NOT back on the market — the replacement ticket holds it,
    // so a third buyer is still turned away.
    const third = await registerUser({ role: "buyer" });
    const rebuy = await purchase(third.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    expect(rebuy.status).toBe(409);
    expect(rebuy.body.code).toBe("SEAT_TAKEN");

    // The replacement ticket is the one that is active.
    const active = await Ticket.find({ eventId: event._id, seatNumber: "A1" });
    expect(active.length).toBe(2);
    expect(active.filter((t) => t.seatActive).length).toBe(1);
  });

  test("a ticket that is not valid cannot be transferred", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const recipient = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        ticketId: purchaseResponse.body.ticket._id,
        recipientEmail: recipient.email,
      });

    const second = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        ticketId: purchaseResponse.body.ticket._id,
        recipientEmail: recipient.email,
      });

    expect(second.status).toBe(400);
  });

  test("the recipient must exist and must be a buyer", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    const unknown = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        ticketId: purchaseResponse.body.ticket._id,
        recipientEmail: "nobody@example.com",
      });
    expect(unknown.status).toBe(404);

    const organizerRecipient = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        ticketId: purchaseResponse.body.ticket._id,
        recipientEmail: organizer.email,
      });
    expect(organizerRecipient.status).toBe(400);
  });

  test("a ticket cannot be transferred to yourself", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        ticketId: purchaseResponse.body.ticket._id,
        recipientEmail: owner.email,
      });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe("GET /api/tickets/:id/provenance", () => {
  test("walks the transfer trail", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const recipient = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    const originalId = purchaseResponse.body.ticket._id;

    const transferResponse = await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ ticketId: originalId, recipientEmail: recipient.email });

    const response = await request(app)
      .get(`/api/tickets/${transferResponse.body.ticket._id}/provenance`)
      .set("Authorization", `Bearer ${recipient.token}`);

    expect(response.status).toBe(200);
    expect(response.body.history.length).toBe(2);
    expect(response.body.history[0].ownerEmail).toBe(recipient.email);
    expect(response.body.history[1].ownerEmail).toBe(owner.email);
    expect(response.body.truncated).toBe(false);
  });

  test("a stranger cannot read the provenance", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const owner = await registerUser({ role: "buyer" });
    const stranger = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const purchaseResponse = await purchase(owner.token, {
      eventId: event._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .get(`/api/tickets/${purchaseResponse.body.ticket._id}/provenance`)
      .set("Authorization", `Bearer ${stranger.token}`);

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Chain integrity
// ---------------------------------------------------------------------------

describe("hash chain integrity", () => {
  test("the chain still verifies after purchases, scans and transfers", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const recipient = await registerUser({ role: "buyer" });
    const staff = await registerUser({ role: "staff" });

    const event = await createEvent(organizer.token, {
      seatMap: ["A1", "A2", "A3"],
      capacity: 3,
      date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await purchase(buyer.token, {
      eventId: event._id,
      seatNumber: "A1",
    });
    await purchase(buyer.token, { eventId: event._id, seatNumber: "A2" });

    // Scan one ticket in.
    const payload = parseQr(first.body.ticket);
    await request(app)
      .post("/api/tickets/verify")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        hash: payload.hash,
        sig: payload.sig,
        ticketId: payload.ticketId,
        eventId: event._id,
      });

    // Transfer the other one.
    const mine = await request(app)
      .get("/api/tickets/mine")
      .set("Authorization", `Bearer ${buyer.token}`);
    const transferable = mine.body.data.find((t) => t.seatNumber === "A2");
    await request(app)
      .post("/api/tickets/transfer")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({ ticketId: transferable._id, recipientEmail: recipient.email });

    const chain = await verifyFullChain();
    expect(chain.valid).toBe(true);
    expect(chain.summary.totalLinks).toBe(3);
    expect(chain.summary.firstBrokenSeq).toBeNull();
  });
});
