const { Router } = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const {
  verifyRateLimit,
  purchaseRateLimit,
  transferRateLimit,
} = require("../middleware/limiters");
const {
  purchaseTicket,
  getMyTickets,
  getTicketQr,
  verifyTicket,
  transferTicket,
  getProvenance,
} = require("../controllers/ticket.controller");

const router = Router();

// All ticket routes require authentication
router.use(authMiddleware);


// POST /api/tickets/purchase — buyers only
router.post("/purchase", roleMiddleware("buyer"), purchaseRateLimit, purchaseTicket);

// GET /api/tickets/mine — buyers only
router.get("/mine", roleMiddleware("buyer"), getMyTickets);

// POST /api/tickets/verify — staff (or admin) only
router.post("/verify", roleMiddleware("staff", "admin"), verifyRateLimit, verifyTicket);

// POST /api/tickets/transfer — buyers only
router.post("/transfer", roleMiddleware("buyer"), transferRateLimit, transferTicket);

// GET /api/tickets/:id/qr — owner, staff or admin
router.get("/:id/qr", getTicketQr);

// GET /api/tickets/:id/provenance — any authenticated user (handler checks specific access)
router.get("/:id/provenance", getProvenance);

module.exports = router;
