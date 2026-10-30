/**
 * tests/admin.test.js — the administrative surface.
 *
 * Covers the access control (only admins, no self-modification, no
 * demoting the last admin), the chain/summary reporting, the user
 * administration (including token invalidation on a role change) and the
 * demo-only tamper endpoint.
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const {
  app,
  request,
  createUser,
  loginUser,
  registerUser,
  createEvent,
  insertTicket,
} = require("./helpers/fixtures");
const EntryLog = require("../models/EntryLog");
const User = require("../models/User");
const { updateUser } = require("../controllers/admin.controller");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Creates an admin account and returns it with a live token. */
async function createAdmin(email = "admin@example.com") {
  const user = await createUser({
    name: "Admin User",
    email,
    password: "password123",
    role: "admin",
  });
  const token = await loginUser(email, "password123");
  return { user, token };
}

/** A minimal Express response double for direct controller calls. */
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

// -----------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

describe("admin access control", () => {
  test("a non-admin is refused every admin route", async () => {
    const buyer = await registerUser({ role: "buyer" });

    const routes = [
      ["get", "/api/admin/chain"],
      ["get", "/api/admin/stats"],
      ["get", "/api/admin/users"],
      ["get", "/api/admin/events"],
      ["get", "/api/admin/entry-logs"],
      ["post", "/api/admin/simulate-tamper"],
    ];

    for (const [method, url] of routes) {
      const response = await request(app)
        [method](url)
        .set("Authorization", `Bearer ${buyer.token}`)
        .send({});

      expect(response.status).toBe(403);
    }
  });

  test("an anonymous caller is refused", async () => {
    const response = await request(app).get("/api/admin/chain");
    expect(response.status).toBe(401);
  });

  test("an organiser is refused", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(403);
  });
});

// -----------------------------------------------------------------------------
// Chain and stats
// ---------------------------------------------------------------------------

describe("GET /api/admin/chain", () => {
  test("reports a valid chain", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .get("/api/admin/chain")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.chainValid).toBe(true);
    expect(response.body.summary.totalLinks).toBe(1);
    expect(response.body.total).toBe(1);
    expect(response.body.page).toBe(1);
    expect(response.body.data[0].check.isBroken).toBe(false);
  });

  test("is paginated", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token, {
      seatMap: ["A1", "A2", "A3"],
      capacity: 3,
    });

    for (const seat of ["A1", "A2", "A3"]) {
      await insertTicket({
        eventId: event._id,
        buyerId: buyer.user._id,
        seatNumber: seat,
      });
    }

    const response = await request(app)
      .get("/api/admin/chain?page=2&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(1);
    expect(response.body.page).toBe(2);
    expect(response.body.limit).toBe(2);
    // The summary always describes the WHOLE chain, not the page.
    expect(response.body.summary.totalLinks).toBe(3);
    expect(response.body.summary.chainValid).toBe(true);
  });

  test("a negative page is a 400, not a 500", async () => {
    const { token } = await createAdmin();

    const response = await request(app)
      .get("/api/admin/chain?page=-1")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});

describe("GET /api/admin/stats", () => {
  test("reports platform statistics", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    await EntryLog.create({
      ticketId: null,
      eventId: event._id,
      scannedBy: (await createUser({ role: "staff" }))._id,
      scanResult: "invalid",
      scannedHash: "c".repeat(64),
      timestamp: new Date(),
    });

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.ticketsSold).toBe(1);
    expect(response.body.activeEvents).toBe(1);
    expect(response.body.entriesScanned).toBe(1);
    expect(response.body.fraudAttemptsBlocked).toBe(1);
    expect(response.body.chainValid).toBe(true);
    expect(Array.isArray(response.body.dailyScans)).toBe(true);
  });

  test("a transferred ticket is not counted as sold", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const ticket = await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const { computeStatusHash } = require("../utils/hashChain");
    const now = new Date();
    await require("../models/Ticket").updateOne(
      { _id: ticket._id },
      {
        $set: {
          status: "transferred",
          seatActive: false,
          statusUpdatedAt: now,
          statusHash: computeStatusHash({
            currentHash: ticket.currentHash,
            status: "transferred",
            statusUpdatedAt: now,
          }),
        },
      }
    );

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(response.body.ticketsSold).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// User administration
// ---------------------------------------------------------------------------

describe("GET /api/admin/users", () => {
  test("returns a paginated list", async () => {
    const { token } = await createAdmin();
    await registerUser({ role: "buyer" });
    await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(20);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test("can be searched and filtered by role", async () => {
    const { token } = await createAdmin();
    await registerUser({ role: "buyer", email: "zara@example.com" });
    await registerUser({ role: "organizer", email: "oliver@example.com" });

    const search = await request(app)
      .get("/api/admin/users?q=zara")
      .set("Authorization", `Bearer ${token}`);
    expect(search.body.total).toBe(1);

    const byRole = await request(app)
      .get("/api/admin/users?role=organizer")
      .set("Authorization", `Bearer ${token}`);
    expect(byRole.body.total).toBe(1);
  });

  test("a malformed search term does not crash the request", async () => {
    const { token } = await createAdmin();

    const response = await request(app)
      .get("/api/admin/users?q=%5B")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  test("an unknown role filter is a 400", async () => {
    const { token } = await createAdmin();

    const response = await request(app)
      .get("/api/admin/users?role=wizard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});

describe("PUT /api/admin/users/:id", () => {
  test("changes a role", async () => {
    const { token } = await createAdmin();
    const target = await registerUser({ role: "buyer" });

    const response = await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "staff" });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("staff");
  });

  test("a role change invalidates the target's existing token", async () => {
    const { token } = await createAdmin();
    const target = await registerUser({ role: "buyer" });

    // The token works before the change.
    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${target.token}`);
    expect(before.status).toBe(200);

    await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "staff" });

    // ...and is rejected afterwards, because tokenVersion was bumped.
    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${target.token}`);
    expect(after.status).toBe(401);
    expect(after.body.error).toContain("no longer valid");
  });

  test("a demoted admin loses admin access immediately", async () => {
    const { token } = await createAdmin();
    const target = await createAdmin("second@example.com");

    const before = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${target.token}`);
    expect(before.status).toBe(200);

    await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "buyer" });

    const after = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${target.token}`);
    expect(after.status).toBe(401);
  });

  test("an admin cannot modify their own account", async () => {
    const { user, token } = await createAdmin();

    const response = await request(app)
      .put(`/api/admin/users/${user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "buyer" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Self-lockout");
  });

  test("the last remaining admin cannot be demoted", async () => {
    // The self-modification guard already blocks an admin from demoting
    // themselves, so this guard is exercised directly against the
    // controller with a caller that is a *different* id.
    const onlyAdmin = await createUser({
      role: "admin",
      email: "only@example.com",
    });

    const res = mockRes();
    let captured = null;

    await updateUser(
      {
        params: { id: String(onlyAdmin._id) },
        user: { userId: "000000000000000000000000", role: "admin" },
        body: { role: "buyer" },
      },
      res,
      (err) => {
        captured = err;
      }
    );

    expect(captured).toBeTruthy();
    expect(captured.status).toBe(403);
    expect(captured.message).toContain("last remaining admin");
  });

  test("an unknown user is a 404", async () => {
    const { token } = await createAdmin();

    const response = await request(app)
      .put("/api/admin/users/000000000000000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "staff" });

    expect(response.status).toBe(404);
  });

  test("an invalid id is a 400", async () => {
    const { token } = await createAdmin();

    const response = await request(app)
      .put("/api/admin/users/not-an-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "staff" });

    expect(response.status).toBe(400);
  });

  test("an unknown role is rejected", async () => {
    const { token } = await createAdmin();
    const target = await registerUser({ role: "buyer" });

    const response = await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "wizard" });

    expect(response.status).toBe(400);
  });

  test("an empty update is a 400", async () => {
    const { token } = await createAdmin();
    const target = await registerUser({ role: "buyer" });

    const response = await request(app)
      .put(`/api/admin/users/${target.user._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});

// -----------------------------------------------------------------------------
// Demo endpoint
// ---------------------------------------------------------------------------

describe("POST /api/admin/simulate-tamper", () => {
  test("breaks the chain on purpose", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const ticket = await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .post("/api/admin/simulate-tamper")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: ticket._id, newSeatNumber: "HACKED" });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("TAMPERED");

    // The chain now reports the tampering.
    const chain = await request(app)
      .get("/api/admin/chain")
      .set("Authorization", `Bearer ${token}`);

    expect(chain.body.summary.chainValid).toBe(false);
    expect(chain.body.summary.firstBrokenSeq).toBe(1);

    const stats = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(stats.body.chainValid).toBe(false);
  });

  test("validates its input", async () => {
    const { token } = await createAdmin();

    const missing = await request(app)
      .post("/api/admin/simulate-tamper")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(missing.status).toBe(400);

    const badId = await request(app)
      .post("/api/admin/simulate-tamper")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: "nope", newSeatNumber: "X" });
    expect(badId.status).toBe(400);

    const unknown = await request(app)
      .post("/api/admin/simulate-tamper")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ticketId: "000000000000000000000000",
        newSeatNumber: "X",
      });
    expect(unknown.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

describe("GET /api/admin/events", () => {
  test("includes cancelled events", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });

    const kept = await createEvent(organizer.token, { title: "Kept" });
    const cancelled = await createEvent(organizer.token, { title: "Cancelled" });

    await insertTicket({
      eventId: cancelled._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });
    await request(app)
      .delete(`/api/events/${cancelled._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    const response = await request(app)
      .get("/api/admin/events")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);

    const titles = response.body.data.map((e) => e.title).sort();
    expect(titles).toEqual(["Cancelled", "Kept"]);

    const onlyActive = await request(app)
      .get("/api/admin/events?cancelled=false")
      .set("Authorization", `Bearer ${token}`);
    expect(onlyActive.body.total).toBe(1);
    expect(onlyActive.body.data[0].title).toBe("Kept");
  });
});

describe("GET /api/admin/entry-logs", () => {
  test("lists the door scans", async () => {
    const { token } = await createAdmin();
    const staff = await createUser({ role: "staff" });
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    await EntryLog.create({
      ticketId: null,
      eventId: event._id,
      scannedBy: staff._id,
      scanResult: "invalid",
      scannedHash: "d".repeat(64),
      timestamp: new Date(),
    });

    const response = await request(app)
      .get("/api/admin/entry-logs")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].scanResult).toBe("invalid");
    expect(response.body.data[0].scannedBy.name).toBeString();
  });

  test("can be filtered by result and event", async () => {
    const { token } = await createAdmin();
    const staff = await createUser({ role: "staff" });
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    await EntryLog.create({
      ticketId: null,
      eventId: event._id,
      scannedBy: staff._id,
      scanResult: "valid",
      scannedHash: "e".repeat(64),
      timestamp: new Date(),
    });

    const filtered = await request(app)
      .get(`/api/admin/entry-logs?result=valid&eventId=${event._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.body.total).toBe(1);

    const empty = await request(app)
      .get("/api/admin/entry-logs?result=already_used")
      .set("Authorization", `Bearer ${token}`);
    expect(empty.body.total).toBe(0);

    const badResult = await request(app)
      .get("/api/admin/entry-logs?result=maybe")
      .set("Authorization", `Bearer ${token}`);
    expect(badResult.status).toBe(400);

    const badEvent = await request(app)
      .get("/api/admin/entry-logs?eventId=nope")
      .set("Authorization", `Bearer ${token}`);
    expect(badEvent.status).toBe(400);
  });
});

describe("DELETE /api/admin/events/:id", () => {
  test("soft-deletes an event that has tickets", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .delete(`/api/admin/events/${event._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.event.cancelled).toBe(true);
  });

  test("removes an event without tickets", async () => {
    const { token } = await createAdmin();
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .delete(`/api/admin/events/${event._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("deleted");

    const remaining = await User.countDocuments({});
    expect(remaining).toBeGreaterThan(0);
  });
});
