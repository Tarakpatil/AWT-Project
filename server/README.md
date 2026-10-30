# Decentralized Event Ticketing Simulator — Server

A MERN-stack backend that gives a centralized server **blockchain-style tamper-evidence** by chaining tickets with SHA-256 hashes. Each ticket's hash is derived from its own immutable issuance facts plus the previous ticket's hash. Editing any past ticket breaks every link after it, and an admin dashboard walks the chain to show exactly where the break is.

> There is no real blockchain, no consensus, no gas — just the hash-chain integrity property inside MongoDB.

---

## Requirements

| Requirement | Why |
|---|---|
| [Bun](https://bun.sh/) v1.0+ | Runtime + test runner |
| **MongoDB as a replica set** | The hash chain, purchases and transfers use **MongoDB transactions**. A standalone `mongod` cannot run them. |

### The replica-set requirement (important)

The chain append, the ticket purchase and the ticket transfer all run inside a transaction so that a partial write can never leave a gap in the chain. MongoDB only supports multi-document transactions on a **replica set** (or a sharded cluster).

- **MongoDB Atlas** — always a replica set. Nothing to do.
- **Local MongoDB** — start it as a replica set:

  ```bash
  mongod --replSet rs0 --dbpath /path/to/data
  # then, once, in the mongo shell:
  rs.initiate()
  ```

The server probes for transaction support at boot and prints the result:

```
MongoDB connected: 127.0.0.1/ticketing
MongoDB transactions: available (replica set detected)
```

`GET /api/health` reports the same thing in its `transactions` field. If transactions are unavailable the server still starts (it falls back to an optimistic, compare-and-set chain append), but that fallback **cannot guarantee gap-freedom under concurrency** — use a replica set.

---

## Installation

```bash
cd server
bun install
cp .env.example .env
```

Then fill in `.env` (see below) and seed the database.

---

## Environment Variables

All configuration is read, validated and frozen exactly once in `config/env.js`. **The server refuses to boot** when a required value is missing, is a known placeholder, or is too weak:

```
[FATAL] Invalid environment configuration: JWT_SECRET is missing or is still the placeholder value.
        Generate a real one with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

        The server will not start with an insecure or incomplete configuration.
```

### Required

| Variable | Description | Example |
|---|---|---|
| `MONGO_URI` | MongoDB connection string. **Always include a database name** — a URI without a path segment silently uses the `test` database (the server warns when it detects this). | `mongodb+srv://user:pass@cluster.mongodb.net/ticketing` |
| `JWT_SECRET` | Secret used to sign JWTs. Minimum 32 characters. Placeholder values (`change_me_to_a_long_random_string`, `secret`, `fallback_dev_secret`, …) are rejected. | `openssl rand -hex 32` |

### Optional

| Variable | Default | Description |
|---|---|---|
| `JWT_EXPIRES_IN` | `7d` | JWT token lifetime. |
| `PORT` | `5000` | HTTP port. |
| `CLIENT_URL` | `http://localhost:5173` | Comma-separated list of allowed browser origins (CORS). |
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. Anything else is a boot failure. |
| `SIGN_QR` | `true` | Sign QR payloads with an HMAC so a photographed ticket cannot be copied into a forged QR code. |
| `QR_SIGNING_SECRET` | *falls back to `JWT_SECRET`* | Separate secret for QR signatures, so rotating the JWT secret does not invalidate every already-printed QR code. Must be ≥ 32 characters if set. |
| `ENABLE_DEMO_ENDPOINTS` | `false` | Enables the demo-only endpoints (currently `POST /api/admin/simulate-tamper`). **Refused in production** — that is a boot failure, not a runtime 403. |
| `DOOR_WINDOW_MINUTES_BEFORE` | `240` | How many minutes *before* the event date a ticket may be scanned in. |
| `DOOR_WINDOW_MINUTES_AFTER` | `360` | How many minutes *after* the event date a ticket may be scanned in. |

---

## Running

```bash
# Development (auto-reload)
bun run dev

# Production
bun run start

# Seed the database
bun run seed

# Run the test suite
bun run test
bun run test:watch
```

### Seeding

`bun run seed` drops the application collections (never anything else) and recreates:

- **5 users**: organizer, 2 buyers, staff, admin (all with password `password123`)
- **2 events** with realistic seat maps
- **8 tickets** issued through the real hash chain
- **1 simulated transfer** (seat A1: Bob → Carol)
- **4 entry logs** (valid, already_used, 2× invalid) so the admin dashboard isn't empty

The seed **asserts that the resulting chain verifies** and prints the result. If the chain does not verify, the seed fails loudly rather than leaving a broken chain behind.

---

## API Response Contract

Every endpoint follows one of these shapes.

### Lists

```json
{ "data": [ … ], "page": 1, "limit": 20, "total": 137 }
```

`page` is 1-based. `limit` is the effective page size. `total` is the number of matching records, **not** the number returned on this page. `GET /api/admin/chain` is a list too, and additionally carries a `summary` object describing the *whole* chain regardless of the page.

### Single resources

```json
{ "user": { … } }        // GET  /api/auth/me
{ "event": { … } }       // GET  /api/events/:id
{ "ticket": { … } }      // POST /api/tickets/purchase, POST /api/tickets/transfer
```

`POST /api/auth/register` and `POST /api/auth/login` return `{ "token": "…", "user": { … } }`.

### Verification

`POST /api/tickets/verify` always answers **HTTP 200** with a result field — a refused scan is a successful scan of a bad ticket, not an HTTP error.

```json
{ "result": "valid" }
{ "result": "valid", "ticketId": "…", "eventId": "…", "seatNumber": "A1" }
{ "result": "invalid", "reason": "Event was cancelled" }
{ "result": "already_used", "reason": "Ticket has already been used",
  "scannedAt": "2026-10-21T18:02:11.000Z", "scannedBy": "Dave Staff" }
```

`result` is one of `"valid"`, `"invalid"`, `"already_used"`.

### Errors

```json
{ "error": "Seat is already taken", "code": "SEAT_TAKEN" }
{ "error": "Validation failed", "fields": { "price": "Price is required" } }
{ "error": "Too many requests, please try again later" }
```

- `error` — human-readable, safe to show to a user.
- `code` — short machine-readable identifier, present when the failure is a known, branchable condition. Common values: `SEAT_TAKEN`, `CHAIN_CONFLICT`.
- `fields` — per-field validation errors, when the failure was a schema validation error.
- `details` — optional structured detail (context, nested error information).

---

## How the Hash Chain Works

Every ticket issued on the platform is appended to a single, global hash chain — similar to how blocks are chained in a blockchain, but without decentralization or consensus.

### 1. The canonical payload

The payload contains only **immutable issuance facts**, serialised as a pipe-delimited string:

```
eventId | buyerId | seatNumber | seq | previousHash | issuedAt | transferredFrom | originTicketId
```

`currentHash = SHA-256(payload)`

**`status` is deliberately NOT part of the payload.** A ticket's status legitimately changes during its life — it is scanned in at the door, or it is transferred to a new owner. Hashing the status would mean re-hashing the tail of the chain on every change, which destroys the append-only property the chain exists to provide.

### 2. Status has its own hash

Status stays tamper-evident through a second, separate hash:

```
statusHash = SHA-256(currentHash | status | statusUpdatedAt)
```

`statusHash` is recomputed on every legitimate status change. If somebody edits `status` directly in the database without recomputing `statusHash`, the chain verifier detects the mismatch. The chain keeps its append-only linkage *and* status remains protected.

### 3. Chaining

`previousHash` always points to the `currentHash` of the ticket issued immediately before it — globally, across all events. The first ticket's `previousHash` is the well-known genesis hash `SHA-256("GENESIS")`.

The chain tip (`ChainState`) and the ticket insert happen inside a **single MongoDB transaction**, so they either both happen or neither does. There is no window in which the tip has advanced but the ticket was not inserted.

### 4. Tamper detection

If anyone modifies any field of any past ticket directly in the database, the recomputed hash no longer matches the stored `currentHash`. The *next* ticket's `previousHash` no longer matches either, breaking the chain at that point and at every point after it.

### 5. Verification

The admin dashboard walks the entire chain from seq 1 to N, checking five invariants at every link:

- **Contiguity** — seq numbers are exactly 1, 2, 3… with no gaps
- **Anchoring** — the first ticket's `previousHash` equals the genesis hash
- **Linkage** — each ticket's `previousHash` matches the prior ticket's `currentHash`
- **Field integrity** — the recomputed hash from the stored fields matches `currentHash`
- **Status integrity** — the recomputed `statusHash` matches the stored `statusHash`

This gives the system a strong **tamper-evidence** property: you can prove that no ticket has been altered since issuance, and you can pinpoint the exact location of any tampering.

---

## Route Table

### Auth (`/api/auth`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/auth/register` | — | — | Register a new user (rate limited) |
| POST | `/api/auth/login` | — | — | Login, returns `{token, user}` (rate limited) |
| GET | `/api/auth/me` | ✓ | any | Current user profile → `{user}` |

`admin` cannot be self-assigned at registration. Admin accounts are created by the seed.

### Events (`/api/events`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/events` | ✓ | organizer | Create event |
| GET | `/api/events` | ✓ | any | List/search events → `{data,page,limit,total}` |
| GET | `/api/events/:id` | ✓ | any | Event detail + seat availability → `{event, takenSeats, ticketsSold, remainingCapacity}` |
| GET | `/api/events/:id/tickets` | ✓ | organizer (owner) / staff / admin | Tickets issued for the event → `{data,page,limit,total}` |
| GET | `/api/events/:id/analytics` | ✓ | organizer (owner) | Sales stats → `{eventId, title, ticketsSold, revenue, remainingCapacity, statusBreakdown}` |
| PUT | `/api/events/:id` | ✓ | organizer (owner) | Update event (seat map & capacity freeze once a ticket is sold) |
| DELETE | `/api/events/:id` | ✓ | organizer (owner) | Cancel / delete event |

Query parameters for `GET /api/events`: `page`, `limit`, `q` (case-insensitive search on title or venue), `from` / `to` (ISO date range), `organizer=me` (your own events, including cancelled ones).

### Tickets (`/api/tickets`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/tickets/purchase` | ✓ | buyer | Purchase a ticket → `{ticket, qrDataUrl}` |
| GET | `/api/tickets/mine` | ✓ | buyer | My tickets (paginated) → `{data,page,limit,total}` |
| GET | `/api/tickets/:id/qr` | ✓ | owner / staff / admin | QR image + payload → `{qrDataUrl, qrPayload}` |
| POST | `/api/tickets/verify` | ✓ | staff / admin | Door scanner verification → `{result, …}` |
| POST | `/api/tickets/transfer` | ✓ | buyer | Transfer a ticket to another buyer → `{ticket, qrDataUrl}` |
| GET | `/api/tickets/:id/provenance` | ✓ | owner / organizer / admin | Ownership history → `{history, truncated}` |

`POST /api/tickets/verify` **requires `eventId`** in the body, alongside `hash` (and `sig` / `ticketId` when QR signing is on). A scanner works at one event's door: without `eventId` a ticket for a cancelled event — or for an event eleven months away — would scan as "Valid".

#### Request bodies

```jsonc
// POST /api/tickets/purchase
{ "eventId": "<id>", "seatNumber": "A1" }   // seatNumber required only for seated events

// POST /api/tickets/verify
{ "hash": "<64 hex chars>", "eventId": "<id>", "sig": "<hmac>", "ticketId": "<id>" }
// sig and ticketId are required when SIGN_QR is on (the default)

// POST /api/tickets/transfer
{ "ticketId": "<id>", "recipientEmail": "buyer@example.com" }
```

A scan is only accepted inside the event's **door window** (`DOOR_WINDOW_MINUTES_BEFORE` / `_AFTER` around the event date). Outside it the scan is `invalid`, with the reason stating whether the door has not opened yet or has already closed.

### Admin (`/api/admin`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/api/admin/chain` | ✓ | admin | Chain with per-link validity → `{summary, data, page, limit, total}` |
| GET | `/api/admin/stats` | ✓ | admin | Platform statistics |
| GET | `/api/admin/users` | ✓ | admin | List/search users → `{data,page,limit,total}` |
| PUT | `/api/admin/users/:id` | ✓ | admin | Update a user's role → `{user}` |
| GET | `/api/admin/events` | ✓ | admin | Every event, including cancelled → `{data,page,limit,total}` |
| GET | `/api/admin/entry-logs` | ✓ | admin | Door-scan log → `{data,page,limit,total}` |
| DELETE | `/api/admin/events/:id` | ✓ | admin | Admin-level event removal |
| POST | `/api/admin/simulate-tamper` | ✓ | admin | **Demo only** — break the chain on purpose |

`simulate-tamper` writes to the database without recomputing hashes. It is only reachable when `ENABLE_DEMO_ENDPOINTS=true` **and** `NODE_ENV` is not `production`; enabling it in production is a boot failure.

### Other

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | — | Health check → `{status, environment, transactions, uptime}` |

---

## Breaking Changes (client work not yet done)

The backend was hardened and its response contract made explicit. **The React client in `client/` has not been updated yet** and must be adapted before the two work together. The changes are:

| Change | Before | After |
|---|---|---|
| `GET /api/auth/me` | returned the user object directly | returns `{user}` |
| List endpoints (`/api/events`, `/api/tickets/mine`, `/api/admin/*`) | returned a bare array | return `{data, page, limit, total}` |
| `POST /api/tickets/verify` | body `{hash}` | body `{hash, eventId, sig?, ticketId?}` — `eventId` is **required** |
| `POST /api/tickets/verify` response | `{status: "valid" \| "invalid" \| "used"}` | `{result: "valid" \| "invalid" \| "already_used", reason?, scannedAt?, scannedBy?}` |
| `POST /api/admin/simulate-tamper` | always reachable | requires `ENABLE_DEMO_ENDPOINTS=true` |
| Error bodies | inconsistent shapes | `{error, code?, details?, fields?}` |

`client/src/pages/staff/ScanTicket.jsx` is the one file that actually calls the API today; it still posts `{hash}` and reads `data.status`, so it will need the `eventId` field and the `result` field.

---

## Security Notes

### Rotating the JWT secret

1. Generate a new secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
2. Put it in `JWT_SECRET` in `.env` and restart the server.
3. Every existing token becomes invalid. Users must log in again.

If you want QR codes that were already printed to keep working, set `QR_SIGNING_SECRET` to its own long-lived value **before** rotating `JWT_SECRET` — otherwise the QR secret follows the JWT secret and every printed ticket stops scanning.

### Other properties

- **Passwords** are hashed with bcrypt (10 rounds) and never returned by any endpoint.
- **Roles are re-read from the database on every request.** The role in a JWT is not trusted: an admin demoted in the database loses admin access immediately, not when their token expires. A role change also bumps the user's `tokenVersion`, which invalidates that user's existing tokens.
- **An admin cannot modify their own account**, and the last remaining admin cannot be demoted.
- **Rate limits** are applied to login, registration, purchase, verify and transfer. The counters live in this process's memory, so a multi-instance deployment gives each instance its own budget.
- **Helmet** sets the usual security headers, and **CORS** is restricted to the origins in `CLIENT_URL`.
- The server refuses to boot with a placeholder or too-short `JWT_SECRET`.

---

## Project Structure

```
server/
├── index.js                          Entry point, middleware, routes, graceful shutdown
├── seed.js                           Database seeder (verifies the chain it creates)
├── config/
│   ├── env.js                        Validated environment configuration (boot gate)
│   └── db.js                         MongoDB connection, transaction probe
├── models/
│   ├── User.js                       User schema (roles, bcrypt, tokenVersion)
│   ├── Event.js                      Event schema (seat maps, capacity cross-check)
│   ├── Ticket.js                     Ticket schema (chain fields, seat uniqueness)
│   ├── EntryLog.js                   Door scan audit log
│   ├── Payment.js                    Payment record
│   └── ChainState.js                 Hash chain tip (atomic counter)
├── controllers/
│   ├── auth.controller.js            Register, login, me
│   ├── event.controller.js           CRUD, analytics, listings
│   ├── ticket.controller.js          Purchase, verify, transfer, provenance
│   └── admin.controller.js           Chain, stats, users, listings, tamper
├── middleware/
│   ├── auth.middleware.js            JWT verification + database role re-read
│   ├── role.middleware.js            Role-based access control
│   ├── rateLimit.middleware.js       Rate-limit factory (self-cleaning)
│   ├── limiters.js                   The shared limiters (resettable in tests)
│   └── error.middleware.js           Central error handler (error contract)
├── routes/
│   ├── auth.routes.js
│   ├── event.routes.js
│   ├── ticket.routes.js
│   └── admin.routes.js
├── utils/
│   ├── hashChain.js                  Canonical payload, chain append, verification
│   ├── qr.js                         QR generation + HMAC signing/verification
│   ├── httpError.js                  Error type with a machine-readable code
│   ├── pagination.js                 Page/limit parsing and clamping
│   └── regex.js                      Safe search-term → RegExp
├── services/
│   └── payment.service.js            Mock payment gateway seam (charge + refund)
├── tests/
│   ├── setup.js                      Test bootstrap (in-memory replica set)
│   ├── helpers/                      db.js, fixtures.js
│   ├── auth.test.js                  13 tests
│   ├── events.test.js                26 tests
│   ├── tickets.test.js               33 tests
│   ├── admin.test.js                 28 tests
│   └── chain.test.js                 22 tests
├── .env.example
├── bunfig.toml
└── package.json
```

---

## Tests

```bash
bun run test
```

The complete catalogue — every one of the 122 test cases, what it proves, the defect it guards against, and the coverage boundaries — is in **[`docs/TESTING.md`](../docs/TESTING.md)**.

The suite runs against an **in-memory MongoDB replica set** (`mongodb-memory-server`), so it needs no external database and no network. It covers the regression cases that motivated the hardening:

- the same seat cannot be bought twice (`SEAT_TAKEN`)
- a demoted admin loses access immediately
- a cancelled or not-yet-open event's ticket is refused at the door
- the chain detects a field edited behind the application's back, a status edited without recomputing `statusHash`, a broken link and a sequence gap
- a legitimate status change keeps the chain valid
- pagination and search parameters cannot crash a request
- `simulate-tamper` is refused unless demo endpoints are explicitly enabled
