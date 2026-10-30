const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const mongoose = require("mongoose");
const { parsePagination } = require("../utils/pagination");
const { buildSearchRegex } = require("../utils/regex");
const { HttpError } = require("../utils/httpError");

const ALLOWED_EVENT_FIELDS = [
  "title",
  "description",
  "date",
  "venue",
  "seatMap",
  "price",
  "capacity",
];

const ACTIVE_TICKET_STATUSES = ["valid", "used"];

/** Roles that may list an event's tickets. */
const TICKET_LIST_ROLES = ["staff", "admin"];

/** Pick only whitelisted fields from a body object. */
function pickFields(body, allowed) {
  const result = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      result[key] = body[key];
    }
  }
  return result;
}

async function checkOwnership(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid event ID format");
    }

    const event = await Event.findById(id);

    if (!event) {
      throw new HttpError(404, "Event not found");
    }

    if (String(event.organizerId) !== String(req.user.userId)) {
      throw new HttpError(403, "Forbidden: you do not own this event");
    }

    // Attach for downstream use — avoids a second DB query in the handler.
    req.event = event;
    next();
  } catch (err) {
    next(err);
  }
}

// --------------- Controllers ---------------

async function createEvent(req, res, next) {
  try {
    const fields = pickFields(req.body, ALLOWED_EVENT_FIELDS);
    fields.organizerId = req.user.userId;

    const event = await Event.create(fields);
    return res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
}

async function listEvents(req, res, next) {
  try {
    const filter = {};

    const mineOnly = String(req.query.organizer || "").toLowerCase() === "me";
    if (mineOnly) {
      filter.organizerId = req.user.userId;
    } else {
      filter.cancelled = false;
    }

    const searchRegex = buildSearchRegex(req.query.q);
    if (searchRegex) {
      filter.$or = [{ title: searchRegex }, { venue: searchRegex }];
    }

    // ── Date range ──
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) {
        const from = new Date(req.query.from);
        if (Number.isNaN(from.getTime())) {
          throw new HttpError(400, "Invalid 'from' date");
        }
        filter.date.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        if (Number.isNaN(to.getTime())) {
          throw new HttpError(400, "Invalid 'to' date");
        }
        filter.date.$lte = to;
      }
    }

    // ── Pagination ──
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const [data, total] = await Promise.all([
      Event.find(filter)
        .populate("organizerId", "name email role")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limit),
      Event.countDocuments(filter),
    ]);

    return res.json({ data, page, limit, total });
  } catch (err) {
    next(err);
  }
}

async function getEvent(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid event ID format");
    }

    const event = await Event.findById(id).populate(
      "organizerId",
      "name email role"
    );
    if (!event) {
      throw new HttpError(404, "Event not found");
    }

    const activeTickets = await Ticket.find(
      { eventId: event._id, status: { $in: ACTIVE_TICKET_STATUSES } },
      { seatNumber: 1, _id: 0 }
    ).lean();

    const takenSeats = activeTickets
      .map((t) => t.seatNumber)
      .filter((s) => s !== null && s !== undefined);

    const ticketsSold = activeTickets.length;
    const remainingCapacity = Math.max(0, event.capacity - ticketsSold);

    return res.json({
      event,
      takenSeats,
      ticketsSold,
      remainingCapacity,
    });
  } catch (err) {
    next(err);
  }
}

async function listEventTickets(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid event ID format");
    }

    const event = await Event.findById(id).select("_id title organizerId");
    if (!event) {
      throw new HttpError(404, "Event not found");
    }

    const isOwner = String(event.organizerId) === String(req.user.userId);
    const isPrivileged = TICKET_LIST_ROLES.includes(req.user.role);
    if (!isOwner && !isPrivileged) {
      throw new HttpError(403, "Forbidden: you cannot list this event's tickets");
    }

    const filter = { eventId: event._id };

    if (req.query.status) {
      const status = String(req.query.status);
      if (!ACTIVE_TICKET_STATUSES.includes(status) && status !== "transferred") {
        throw new HttpError(
          400,
          "Invalid status filter. Allowed values: valid, used, transferred"
        );
      }
      filter.status = status;
    }

    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const [data, total] = await Promise.all([
      Ticket.find(filter)
        .populate("buyerId", "name email")
        .sort({ seq: 1 })
        .skip(skip)
        .limit(limit),
      Ticket.countDocuments(filter),
    ]);

    return res.json({ data, page, limit, total });
  } catch (err) {
    next(err);
  }
}

async function updateEvent(req, res, next) {
  try {
    const fields = pickFields(req.body, ALLOWED_EVENT_FIELDS);

    if (Object.keys(fields).length === 0) {
      throw new HttpError(400, "No valid fields provided for update");
    }

    const layoutChangeRequested =
      fields.seatMap !== undefined || fields.capacity !== undefined;

    if (layoutChangeRequested) {
      const soldCount = await Ticket.countDocuments({
        eventId: req.event._id,
        status: { $in: ACTIVE_TICKET_STATUSES },
      });

      if (soldCount > 0) {
        throw new HttpError(
          409,
          "The venue layout (seatMap) and capacity cannot be changed after tickets have been sold"
        );
      }
    }

    // Apply fields and run validators
    Object.assign(req.event, fields);
    await req.event.save({ validateModifiedOnly: true });

    return res.json({ event: req.event });
  } catch (err) {
    next(err);
  }
}

async function deleteEvent(req, res, next) {
  try {
    const ticketCount = await Ticket.countDocuments({
      eventId: req.event._id,
    });

    if (ticketCount > 0) {
      // Soft-delete — tickets exist, must preserve references
      req.event.cancelled = true;
      await req.event.save();
      return res.json({
        message:
          "Event cancelled (soft-deleted to preserve ticket chain integrity)",
        event: req.event,
      });
    }

    // Hard-delete — no tickets, nothing to orphan
    await Event.findByIdAndDelete(req.event._id);
    return res.json({ message: "Event deleted" });
  } catch (err) {
    next(err);
  }
}

async function getAnalytics(req, res, next) {
  try {
    const event = req.event; // set by checkOwnership

    const [result] = await Ticket.aggregate([
      { $match: { eventId: event._id } },
      {
        $facet: {
          total: [{ $count: "count" }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        },
      },
    ]);

    // Build the status breakdown with defaults
    const statusBreakdown = { valid: 0, used: 0, transferred: 0 };
    for (const entry of result.byStatus) {
      if (entry._id in statusBreakdown) {
        statusBreakdown[entry._id] = entry.count;
      }
    }

    // Only ACTIVE tickets are sold: a transferred ticket is dead, its seat
    // belongs to the replacement ticket.
    const ticketsSold =
      statusBreakdown.valid + statusBreakdown.used;
    const revenue = ticketsSold * event.price;
    const remainingCapacity = Math.max(0, event.capacity - ticketsSold);

    return res.json({
      eventId: event._id,
      title: event.title,
      ticketsSold,
      revenue,
      remainingCapacity,
      statusBreakdown,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createEvent,
  listEvents,
  getEvent,
  listEventTickets,
  updateEvent,
  deleteEvent,
  getAnalytics,
  checkOwnership,
  ALLOWED_EVENT_FIELDS,
  ACTIVE_TICKET_STATUSES,
};
