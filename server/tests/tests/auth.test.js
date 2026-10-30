/**
 * tests/auth.test.js — registration, login and session handling.
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const {
  app,
  request,
  createUser,
  registerUser,
} = require("./helpers/fixtures");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/auth/register", () => {
  test("creates an account and returns a token", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Alice",
        email: "alice@example.com",
        password: "password123",
        role: "buyer",
      });

    expect(response.status).toBe(201);
    expect(response.body.token).toBeString();
    expect(response.body.user.email).toBe("alice@example.com");
    expect(response.body.user.role).toBe("buyer");
    // The password hash must never leave the server.
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  test("refuses to let a caller self-assign the admin role", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Eve",
        email: "eve@example.com",
        password: "password123",
        role: "admin",
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("cannot be self-assigned");
  });

  test("rejects a short password", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob",
        email: "bob@example.com",
        password: "short",
        role: "buyer",
      });

    expect(response.status).toBe(400);
  });

  test("rejects a missing field", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ name: "Bob", email: "bob@example.com" });

    expect(response.status).toBe(400);
  });

  test("rejects a duplicate email with 409", async () => {
    await createUser({ email: "dupe@example.com" });

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bob",
        email: "dupe@example.com",
        password: "password123",
        role: "buyer",
      });

    expect(response.status).toBe(409);
  });

  test("ignores fields that are not on the whitelist", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Mallory",
        email: "mallory@example.com",
        password: "password123",
        role: "buyer",
        tokenVersion: 99,
        _id: "000000000000000000000000",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.tokenVersion).toBeUndefined();
  });
});

describe("POST /api/auth/login", () => {
  test("returns a token for valid credentials", async () => {
    await createUser({ email: "bob@example.com", password: "password123" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "bob@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeString();
    expect(response.body.user.email).toBe("bob@example.com");
  });

  test("gives the same answer for a wrong password and an unknown account", async () => {
    await createUser({ email: "bob@example.com", password: "password123" });

    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "bob@example.com", password: "nope" });

    const unknownUser = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "nope" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    // Identical messages — the endpoint must not reveal which accounts exist.
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });

  test("requires both fields", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "bob@example.com" });

    expect(response.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  test("returns the authenticated user", async () => {
    const { token, email } = await registerUser();

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
  });

  test("rejects a missing token", async () => {
    const response = await request(app).get("/api/auth/me");
    expect(response.status).toBe(401);
  });

  test("rejects a malformed token", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not-a-jwt");
    expect(response.status).toBe(401);
  });

  test("rejects a token signed with the wrong secret", async () => {
    const jwt = require("jsonwebtoken");
    const forged = jwt.sign(
      { userId: "000000000000000000000000", role: "admin", tokenVersion: 0 },
      "some-other-secret-that-is-long-enough-to-be-accepted"
    );

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });
});
