# Test Case Catalogue

Official reference for the backend test suite of the **Decentralized Event Ticketing Simulator**.

This document enumerates every automated test, explains what each one proves, and records the defect each test guards against. It is meant to be read alongside the source in `server/tests/`.

| | |
|---|---|
| **Suites** | 5 |
| **Test cases** | **122** |
| **Assertions** | 284 |
| **Runner** | [Bun](https://bun.sh/) test (`bun:test`) |
| **HTTP layer** | [supertest](https://github.com/ladjs/supertest) against the real Express app |
| **Database** | In-memory MongoDB **replica set** (`mongodb-memory-server`) |
| **External services** | None. No network access is required. |
| **Location** | `server/tests/` |

---

## Contents

1. [At a glance](#at-a-glance)
2. [How the harness works](#how-the-harness-works)
3. [Running the tests](#running-the-tests)
4. [How to read the catalogue](#how-to-read-the-catalogue)
5. [Authentication — AUTH](#authentication--auth)
6. [Events — EVT](#events--evt)
7. [Tickets — TKT](#tickets--tkt)
8. [Administration — ADM](#administration--adm)
9. [Hash-chain primitives — CHN](#hash-chain-primitives--chn)
10. [Traceability to the audit findings](#traceability-to-the-audit-findings)
11. [Coverage boundaries](#coverage-boundaries)
12. [Conventions for adding tests](#conventions-for-adding-tests)
13. [Fixture reference](#fixture-reference)

---

## At a glance

| Suite | File | Cases | Focus |
|---|---|---:|---|
| Authentication | `server/tests/auth.test.js` | 13 | Registration, login, session validation |
| Events | `server/tests/events.test.js` | 26 | Event CRUD, listing, capacity, analytics |
| Tickets | `server/tests/tickets.test.js` | 33 | Purchase, listing, QR, door scanning, transfer, provenance |
| Administration | `server/tests/admin.test.js` | 28 | Admin access control, chain reporting, user management, demo endpoint |
| Chain primitives | `server/tests/chain.test.js` | 22 | Canonical hashing, status hashing, link and chain verification |
| **Total** | | **122** | |

Each suite is independent: it connects once in `beforeAll`, then calls `resetDatabase()` in `beforeEach`, so tests never depend on execution order.

---

## How the harness works

Understanding the harness matters when interpreting a result, because the suite deliberately runs against the *real* application rather than mocks.

### 1. Preload (`server/bunfig.toml` → `server/tests/setup.js`)

Bun loads `tests/setup.js` once per test process, **before any test file**. It:

1. **Pins the environment** (`NODE_ENV=test`, a 32+ character `JWT_SECRET`, a separate `QR_SIGNING_SECRET`, `SIGN_QR=true`, `ENABLE_DEMO_ENDPOINTS=true`, the door window). `dotenv` does not override already-set variables, so the test values win over `server/.env` — a developer's live Atlas URI can never be touched by a test run.
2. **Starts an in-memory MongoDB replica set.** A replica set, not a standalone `mongod`, because the chain append, purchase and transfer paths use multi-document transactions. The replica set is created once and its readiness promise is stored on `globalThis.__TEST_DB_READY__`.
3. **Builds every model's indexes** via `Model.init()`. This is load-bearing: the "a seat can only be sold once" guarantee lives in a **unique partial index**. A suite that ran before the index existed would silently pass while the bug was still present.
4. Kills the `mongod` child process when the test process exits.

### 2. Per-test reset (`server/tests/helpers/db.js`)

`resetDatabase()`:

- empties every collection with `deleteMany({})` rather than `drop()` — **`drop()` would destroy the indexes**, including the unique seat index;
- recreates the chain tip as `{ _id: "main", seq: 0, lastHash: GENESIS_HASH }`;
- calls `resetAll()` on the rate limiters. The rate-limit counters are process-wide, so without this a suite trips its own limits and starts returning `429`.

### 3. Fixtures (`server/tests/helpers/fixtures.js`)

Two ways to create data:

- **Through the API** (`registerUser`, `createEvent`) — exercises validation, middleware and controllers.
- **Directly in the database** (`createUser`, `insertEvent`) — for cases where the API would refuse the setup (for example, creating an `admin`, which cannot be self-assigned).

`insertTicket()` always issues through the **production `appendTicket()` path inside a transaction**, so chain links created by a test are hash-valid by construction.

`bcrypt` uses 4 rounds in tests instead of 10. This is purely a speed decision: the hashing algorithm and the verification path are identical.

### What is real and what is mocked

| Real | Mocked / simulated |
|---|---|
| Express app, routes, middleware, controllers | Payment gateway (`services/payment.service.js` records a `Payment` document instead of charging a card) |
| Mongoose models, validators, indexes | Mongo server (in-memory, but a genuine `mongod` with real transactions and real unique indexes) |
| JWT signing and verification | Email delivery (not implemented) |
| bcrypt password hashing (reduced rounds) | |
| SHA-256 hash chain | |
| HMAC QR signing | |

---

## Running the tests

```bash
cd server

bun run test          # whole suite
bun run test:watch    # re-run on change

bun test tests/tickets.test.js                      # one suite
bun test tests/tickets.test.js --filter purchase    # one describe/test block
bun test --filter "SEAT_TAKEN"
```

A passing run ends with:

```
 122 pass
 0 fail
 284 expect() calls
Ran 122 tests across 5 files.
```

> **First run needs a MongoDB binary.** `mongodb-memory-server` downloads a `mongod` build on first use and caches it under `server/node_modules/.cache/mongodb-memory-server/`. Subsequent runs are offline.

---

## How to read the catalogue

Each case has a documentation ID (`AUTH-01`, `EVT-14`, …). The IDs exist **only in this document**; they are stable handles for bug reports, review comments and traceability tables. The test's own title in the source is the source of truth — it is reproduced verbatim so you can search for it.

The tables read as:

| Column | Meaning |
|---|---|
| **ID** | Documentation handle |
| **Test** | The exact `test("…")` title |
| **Proves** | The behaviour the assertions establish |
| **Expected** | The externally observable outcome (status code, body shape, resulting state) |

---

## Authentication — AUTH

**File:** `server/tests/auth.test.js` · **Cases:** 13

Covers public account creation, credential exchange and the validity of a presented session. The security-relevant assertions here are that a caller cannot escalate their own role, that login does not act as an account-existence oracle, and that the password hash never leaves the server.

### `POST /api/auth/register`

| ID | Test | Proves | Expected |
|---|---|---|---|
| AUTH-01 | creates an account and returns a token | A new account is created and immediately usable | `201`; `token` is a string; `user.email` matches; `user.role` is `buyer`; **`user.passwordHash` is `undefined`** |
| AUTH-02 | refuses to let a caller self-assign the admin role | Privilege escalation through registration is blocked | `403`; error mentions "cannot be self-assigned" |
| AUTH-03 | rejects a short password | Minimum password policy is enforced | `400` |
| AUTH-04 | rejects a missing field | Required-field validation is enforced | `400` |
| AUTH-05 | rejects a duplicate email with 409 | Email uniqueness is enforced with the right semantics | `409` |
| AUTH-06 | ignores fields that are not on the whitelist | Mass assignment cannot reach `tokenVersion`, `_id`, etc. | `201`; `user.tokenVersion` is `undefined` |

### `POST /api/auth/login`

| ID | Test | Proves | Expected |
|---|---|---|---|
| AUTH-07 | returns a token for valid credentials | Correct credentials yield a session | `200`; `token` is a string; `user.email` matches |
| AUTH-08 | gives the same answer for a wrong password and an unknown account | The endpoint is not an account-existence oracle | Both `401`; **the two `error` strings are identical** |
| AUTH-09 | requires both fields | A partial payload is rejected cleanly | `400` |

### `GET /api/auth/me`

| ID | Test | Proves | Expected |
|---|---|---|---|
| AUTH-10 | returns the authenticated user | A valid bearer token identifies the caller | `200`; `body.user.email` matches the registered address |
| AUTH-11 | rejects a missing token | Unauthenticated access is refused | `401` |
| AUTH-12 | rejects a malformed token | Non-JWT garbage is refused without a crash | `401` |
| AUTH-13 | rejects a token signed with the wrong secret | Forged tokens are refused by signature verification | `401` |

---

## Events — EVT

**File:** `server/tests/events.test.js` · **Cases:** 26

Covers the event lifecycle: creation rules, listing/pagination/search, the detail view with live availability, ownership-scoped mutation, cancellation semantics, analytics and the organiser's ticket listing.

### `POST /api/events`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-01 | an organizer can create an event | An organiser can publish an event | `201`; title echoed; `organizerId` present; `ticketsSold` is `0` |
| EVT-02 | a buyer cannot create an event | Role enforcement on creation | `403` |
| EVT-03 | the organizer is taken from the token, not from the body | Ownership cannot be spoofed by request body | `201`; `organizerId` equals the **caller's** id, not the body value |
| EVT-04 | rejects an event in the past | Events must be in the future | `400` |
| EVT-05 | rejects a capacity that does not match the seat map | The seat-map/capacity invariant holds | `400` |
| EVT-06 | rejects a seat map with duplicate labels | A venue cannot sell the same seat label twice | `400` |

### `GET /api/events`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-07 | returns the paginated envelope | The list contract is `{data,page,limit,total}` | `200`; `data` is an array; `page 1`; `limit 20`; `total 2` |
| EVT-08 | a negative page is a 400, not a 500 | Bad pagination is a client error, not a server crash | `400`; error mentions "page" |
| EVT-09 | a non-numeric page is a 400, not a 500 | Non-numeric pagination is rejected cleanly | `400` |
| EVT-10 | a malformed search term does not crash the request | A lone `[` cannot produce an invalid `RegExp` | `200`; `total 0` |
| EVT-11 | a regex metacharacter search is treated literally | Search input is escaped, not interpolated as a pattern | `200`; `q=C++` matches the `C++ Conference` event (`total 1`) |
| EVT-12 | an over-long search term is a 400 | Search input is bounded (anti-ReDoS / abuse) | `400` |
| EVT-13 | ?organizer=me returns only the caller's events | The organiser dashboard is scoped to its owner | `200`; `total 1`; the only row is "Mine" |

### `GET /api/events/:id`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-14 | returns the event with its availability | Detail includes computed availability, not just the document | `200`; `takenSeats []`; `ticketsSold 0`; `remainingCapacity 3` |
| EVT-15 | an invalid id is a 400 | Malformed ObjectIds are a client error | `400` |
| EVT-16 | a missing event is a 404 | Unknown-but-valid ids are a not-found | `404` |

### `PUT /api/events/:id`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-17 | the organizer can update their own event | The owner can edit mutable fields | `200`; title and price updated |
| EVT-18 | a different organizer cannot update it | Ownership is enforced on mutation | `403` |
| EVT-19 | the venue layout is frozen once a ticket has been sold | Changing `seatMap`/`capacity` cannot orphan sold tickets or desynchronise availability | `409`; error mentions "cannot be changed" |
| EVT-20 | an event cannot be pushed into the past | A future-valid event cannot be made invalid | `400` |
| EVT-21 | an empty update is a 400 | A no-op update is rejected rather than silently succeeding | `400` |

### `DELETE /api/events/:id`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-22 | an event without tickets is removed outright | Unsold events can be hard-deleted | `200`; message mentions "deleted" |
| EVT-23 | an event with tickets is soft-deleted so the chain survives | Deleting a sold event cannot destroy chain links | `200`; `event.cancelled` is `true` (the document survives) |

### `GET /api/events/:id/analytics`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-24 | does not count a transferred ticket as sold | A retired ticket must not inflate sales or revenue | `200`; `ticketsSold 1`; `revenue 50`; `statusBreakdown.transferred 1` |

### `GET /api/events/:id/tickets`

| ID | Test | Proves | Expected |
|---|---|---|---|
| EVT-25 | the organizer can list the event's tickets | The owner can audit who holds which seat | `200`; `total 1`; `data[0].buyerId.name` is populated |
| EVT-26 | another buyer cannot list them | Buyers cannot enumerate other people's tickets | `403` |

---

## Tickets — TKT

**File:** `server/tests/tickets.test.js` · **Cases:** 33

The largest suite. It covers the money-and-identity paths: issuing a ticket without double-selling or overselling, refunding a losing race, listing, QR access, the door scanner, transfer semantics and provenance, plus an end-to-end chain-integrity check.

### `POST /api/tickets/purchase`

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-01 | issues a ticket and returns it with a QR code | A purchase creates a valid ticket and a usable QR | `201`; seat `A1`; status `valid`; **`seq 1`**; `qrDataUrl` is a `data:image/png;base64,` URL; the persisted payload's `hash` equals `currentHash` and `sig` is present |
| TKT-02 | the same seat cannot be bought twice | The unique seat rule is enforced with a branchable error | First `201`; second `409` with `code: "SEAT_TAKEN"` |
| TKT-03 | two concurrent buyers cannot win the same seat | The guarantee survives a real race, not just sequential calls | Statuses sort to `[201, 409]`; the loser gets `SEAT_TAKEN`; **exactly one** ticket exists for the seat |
| TKT-04 | the event cannot be oversold | Capacity is an invariant, not a suggestion | Third purchase attempt is `400` |
| TKT-05 | a general-admission event refuses a seat | A seat cannot be requested where no seat map exists | `400`; error mentions "general admission" |
| TKT-06 | a seated event requires a seat | A seated event cannot be bought without a seat | `400`; error mentions "seatNumber" |
| TKT-07 | a seat that is not in the venue layout is rejected | Seats are validated against the event's own map | `400` |
| TKT-08 | a cancelled event cannot be bought | Cancellation stops new sales | `400`; error mentions "cancelled" |
| TKT-09 | a purchase that loses the race is refunded | The money path is transactionally correct under contention | Exactly `2` payments: `1` `captured`, `1` `refunded` |

### `GET /api/tickets/mine`

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-10 | returns the paginated envelope | The buyer list uses the shared list contract | `200`; `total 2`; `page 1`; `limit 20`; `data.length 2` |
| TKT-11 | a negative page is a 400, not a 500 | Pagination validation is shared, not endpoint-specific | `400` |
| TKT-12 | an unknown status filter is a 400 | Status filters are an enumerated set | `400` |
| TKT-13 | a buyer cannot list the tickets of somebody else | Tenant isolation on the buyer's own list | `200`; the other buyer's `total` is `0` |

### `GET /api/tickets/:id/qr`

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-14 | the owner can fetch the QR code | The holder can retrieve their own admission code | `200`; `qrDataUrl` is a PNG data URL |
| TKT-15 | a stranger cannot fetch the QR code | A ticket's QR is not public | `403` |

### `POST /api/tickets/verify`

The scanner is the security-critical read path: it decides who enters. Most cases assert a **`200` with a negative `result`**, because refusing a bad ticket is a successful scan, not an HTTP error.

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-16 | a valid ticket scans as valid | A correct, signed, in-window ticket is admitted | `200`; `result: "valid"`; `ticketId` echoed |
| TKT-17 | the ticket is marked used after a valid scan | A successful scan is recorded as consumption | `200`; stored `status` becomes `used` |
| TKT-18 | scanning the same ticket twice reports already_used | Re-entry is distinguishable from forgery, and includes who/when | First `valid`; second `already_used` with a `reason` |
| TKT-19 | eventId is required | A scanner must be pinned to an event | `400`; error mentions "eventId" |
| TKT-20 | a ticket for a different event is rejected | A ticket cannot be walked into another event's door | `200`; `result: "invalid"`; reason mentions "different event" |
| TKT-21 | a forged signature is rejected | The HMAC over `(hash, ticketId)` cannot be guessed | `200`; `result: "invalid"`; reason mentions "signature" |
| TKT-22 | a signature for a different ticket is rejected | A valid signature cannot be replayed against another ticket id | `200`; `result: "invalid"` |
| TKT-23 | an unknown hash is rejected | A correctly-signed hash that matches no ticket is refused | `200`; `result: "invalid"`; reason mentions "not found" |
| TKT-24 | a scan before the door opens is rejected | A ticket for an event a month away cannot be admitted today | `200`; `result: "invalid"`; reason mentions "not opened yet" |
| TKT-25 | a cancelled event rejects the scan | Cancellation is enforced at the door, not just at purchase | `200`; `result: "invalid"`; reason mentions "cancelled" |
| TKT-26 | a buyer cannot use the scanner | Scanner endpoints are role-restricted | `403` |

### `POST /api/tickets/transfer`

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-27 | moves the ticket and releases the seat | Transfer is atomic: ownership moves, the old ticket retires, the seat does **not** go back on sale | `201`; new `buyerId`; `seatNumber` preserved; `transferredFrom` set; original is `transferred` with `seatActive false`; a third buyer gets `409 SEAT_TAKEN`; exactly **one** active ticket for the seat |
| TKT-28 | a ticket that is not valid cannot be transferred | A retired ticket cannot be re-transferred | `400` |
| TKT-29 | the recipient must exist and must be a buyer | Transfers cannot target ghosts or non-buyers | Unknown email `404`; organiser recipient `400` |
| TKT-30 | a ticket cannot be transferred to yourself | A no-op transfer is rejected | `400` |

### `GET /api/tickets/:id/provenance`

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-31 | walks the transfer trail | Ownership history is reconstructable, newest first | `200`; `history.length 2`; `[0]` is the recipient, `[1]` the original owner; `truncated false` |
| TKT-32 | a stranger cannot read the provenance | Ownership history is private | `403` |

### Chain integrity (end-to-end)

| ID | Test | Proves | Expected |
|---|---|---|---|
| TKT-33 | the chain still verifies after purchases, scans and transfers | The real user journey — buy, buy, scan, transfer — leaves the chain intact | `chain.valid === true`; `totalLinks 3`; `firstBrokenSeq null` |

> **Note on TKT-27.** The "seat is released" wording refers to the *ticket* releasing its hold; the seat itself is **not** returned to the market, because the replacement ticket immediately holds it. A third buyer is therefore still refused. This is the intended semantics and is asserted explicitly.

---

## Administration — ADM

**File:** `server/tests/admin.test.js` · **Cases:** 28

Covers the administrative surface: who may reach it, what the chain and statistics report, how users are managed (including immediate revocation of access), the demo-only tamper endpoint, and the admin listings.

### Access control

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-01 | a non-admin is refused every admin route | Authorisation is applied at the router, not per-handler | All six routes return `403` |
| ADM-02 | an anonymous caller is refused | The admin area is not public | `401` |
| ADM-03 | an organiser is refused | Elevated roles do not inherit admin access | `403` |

### `GET /api/admin/chain`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-04 | reports a valid chain | The dashboard reports both the verdict and the links | `200`; `summary.chainValid true`; `summary.totalLinks 1`; `total 1`; `data[0].check.isBroken false` |
| ADM-05 | is paginated | Paging the links does **not** narrow the summary | `200`; `data.length 1` on page 2 with `limit 2`; `summary.totalLinks 3` (whole chain); `summary.chainValid true` |
| ADM-06 | a negative page is a 400, not a 500 | Admin pagination shares the safe parser | `400` |

### `GET /api/admin/stats`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-07 | reports platform statistics | The dashboard figures are computed from real aggregates | `200`; `ticketsSold 1`; `activeEvents 1`; `entriesScanned 1`; `fraudAttemptsBlocked 1`; `chainValid true`; `dailyScans` is an array |
| ADM-08 | a transferred ticket is not counted as sold | Platform analytics use the same "active ticket" definition as event analytics | `200`; `ticketsSold 0` |

### `GET /api/admin/users`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-09 | returns a paginated list | The user list uses the shared list contract | `200`; `total 3`; `page 1`; `limit 20`; `data` is an array |
| ADM-10 | can be searched and filtered by role | Both query paths work and are independent | Search `zara` → `total 1`; `role=organizer` → `total 1` |
| ADM-11 | a malformed search term does not crash the request | The shared regex escaper protects admin search too | `200` |
| ADM-12 | an unknown role filter is a 400 | Role filters are enumerated | `400` |

### `PUT /api/admin/users/:id`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-13 | changes a role | An admin can promote/demote | `200`; `user.role` becomes `staff` |
| ADM-14 | a role change invalidates the target's existing token | A token minted before a role change cannot outlive it | `/me` is `200` before and `401` after; error mentions "no longer valid" |
| ADM-15 | a demoted admin loses admin access immediately | **Role is re-read from the database, not trusted from the JWT** | `/api/admin/stats` is `200` before and `401` after |
| ADM-16 | an admin cannot modify their own account | Self-lockout is prevented | `403`; error mentions "Self-lockout" |
| ADM-17 | the last remaining admin cannot be demoted | The platform can never be left without an administrator | `403`; error mentions "last remaining admin" |
| ADM-18 | an unknown user is a 404 | Valid-but-absent ids are a not-found | `404` |
| ADM-19 | an invalid id is a 400 | Malformed ids are a client error | `400` |
| ADM-20 | an unknown role is rejected | Roles are an enumerated set | `400` |
| ADM-21 | an empty update is a 400 | A no-op update is rejected | `400` |

> **ADM-17 is a controller-level test.** The self-modification guard (ADM-16) fires first for any caller who is also the target, so the last-admin guard is unreachable through the HTTP API. The test calls `updateUser` directly with a caller id that differs from the target and captures the error through `next`. This is deliberate: the guard is a defence-in-depth backstop and would otherwise be dead code without coverage.

### `POST /api/admin/simulate-tamper`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-22 | breaks the chain on purpose | The demo endpoint really does corrupt the chain, and detection follows | `200`; message mentions "TAMPERED"; chain `chainValid false` with `firstBrokenSeq 1`; stats `chainValid false` |
| ADM-23 | validates its input | Bad requests are refused before touching data | Missing `ticketId` `400`; malformed id `400`; unknown id `404` |

> The "demo endpoints are off unless explicitly enabled" rule is enforced at **boot** by `config/env.js` (and `ENABLE_DEMO_ENDPOINTS=true` in production is a fatal configuration error), so it is verified by the boot check rather than by an HTTP test.

### `GET /api/admin/events`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-24 | includes cancelled events | Admins see the full estate, unlike the buyer-facing list | `200`; `total 2`; titles `["Cancelled", "Kept"]`; `?cancelled=false` returns only "Kept" |

### `GET /api/admin/entry-logs`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-25 | lists the door scans | The audit trail is queryable and populated | `200`; `total 1`; `data[0].scanResult` is `invalid`; `data[0].scannedBy.name` is a string |
| ADM-26 | can be filtered by result and event | Both filters work and invalid values are rejected | `result=valid&eventId=…` → `1`; `result=already_used` → `0`; `result=maybe` → `400`; `eventId=nope` → `400` |

### `DELETE /api/admin/events/:id`

| ID | Test | Proves | Expected |
|---|---|---|---|
| ADM-27 | soft-deletes an event that has tickets | An admin cannot destroy a chain-bearing event | `200`; `event.cancelled true` |
| ADM-28 | removes an event without tickets | An unsold event can be hard-deleted | `200`; message mentions "deleted" |

---

## Hash-chain primitives — CHN

**File:** `server/tests/chain.test.js` · **Cases:** 22

These are unit-level tests of `server/utils/hashChain.js`. They exist because the API tests can only observe *whether* the chain verifies — they cannot isolate *why* a link is considered valid. CHN cases pin down the payload, the status hash and each verification invariant individually.

### `canonicalPayload`

| ID | Test | Proves | Expected |
|---|---|---|---|
| CHN-01 | does not contain the status | `status` is excluded from the chained payload | Payload contains no `"valid"` and splits into exactly **8** fields |
| CHN-02 | two links that differ only in status hash identically | A status change cannot shift the chain hash | `computeHash(a) === computeHash(b)` |
| CHN-03 | a changed seat changes the hash | `seatNumber` is covered | Hashes differ |
| CHN-04 | a changed buyer changes the hash | `buyerId` is covered | Hashes differ |
| CHN-05 | the transfer trail is part of the payload | `transferredFrom` / `originTicketId` are covered | Hashes differ when the trail is set |

### `computeStatusHash`

| ID | Test | Proves | Expected |
|---|---|---|---|
| CHN-06 | changes when the status changes | Status is protected by its own hash | Digests differ |
| CHN-07 | changes when the status timestamp changes | A status cannot be edited while keeping the old timestamp | Digests differ |
| CHN-08 | changes when the chain hash changes | The status hash is bound to its parent link | Digests differ |

### `verifyChainLink`

| ID | Test | Proves | Expected |
|---|---|---|---|
| CHN-09 | accepts an untouched link | A well-formed link verifies | `true` |
| CHN-10 | rejects a link whose seat was edited | Field tampering is detected | `false` |
| CHN-11 | rejects a link whose buyer was edited | Field tampering is detected | `false` |
| CHN-12 | rejects a link whose status was changed without updating statusHash | Status tampering is detected | `false` |
| CHN-13 | rejects a link with no status hash at all | A stripped status hash cannot be treated as "no tampering" | `false` |
| CHN-14 | rejects a missing ticket | Absence is not validity | `false` |

### `verifyFullChain`

| ID | Test | Proves | Expected |
|---|---|---|---|
| CHN-15 | an empty chain is valid | The empty-state summary is well-defined | `valid true`; `totalLinks 0`; `firstBrokenSeq null` |
| CHN-16 | a freshly built chain is valid and contiguous | The append path produces a gap-free chain | `valid true`; `totalLinks 3`; `valid 3`; seqs `[1,2,3]` |
| CHN-17 | the first link is anchored to the genesis hash | The chain has a well-defined root | `links[0].previousHash` and the ticket's `previousHash` both equal `GENESIS_HASH` |
| CHN-18 | detects a field that was edited behind the application's back | A raw `updateOne` is caught and located | `valid false`; `firstBrokenSeq 2`; `links[1].check.isBroken true`; `fieldIntegrityOk false`; link 0 still `isBroken false` |
| CHN-19 | detects a status that was changed without updating the status hash | Raw status edits are caught | `valid false`; `firstBrokenSeq 1`; `links[0].check.statusIntegrityOk false` |
| CHN-20 | detects a broken link | A rewritten `previousHash` is caught | `valid false`; `links[1].check.linkageOk false` |
| CHN-21 | detects a gap in the sequence | A deleted link is reported at the right position | `valid false`; `links[1].seq 3`; `contiguityOk false`; reason mentions "Expected seq 2" |
| CHN-22 | a legitimate status change keeps the chain valid | The status hash does not make normal use look like tampering | `valid true`; `valid 2` |

> CHN-18 through CHN-21 bypass Mongoose entirely with `Ticket.collection.updateOne` / `deleteOne`. That is the point: they simulate an attacker or a rogue operator editing the database directly, which no model-level validator would see.

---

## Traceability to the audit findings

The suite is organised around the defects found in the backend audit. This table maps each named finding to the tests that would fail if the defect were reintroduced.

| Finding | Defect | Guarding tests |
|---|---|---|
| **B1** | The unique seat index was never created, so the same seat could be sold twice | TKT-02, TKT-03 |
| **B2** | `status` was part of the hash but mutated during normal use, breaking the chain | CHN-01, CHN-02, CHN-12, CHN-19, CHN-22, TKT-17 |
| **B3** | A rolled-back chain tip burned sequence numbers, leaving permanent gaps | CHN-16, CHN-21, TKT-03 |
| **B4** | A transferred ticket's seat could be sold again while the replacement still held it | TKT-27 |
| **B5** | A placeholder JWT secret was accepted at boot | Verified by the boot check (see [Coverage boundaries](#coverage-boundaries)) |
| **B6** | A demoted admin kept admin access until their token expired | ADM-14, ADM-15 |
| **B8** | `simulate-tamper` was live whenever `NODE_ENV` was unset | ADM-22, ADM-23 + boot configuration check |
| **B9** | The door scanner admitted cancelled or not-yet-open tickets | TKT-20, TKT-24, TKT-25 |
| **B14** | `?page=-1` produced a `500` | EVT-08, EVT-09, TKT-11, ADM-06 |
| **B15** | `?q=[` produced a `500` | EVT-10, EVT-11, EVT-12, ADM-11 |
| **B16** | Analytics counted transferred tickets as sold | EVT-24, ADM-08 |

---

## Coverage boundaries

Honest scope statement — what the suite does **not** cover, and why.

| Area | Status | Notes |
|---|---|---|
| **Boot-time configuration refusal** | Verified manually, not automated | Starting the process with a placeholder `JWT_SECRET` in production exits with code `1` and a `[FATAL]` message. Automating it needs a spawned child process per case; it is documented in `server/README.md` and re-run as part of release checks. |
| **Rate limiting** | Not asserted | The limiters are reset before every test, and asserting them would make the suite slow and order-sensitive. The in-memory, per-instance nature of the counters is a documented limitation of the implementation itself. |
| **Real MongoDB Atlas behaviour** | Not covered | Tests run against an in-memory replica set. Network errors, Atlas failover and connection-pool exhaustion are out of scope. |
| **Real payment gateway** | Not covered | `services/payment.service.js` is a seam that records a `Payment` document. TKT-09 asserts the refund *bookkeeping*, not a card-network refund. |
| **Email delivery** | Not implemented | Password reset and email verification do not exist yet, so there is nothing to test. |
| **Client integration** | Not covered (deferred) | The response-contract changes (`{user}`, `{data,page,limit,total}`, the `verify` `eventId` and `result` changes) are documented in `server/README.md` under "Breaking Changes". `client/src/pages/staff/ScanTicket.jsx` still uses the old contract. |
| **True multi-process concurrency** | Best-effort | TKT-03 and TKT-09 issue two parallel requests in one process. They assert the invariant (exactly one winner) rather than a specific interleaving; the database is the arbiter. |
| **Load / performance** | Not covered | Chain verification is O(N) by design. There is no benchmark or large-chain test. |
| **Refresh tokens, MFA, password policy beyond length** | Not implemented | Out of scope for the current backend. |

---

## Conventions for adding tests

1. **Name the behaviour, not the function.** `test("the same seat cannot be bought twice", …)` — not `test("purchaseTicket throws"`, …)`. The title should read as a statement that is either true or false.
2. **Assert the observable contract.** Status code plus the specific body field(s) that matter. Avoid `expect(response.body).toBeTruthy()`.
3. **One behaviour per test.** If a title needs "and", consider splitting it.
4. **Reset state.** `beforeEach(resetDatabase)` is mandatory for any suite that writes. Never rely on another test's data.
5. **Prefer the API for setup** (`registerUser`, `createEvent`) so validation is exercised. Go direct (`createUser`, `insertEvent`) only when the API would legitimately refuse the setup — for example an `admin` account.
6. **Never `drop()` a collection.** `drop()` destroys the indexes and would silently disable the seat-uniqueness guarantee. Use `deleteMany()`.
7. **Do not weaken an assertion to make a test pass.** If the expected value is `SEAT_TAKEN`, assert `SEAT_TAKEN`. The bug this suite exists to catch is exactly the "it returned *something*" kind of test.
8. **Add the case to this document.** Assign the next free ID in the relevant suite, add the row, and add a traceability entry if it guards a known defect.
9. **Run the whole suite, not just the new file.** The chain is global state; a new suite that leaks chain links will surface in `chain.test.js` or TKT-33.

### Test structure template

```js
/**
 * tests/<area>.test.js — one line describing the area.
 */
const { describe, test, expect, beforeAll, beforeEach } = require("bun:test");
const { connect, resetDatabase } = require("./helpers/db");
const { app, request, registerUser } = require("./helpers/fixtures");

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/<route>", () => {
  test("states the behaviour under test", async () => {
    // Arrange — build only what this test needs.
    const buyer = await registerUser({ role: "buyer" });

    // Act — one request.
    const response = await request(app)
      .post("/api/<route>")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({ /* … */ });

    // Assert — the contract, not the implementation.
    expect(response.status).toBe(201);
    expect(response.body.<field>).toBe(<value>);
  });
});
```

---

## Fixture reference

All helpers live in `server/tests/helpers/fixtures.js`.

| Helper | Creates | Returns |
|---|---|---|
| `createUser({name, email, password, role})` | A user directly in the database (bypasses the API) | The `User` document |
| `registerUser(overrides)` | A user through `POST /api/auth/register` | `{ token, user, body, email, password }` |
| `loginUser(email, password?)` | A session through `POST /api/auth/login` | The token string |
| `createEvent(token, overrides)` | An event through `POST /api/events` | The `Event` document |
| `insertEvent(organizerId, overrides)` | An event directly in the database | The `Event` document |
| `insertTicket({eventId, buyerId, seatNumber, …})` | A ticket through the production hash-chain append path, inside a transaction | The `Ticket` document |
| `resetDatabase()` | Empties collections, resets the chain tip, resets the limiters | — |
| `connect()` | Awaits the in-memory replica set and the Mongoose connection | The Mongoose connection |

Default fixture values worth knowing:

- `bcrypt` cost **4** (tests only; production uses 10).
- New users default to role `buyer` with password `password123`.
- New events start **7 days in the future**, with `seatMap ["A1","A2","A3"]`, `capacity 3`, `price 25`.
- `insertTicket` defaults to `status: "valid"` and `issuedAt: new Date()`.

---

*This catalogue is generated from the test sources in `server/tests/`. When a test is renamed, split or added, update the corresponding row and the totals in [At a glance](#at-a-glance).*
