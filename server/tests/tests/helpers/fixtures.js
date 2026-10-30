/**
 * tests/helpers/fixtures.js — small factory helpers for the test suite.
 */
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const Event = require("../../models/Event");
const { app } = require("../../index");

const BCRYPT_ROUNDS = 4; // fast enough for a test suite

/** Creates a user directly in the database and returns it. */
async function createUser({
  name = "Test User",
  email = `user-${Math.random().toString(36).slice(2)}@example.com`,
  password = "password123",
  role = "buyer",
} = {}) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return User.create({ name, email, passwordHash, role });
}

/** Registers a user through the API and returns `{ token, user, body }`. */
async function registerUser(overrides = {}) {
  const payload = {
    name: "Test User",
    email: `api-${Math.random().toString(36).slice(2)}@example.com`,
    password: "password123",
    role: "buyer",
    ...overrides,
  };

  const response = await request(app).post("/api/auth/register").send(payload);

  return {
    body: response.body,
    token: response.body.token,
    user: response.body.user,
    password: payload.password,
    email: payload.email,
  };
}

/** Logs a user in through the API and returns the token. */
async function loginUser(email, password = "password123") {
  const response = await request(app).post("/api/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(
      `login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`
    );
  }
  return response.body.token;
}

/** Creates an event through the API (organizer token required). */
async function createEvent(token, overrides = {}) {
  const payload = {
    title: "Test Event",
    description: "An event created by the test suite",
    date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    venue: "Test Venue",
    seatMap: ["A1", "A2", "A3"],
    price: 25,
    capacity: 3,
    ...overrides,
  };

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send(payload);

  if (response.status !== 201) {
    throw new Error(
      `event creation failed: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return response.body.event;
}

/** Creates an event directly in the database (bypasses the API). */
async function insertEvent(organizerId, overrides = {}) {
  return Event.create({
    title: "Direct Event",
    description: "",
    date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    venue: "Test Venue",
    seatMap: ["A1", "A2", "A3"],
    price: 25,
    capacity: 3,
    organizerId,
    ...overrides,
  });
}

/** Issues a ticket through the production append path. */
async function insertTicket(ticketData) {
  const { appendTicket, withChainTransaction } = require("../../utils/hashChain");
  return withChainTransaction((session) =>
    appendTicket(
      {
        eventId: ticketData.eventId,
        buyerId: ticketData.buyerId,
        seatNumber: ticketData.seatNumber ?? null,
        status: "valid",
        issuedAt: new Date(),
        ...ticketData,
      },
      { session }
    )
  );
}

module.exports = {
  app,
  request,
  createUser,
  registerUser,
  loginUser,
  createEvent,
  insertEvent,
  insertTicket,
};
