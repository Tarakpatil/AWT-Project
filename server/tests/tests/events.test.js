/**
 * tests/events.test.js — event creation, listing, updating and deletion.
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const {
  app,
  request,
  createUser,
  registerUser,
  createEvent,
  insertTicket,
} = require("./helpers/fixtures");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

const future = (days = 7) => new Date(Date.now() + days * 24 * 3600 * 1000);

describe("POST /api/events", () => {
  test("an organizer can create an event", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        title: "Launch Party",
        description: "A party",
        date: future().toISOString(),
        venue: "The Hall",
        seatMap: ["A1", "A2"],
        price: 10,
        capacity: 2,
      });

    expect(response.status).toBe(201);
    expect(response.body.event.title).toBe("Launch Party");
    expect(response.body.event.organizerId).toBeString();
    expect(response.body.event.ticketsSold).toBe(0);
  });

  test("a buyer cannot create an event", async () => {
    const buyer = await registerUser({ role: "buyer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({
        title: "Nope",
        date: future().toISOString(),
        venue: "The Hall",
        price: 10,
        capacity: 2,
      });

    expect(response.status).toBe(403);
  });

  test("the organizer is taken from the token, not from the body", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const other = await createUser({ role: "organizer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        title: "Not Yours",
        date: future().toISOString(),
        venue: "The Hall",
        price: 10,
        capacity: 2,
        organizerId: String(other._id),
      });

    expect(response.status).toBe(201);
    expect(response.body.event.organizerId).toBe(organizer.user._id);
  });

  test("rejects an event in the past", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        title: "Yesterday",
        date: new Date(Date.now() - 3600 * 1000).toISOString(),
        venue: "The Hall",
        price: 10,
        capacity: 2,
      });

    expect(response.status).toBe(400);
  });

  test("rejects a capacity that does not match the seat map", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        title: "Mismatch",
        date: future().toISOString(),
        venue: "The Hall",
        seatMap: ["A1", "A2", "A3"],
        price: 10,
        capacity: 2,
      });

    expect(response.status).toBe(400);
  });

  test("rejects a seat map with duplicate labels", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        title: "Dupe Seats",
        date: future().toISOString(),
        venue: "The Hall",
        seatMap: ["A1", "A1"],
        price: 10,
        capacity: 2,
      });

    expect(response.status).toBe(400);
  });
});

describe("GET /api/events", () => {
  test("returns the paginated envelope", async () => {
    const organizer = await registerUser({ role: "organizer" });
    await createEvent(organizer.token, { title: "One" });
    await createEvent(organizer.token, { title: "Two" });

    const response = await request(app)
      .get("/api/events")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(20);
    expect(response.body.total).toBe(2);
  });

  test("a negative page is a 400, not a 500", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/events?page=-1")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("page");
  });

  test("a non-numeric page is a 400, not a 500", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/events?page=abc")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(400);
  });

  test("a malformed search term does not crash the request", async () => {
    const organizer = await registerUser({ role: "organizer" });
    await createEvent(organizer.token, { title: "Regex Event" });

    const response = await request(app)
      .get("/api/events?q=%5B")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
  });

  test("a regex metacharacter search is treated literally", async () => {
    const organizer = await registerUser({ role: "organizer" });
    await createEvent(organizer.token, { title: "C++ Conference" });

    const response = await request(app)
      .get("/api/events?q=C%2B%2B")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
  });

  test("an over-long search term is a 400", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get(`/api/events?q=${"x".repeat(200)}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(400);
  });

  test("?organizer=me returns only the caller's events", async () => {
    const mine = await registerUser({ role: "organizer" });
    const theirs = await registerUser({ role: "organizer" });

    await createEvent(mine.token, { title: "Mine" });
    await createEvent(theirs.token, { title: "Theirs" });

    const response = await request(app)
      .get("/api/events?organizer=me")
      .set("Authorization", `Bearer ${mine.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].title).toBe("Mine");
  });
});

describe("GET /api/events/:id", () => {
  test("returns the event with its availability", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .get(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.event._id).toBe(event._id);
    expect(response.body.takenSeats).toEqual([]);
    expect(response.body.ticketsSold).toBe(0);
    expect(response.body.remainingCapacity).toBe(3);
  });

  test("an invalid id is a 400", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/events/not-an-id")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(400);
  });

  test("a missing event is a 404", async () => {
    const organizer = await registerUser({ role: "organizer" });

    const response = await request(app)
      .get("/api/events/000000000000000000000000")
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/events/:id", () => {
  test("the organizer can update their own event", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .put(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({ title: "Renamed", price: 99 });

    expect(response.status).toBe(200);
    expect(response.body.event.title).toBe("Renamed");
    expect(response.body.event.price).toBe(99);
  });

  test("a different organizer cannot update it", async () => {
    const owner = await registerUser({ role: "organizer" });
    const stranger = await registerUser({ role: "organizer" });
    const event = await createEvent(owner.token);

    const response = await request(app)
      .put(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ title: "Hijacked" });

    expect(response.status).toBe(403);
  });

  test("the venue layout is frozen once a ticket has been sold", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .put(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({ capacity: 10, seatMap: ["A1", "A2", "A3", "A4"] });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("cannot be changed");
  });

  test("an event cannot be pushed into the past", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .put(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({ date: new Date(Date.now() - 3600 * 1000).toISOString() });

    expect(response.status).toBe(400);
  });

  test("an empty update is a 400", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .put(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/events/:id", () => {
  test("an event without tickets is removed outright", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .delete(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("deleted");
  });

  test("an event with tickets is soft-deleted so the chain survives", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .delete(`/api/events/${event._id}`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.event.cancelled).toBe(true);
  });
});

describe("GET /api/events/:id/analytics", () => {
  test("does not count a transferred ticket as sold", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token, { price: 50 });

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });
    const second = await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A2",
    });

    // Retire the second ticket the way a transfer does.
    const { computeStatusHash } = require("../utils/hashChain");
    const now = new Date();
    await require("../models/Ticket").updateOne(
      { _id: second._id },
      {
        $set: {
          status: "transferred",
          seatActive: false,
          statusUpdatedAt: now,
          statusHash: computeStatusHash({
            currentHash: second.currentHash,
            status: "transferred",
            statusUpdatedAt: now,
          }),
        },
      }
    );

    const response = await request(app)
      .get(`/api/events/${event._id}/analytics`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    // Only the one still-valid ticket counts.
    expect(response.body.ticketsSold).toBe(1);
    expect(response.body.revenue).toBe(50);
    expect(response.body.statusBreakdown.transferred).toBe(1);
  });
});

describe("GET /api/events/:id/tickets", () => {
  test("the organizer can list the event's tickets", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const buyer = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    await insertTicket({
      eventId: event._id,
      buyerId: buyer.user._id,
      seatNumber: "A1",
    });

    const response = await request(app)
      .get(`/api/events/${event._id}/tickets`)
      .set("Authorization", `Bearer ${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].buyerId.name).toBeString();
  });

  test("another buyer cannot list them", async () => {
    const organizer = await registerUser({ role: "organizer" });
    const stranger = await registerUser({ role: "buyer" });
    const event = await createEvent(organizer.token);

    const response = await request(app)
      .get(`/api/events/${event._id}/tickets`)
      .set("Authorization", `Bearer ${stranger.token}`);

    expect(response.status).toBe(403);
  });
});
