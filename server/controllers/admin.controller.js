const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const EntryLog = require("../models/EntryLog");
const { verifyFullChain } = require("../utils/hashChain");
const { parsePagination } = require("../utils/pagination");
const { buildSearchRegex } = require("../utils/regex");
const { HttpError } = require("../utils/httpError");
const { env } = require("../config/env");

async function getChain(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    // Full chain walk for summary + per-link verdicts
    const chain = await verifyFullChain();

    const pageData = chain.links.slice(skip, skip + limit).map((link) => ({
      ...link,
      displayHash: link.currentHash
        ? `${link.currentHash.slice(0, 12)}…`
        : null,
    }));

    return res.json({
      summary: {
        ...chain.summary,
        chainValid: chain.valid,
      },
      data: pageData,
      page,
      limit,
      total: chain.links.length,
    });
  } catch (err) {
    next(err);
  }
}

// get chain

const CHAIN_SUMMARY_TTL_MS = 15_000;
let chainSummaryCache = { value: null, expiresAt: 0 };

async function getCachedChainSummary() {
  const now = Date.now();
  if (chainSummaryCache.value && chainSummaryCache.expiresAt > now) {
    return chainSummaryCache.value;
  }

  const chain = await verifyFullChain();
  const summary = {
    chainValid: chain.valid,
    totalLinks: chain.summary.totalLinks,
    validLinks: chain.summary.valid,
    firstBrokenSeq: chain.summary.firstBrokenSeq,
  };

  chainSummaryCache = { value: summary, expiresAt: now + CHAIN_SUMMARY_TTL_MS };
  return summary;
}

// for test to catch

function clearChainSummaryCache() {
  chainSummaryCache = { value: null, expiresAt: 0 };
}

async function getStats(req, res, next) {
  try {
    // Run all aggregations concurrently
    const [
      ticketsSold,
      activeEvents,
      entryAgg,
      dailyScans,
      chainSummary,
    ] = await Promise.all([
      // Only ACTIVE tickets count as sold — a transferred ticket is dead.
      Ticket.countDocuments({ status: { $in: ["valid", "used"] } }),
      Event.countDocuments({ cancelled: false }),

      // Entry scan stats in a single pipeline
      EntryLog.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            fraud: [
              { $match: { scanResult: { $ne: "valid" } } },
              { $count: "count" },
            ],
          },
        },
      ]),

      // Time series: scans per day for charts
      EntryLog.aggregate([
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
      ]),

      getCachedChainSummary(),
    ]);

    const entriesScanned = entryAgg[0]?.total[0]?.count || 0;
    const fraudAttemptsBlocked = entryAgg[0]?.fraud[0]?.count || 0;

    return res.json({
      ticketsSold,
      entriesScanned,
      fraudAttemptsBlocked,
      activeEvents,
      chainValid: chainSummary.chainValid,
      chain: chainSummary,
      dailyScans,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────────────────

async function listUsers(req, res, next) {
  try {
    const { q, role } = req.query;

    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const filter = {};

    // buildSearchRegex escapes the input, so `?q=[` returns an empty
    // result set instead of a 500.
    const searchRegex = buildSearchRegex(q);
    if (searchRegex) {
      filter.$or = [{ name: searchRegex }, { email: searchRegex }];
    }

    if (role) {
      const roleFilter = String(role);
      const validRoles = ["organizer", "buyer", "staff", "admin"];
      if (!validRoles.includes(roleFilter)) {
        throw new HttpError(
          400,
          `Invalid role filter. Allowed values: ${validRoles.join(", ")}`
        );
      }
      filter.role = roleFilter;
    }

    const [data, total] = await Promise.all([
      User.find(filter)
        .select("name email role tokenVersion createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.json({ data, page, limit, total });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// PUT /api/admin/users/:id
// ─────────────────────────────────────────────────────────

const ALLOWED_USER_UPDATE_FIELDS = ["name", "role"];

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const adminId = req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid user ID format");
    }

    // Guard 1: Cannot modify your own account
    if (String(id) === String(adminId)) {
      throw new HttpError(
        403,
        "Self-lockout protection: admins cannot modify their own account via this endpoint"
      );
    }

    const user = await User.findById(id);
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    // Pick only whitelisted fields
    const updates = {};
    for (const key of ALLOWED_USER_UPDATE_FIELDS) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "No valid fields provided for update");
    }

    // ── Guard 2: Cannot remove the last admin ──
    if (user.role === "admin" && updates.role && updates.role !== "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        throw new HttpError(
          403,
          "Cannot demote the last remaining admin — the platform would be unmanageable"
        );
      }
    }

    const previousRole = user.role;

    Object.assign(user, updates);

    if (updates.role !== undefined && updates.role !== previousRole) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }

    await user.save({ validateModifiedOnly: true });

    return res.json({ user });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/admin/events
// ─────────────────────────────────────────────────────────
//
// Platform-wide event listing.  The organizer-facing endpoint hides
// cancelled events and can only see the caller's own; an admin needs the
// full picture, including cancelled and soft-deleted events.

async function listAdminEvents(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const filter = {};

    if (req.query.cancelled !== undefined) {
      const value = String(req.query.cancelled).toLowerCase();
      if (value === "true" || value === "false") {
        filter.cancelled = value === "true";
      }
    }

    const searchRegex = buildSearchRegex(req.query.q);
    if (searchRegex) {
      filter.$or = [{ title: searchRegex }, { venue: searchRegex }];
    }

    const [data, total] = await Promise.all([
      Event.find(filter)
        .populate("organizerId", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Event.countDocuments(filter),
    ]);

    return res.json({ data, page, limit, total });
  } catch (err) {
    next(err);
  }
}

async function listEntryLogs(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const filter = {};

    if (req.query.result) {
      const result = String(req.query.result);
      const validResults = ["valid", "invalid", "already_used"];
      if (!validResults.includes(result)) {
        throw new HttpError(
          400,
          `Invalid result filter. Allowed values: ${validResults.join(", ")}`
        );
      }
      filter.scanResult = result;
    }

    if (req.query.eventId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.eventId)) {
        throw new HttpError(400, "Invalid event ID format");
      }
      filter.eventId = req.query.eventId;
    }

    const [data, total] = await Promise.all([
      EntryLog.find(filter)
        .populate("scannedBy", "name email role")
        .populate("eventId", "title")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EntryLog.countDocuments(filter),
    ]);

    return res.json({ data, page, limit, total });
  } catch (err) {
    next(err);
  }
}

async function adminDeleteEvent(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid event ID format");
    }

    const event = await Event.findById(id);
    if (!event) {
      throw new HttpError(404, "Event not found");
    }

    const ticketCount = await Ticket.countDocuments({ eventId: event._id });

    if (ticketCount > 0) {
      event.cancelled = true;
      await event.save();
      return res.json({
        message:
          "Event cancelled by admin (soft-deleted to preserve ticket chain integrity)",
        event,
      });
    }

    await Event.findByIdAndDelete(event._id);
    return res.json({ message: "Event deleted by admin" });
  } catch (err) {
    next(err);
  }
}


async function simulateTamper(req, res, next) {
  try {

    //prod guard (cannot start prod without the flag to flase)

    if (!env.demoEndpointsEnabled) {
      throw new HttpError(
        403,
        "simulate-tamper is DISABLED. It exists only for demo/development and " +
          "requires ENABLE_DEMO_ENDPOINTS=true in a development environment."
      );
    }

    const { ticketId, newSeatNumber } = req.body;

    if (!ticketId) {
      throw new HttpError(400, "ticketId is required");
    }
    if (newSeatNumber === undefined) {
      throw new HttpError(400, "newSeatNumber is required");
    }

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      throw new HttpError(400, "Invalid ticket ID format");
    }

    const result = await Ticket.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { $set: { seatNumber: newSeatNumber } }
    );

    if (result.matchedCount === 0) {
      throw new HttpError(404, "Ticket not found");
    }

    clearChainSummaryCache();

    return res.json({
      message: `TAMPERED: seatNumber changed to "${newSeatNumber}" WITHOUT recomputing hash. Chain is now broken at this ticket.`,
      ticketId,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getChain,
  getStats,
  listUsers,
  updateUser,
  listAdminEvents,
  listEntryLogs,
  adminDeleteEvent,
  simulateTamper,
  clearChainSummaryCache,
};
