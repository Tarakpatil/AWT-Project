const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const EntryLog = require("../models/EntryLog");
const Payment = require("../models/Payment");
const paymentService = require("../services/payment.service");
const {
  appendTicket,
  verifyChainLink,
  withChainTransaction,
  computeStatusHash,
} = require("../utils/hashChain");
const { generateQR, buildQrPayloadString, verifyQrSignature } = require("../utils/qr");
const { parsePagination } = require("../utils/pagination");
const { HttpError } = require("../utils/httpError");
const { env } = require("../config/env");

/** Ticket statuses a buyer may filter by. */
const TICKET_STATUSES = ["valid", "used", "transferred"];

const ACTIVE_TICKET_STATUSES = ["valid", "used"];

async function purchaseTicket(req, res, next) {
  try {
    const { eventId } = req.body;
    const buyerId = req.user.userId;

    if (!eventId) {
      throw new HttpError(400, "eventId is required");
    }

    //1. Validate event state
    const event = await Event.findById(eventId);
    if (!event) throw new HttpError(404, "Event not found");
    if (event.cancelled) throw new HttpError(400, "Event is cancelled");
    if (event.date < new Date()) throw new HttpError(400, "Event is in the past");

    //2. Validate the seat against the venue layout
    const seatNumber = normaliseSeatNumber(req.body.seatNumber);

    if (event.seatMap) {
      if (!seatNumber) {
        throw new HttpError(400, "seatNumber is required for this event");
      }
      const isValidSeat = Array.isArray(event.seatMap)
        ? event.seatMap.includes(seatNumber)
        : Object.prototype.hasOwnProperty.call(event.seatMap, seatNumber);

      if (!isValidSeat) {
        throw new HttpError(400, "Invalid seat number for this venue");
      }
    } else if (seatNumber) {
      // General-admission event: a seat cannot be requested.
      throw new HttpError(400, "This event is general admission — no seat can be selected");
    }

    // 3. Fast-path availability check (the unique index is authoritative)
    if (seatNumber) {
      const seatTaken = await Ticket.exists({
        eventId: event._id,
        seatNumber,
        seatActive: true,
      });
      if (seatTaken) {
        throw new HttpError(409, "Seat is already taken", { code: "SEAT_TAKEN" });
      }
    }

    //4. Payment (mock gateway seam)
    const payment = await paymentService.processPayment({
      amount: event.price,
      userId: buyerId,
      eventId: event._id,
    });

    if (!payment.success) {
      throw new HttpError(400, "Payment failed");
    }

    const paymentRecord = await Payment.create({
      userId: buyerId,
      eventId: event._id,
      amount: event.price,
      currency: payment.currency,
      transactionId: payment.transactionId,
      status: "captured",
    });

    //5. Issue the ticket (atomic: capacity + chain append)
    let ticket;
    try {
      ticket = await withChainTransaction(async (session) => {
        const reservedEvent = await Event.findOneAndUpdate(
          {
            _id: event._id,
            cancelled: false,
            $expr: { $lt: ["$ticketsSold", "$capacity"] },
          },
          { $inc: { ticketsSold: 1 } },
          { session, returnDocument: "after" }
        );

        if (!reservedEvent) {
          throw new HttpError(400, "Event is sold out");
        }

        const created = await appendTicket(
          {
            eventId: event._id,
            buyerId,
            seatNumber,
            seatActive: seatNumber !== null,
            status: "valid",
            issuedAt: new Date(),
          },
          { session }
        );

        const qrPayload = buildQrPayloadString({
          hash: created.currentHash,
          ticketId: created._id,
        });

        await Ticket.updateOne(
          { _id: created._id },
          { $set: { qrPayload } },
          { session }
        );

        created.qrPayload = qrPayload;

        return created;
      });
    } catch (err) {
      await refundPayment(paymentRecord, err.message);
      throw err;
    }

    // Link the payment to the issued ticket.
    await Payment.updateOne(
      { _id: paymentRecord._id },
      { $set: { ticketId: ticket._id } }
    );

    //6. QR
    let qrDataUrl = null;
    try {
      qrDataUrl = await generateQR({
        hash: ticket.currentHash,
        ticketId: ticket._id,
      });
    } catch (qrErr) {
      console.error("QR generation failed at purchase:", qrErr);
    }

    return res.status(201).json({ ticket, qrDataUrl });
  } catch (err) {
    next(err);
  }
}

async function refundPayment(paymentRecord, reason) {
  try {
    await paymentService.refund({
      transactionId: paymentRecord.transactionId,
      amount: paymentRecord.amount,
    });
    await Payment.updateOne(
      { _id: paymentRecord._id },
      { $set: { status: "refunded", failureReason: reason || null } }
    );
    console.warn(`[PAYMENT] refunded ${paymentRecord.transactionId}: ${reason}`);
  } catch (refundErr) {
    console.error(
      `[PAYMENT] FAILED to refund ${paymentRecord.transactionId}:`,
      refundErr
    );
  }
}

function normaliseSeatNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "object") {
    throw new HttpError(400, "seatNumber must be a string");
  }
  const value = String(raw).trim();
  return value === "" ? null : value;
}

async function getMyTickets(req, res, next) {
  try {
    const { status, page, limit } = req.query;
    const buyerId = req.user.userId;

    const filter = { buyerId };
    if (status) {
      if (!TICKET_STATUSES.includes(String(status))) {
        throw new HttpError(
          400,
          `Invalid status filter. Allowed values: ${TICKET_STATUSES.join(", ")}`
        );
      }
      filter.status = String(status);
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(
      { page, limit },
      { defaultLimit: 20, maxLimit: 100 }
    );

    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .populate("eventId", "title date venue")
        .sort({ seq: -1 }) // Newest chain link first
        .skip(skip)
        .limit(limitNum),
      Ticket.countDocuments(filter),
    ]);

    const data = tickets.map((ticket) => {
      const obj = ticket.toJSON();
      obj.qrPayload = ticket.status === "valid" ? ticket.qrPayload : null;
      return obj;
    });

    return res.json({ data, page: pageNum, limit: limitNum, total });
  } catch (err) {
    next(err);
  }
}

async function getTicketQr(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findById(id);

    if (!ticket) throw new HttpError(404, "Ticket not found");

    const isOwner = String(ticket.buyerId) === req.user.userId;
    const isStaff = req.user.role === "staff";
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isStaff && !isAdmin) {
      throw new HttpError(403, "Forbidden: you cannot view this ticket's QR code");
    }

    if (ticket.status !== "valid") {
      throw new HttpError(400, `QR code is not available for a ${ticket.status} ticket`);
    }

    const qrDataUrl = await generateQR({
      hash: ticket.currentHash,
      ticketId: ticket._id,
    });

    return res.json({ qrDataUrl, qrPayload: ticket.qrPayload });
  } catch (err) {
    next(err);
  }
}

async function logEntry(ticketId, scannedBy, result, hash, eventId = null) {
  try {
    await EntryLog.create({
      ticketId,
      scannedBy,
      scanResult: result,
      scannedHash: hash,
      eventId,
      timestamp: new Date(),
    });
  } catch (e) {
    console.error("Failed to write EntryLog:", e);
  }
}

async function verifyTicket(req, res, next) {
  try {
    const { hash, sig, ticketId, eventId } = req.body;
    const scannerId = req.user.userId;

    if (!hash) {
      throw new HttpError(400, "hash is required");
    }
    if (!eventId) {
      throw new HttpError(400, "eventId is required — a scanner must be assigned to an event");
    }

    //1. Cryptographic signature check (before touching the database)
    if (env.signQr) {
      if (!sig || !ticketId) {
        await logEntry(null, scannerId, "invalid", hash, eventId);
        return res.json({
          result: "invalid",
          reason: "Missing signature or ticketId in signed mode",
        });
      }
      if (!verifyQrSignature(hash, ticketId, sig)) {
        await logEntry(null, scannerId, "invalid", hash, eventId);
        return res.json({
          result: "invalid",
          reason: "Cryptographic signature mismatch",
        });
      }
    }

    //2. Lookup the ticket
    const ticket = await Ticket.findOne({ currentHash: hash });

    if (!ticket) {
      await logEntry(null, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Ticket not found or forged" });
    }

    // The signature covers (hash, ticketId) — make sure the caller did not
    // pair a valid hash with somebody else's ticket id.
    if (env.signQr && String(ticket._id) !== String(ticketId)) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Ticket id does not match hash" });
    }

    // ── 3. Event scoping ────────────────────────────────────────────────
    if (String(ticket.eventId) !== String(eventId)) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({
        result: "invalid",
        reason: "Ticket belongs to a different event",
      });
    }

    const event = await Event.findById(ticket.eventId).select("date cancelled title");
    if (!event) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Event not found" });
    }
    if (event.cancelled) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Event was cancelled" });
    }

    const doorState = evaluateDoorWindow(event.date);
    if (!doorState.open) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: doorState.reason });
    }

    //4. Status checks
    if (ticket.status === "used") {
      const priorLog = await EntryLog.findOne({
        ticketId: ticket._id,
        scanResult: "valid",
      })
        .populate("scannedBy", "name")
        .sort({ timestamp: 1 });

      await logEntry(ticket._id, scannerId, "already_used", hash, eventId);
      return res.json({
        result: "already_used",
        reason: "Ticket has already been used",
        scannedAt: priorLog ? priorLog.timestamp : null,
        scannedBy: priorLog?.scannedBy ? priorLog.scannedBy.name : "Unknown",
      });
    }

    if (ticket.status === "transferred") {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Ticket was transferred" });
    }

    //5. Verify the local hash chain link
    if (!verifyChainLink(ticket)) {
      await logEntry(ticket._id, scannerId, "invalid", hash, eventId);
      return res.json({ result: "invalid", reason: "Chain integrity failure" });
    }

    // 6. Atomically transition Valid -> Used
    const now = new Date();
    const statusHash = computeStatusHash({
      currentHash: ticket.currentHash,
      status: "used",
      statusUpdatedAt: now,
    });

    const updatedTicket = await Ticket.findOneAndUpdate(
      { _id: ticket._id, status: "valid" },
      { $set: { status: "used", statusHash, statusUpdatedAt: now } },
      { returnDocument: "after" }
    );

    if (!updatedTicket) {
      // It was valid a millisecond ago, but the atomic update failed, which
      // means another staff member scanned it at exactly the same time.
      const priorLog = await EntryLog.findOne({
        ticketId: ticket._id,
        scanResult: "valid",
      })
        .populate("scannedBy", "name")
        .sort({ timestamp: -1 });

      await logEntry(ticket._id, scannerId, "already_used", hash, eventId);
      return res.json({
        result: "already_used",
        reason: "Ticket has already been used",
        scannedAt: priorLog ? priorLog.timestamp : null,
        scannedBy: priorLog?.scannedBy ? priorLog.scannedBy.name : "Unknown",
      });
    }

    //7. Success
    await logEntry(ticket._id, scannerId, "valid", hash, eventId);
    return res.json({
      result: "valid",
      ticketId: ticket._id,
      eventId: ticket.eventId,
      seatNumber: ticket.seatNumber,
    });
  } catch (err) {
    next(err);
  }
}

function evaluateDoorWindow(eventDate) {
  // In development / demo mode, allow door scanning for all simulator test events
  if (env.isDevelopment) {
    return { open: true, reason: null };
  }

  const opensAt = new Date(
    new Date(eventDate).getTime() - env.doorOpensBeforeMinutes * 60_000
  );
  const closesAt = new Date(
    new Date(eventDate).getTime() + env.doorClosesAfterMinutes * 60_000
  );
  const now = new Date();

  if (now < opensAt) {
    return {
      open: false,
      reason: "The door for this event has not opened yet",
    };
  }
  if (now > closesAt) {
    return {
      open: false,
      reason: "The door for this event has already closed",
    };
  }
  return { open: true, reason: null, opensAt, closesAt };
}

async function transferTicket(req, res, next) {
  try {
    const { ticketId, recipientEmail } = req.body;
    const currentOwnerId = req.user.userId;

    if (!ticketId || !recipientEmail) {
      throw new HttpError(400, "ticketId and recipientEmail are required");
    }

    // 1. Validate the recipient
    const recipient = await User.findOne({
      email: String(recipientEmail).toLowerCase().trim(),
    });
    if (!recipient) throw new HttpError(404, "Recipient not found");
    if (recipient.role !== "buyer") {
      throw new HttpError(400, "Recipient must be a buyer");
    }
    if (String(recipient._id) === String(currentOwnerId)) {
      throw new HttpError(400, "Cannot transfer to yourself");
    }

    // 2. Atomic hand-off

    const newTicket = await withChainTransaction(async (session) => {

      const current = await Ticket.findOne(
        { _id: ticketId, buyerId: currentOwnerId, status: "valid" },
        null,
        { session }
      );

      if (!current) {
        throw new HttpError(
          400,
          "Ticket not found or no longer valid for transfer"
        );
      }

      const now = new Date();
      const releasedHash = computeStatusHash({
        currentHash: current.currentHash,
        status: "transferred",
        statusUpdatedAt: now,
      });

      // Release the seat.
      const released = await Ticket.findOneAndUpdate(
        { _id: current._id, status: "valid" },
        {
          $set: {
            status: "transferred",
            seatActive: false,
            statusHash: releasedHash,
            statusUpdatedAt: now,
          },
        },
        { session, returnDocument: "after" }
      );

      if (!released) {
        throw new HttpError(
          400,
          "Ticket not found or no longer valid for transfer"
        );
      }

      // Issue the replacement ticket into the chain.
      const created = await appendTicket(
        {
          eventId: current.eventId,
          buyerId: recipient._id,
          seatNumber: current.seatNumber,
          seatActive: current.seatNumber !== null,
          status: "valid",
          issuedAt: now,
          transferredFrom: current._id,
          originTicketId: current.originTicketId || current._id,
        },
        { session }
      );

      const qrPayload = buildQrPayloadString({
        hash: created.currentHash,
        ticketId: created._id,
      });

      await Ticket.updateOne(
        { _id: created._id },
        { $set: { qrPayload } },
        { session }
      );

      created.qrPayload = qrPayload;

      return created;
    });

    // 3. QR for the new ticket
    let qrDataUrl = null;
    try {
      qrDataUrl = await generateQR({
        hash: newTicket.currentHash,
        ticketId: newTicket._id,
      });
    } catch (qrErr) {
      console.error("QR generation failed during transfer:", qrErr);
    }

    return res.status(201).json({ ticket: newTicket, qrDataUrl });
  } catch (err) {
    next(err);
  }
}

async function getProvenance(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const ticket = await Ticket.findById(id).populate("eventId");
    if (!ticket) {
      throw new HttpError(404, "Ticket not found");
    }

    // Access control: Only current owner, event organizer, or admin.
    const isOwner = String(ticket.buyerId) === String(userId);
    const isOrganizer =
      ticket.eventId?.organizerId &&
      String(ticket.eventId.organizerId) === String(userId);
    const isAdmin = userRole === "admin";

    if (!isOwner && !isOrganizer && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You do not have permission to view this ticket's provenance"
      );
    }

    // Walk the transferredFrom chain backwards, with a hard depth limit and
    // cycle detection so a malformed chain can never hang the request.
    const MAX_DEPTH = 100;
    const history = [];
    const visited = new Set();
    let current = ticket;
    let depth = 0;

    while (current && depth < MAX_DEPTH) {
      const key = String(current._id);
      if (visited.has(key)) break; // cycle
      visited.add(key);

      await current.populate("buyerId", "name email");

      history.push({
        ticketId: current._id,
        ownerName: current.buyerId?.name ?? "Unknown",
        ownerEmail: current.buyerId?.email ?? null,
        issuedAt: current.issuedAt,
        status: current.status,
        seq: current.seq,
      });

      current = current.transferredFrom
        ? await Ticket.findById(current.transferredFrom)
        : null;
      depth++;
    }

    const truncated = depth >= MAX_DEPTH;

    return res.json({ history, truncated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  purchaseTicket,
  getMyTickets,
  getTicketQr,
  verifyTicket,
  transferTicket,
  getProvenance,
  ACTIVE_TICKET_STATUSES,
  TICKET_STATUSES,
};
