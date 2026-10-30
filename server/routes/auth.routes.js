const { Router } = require("express");
const { register, login, getMe } = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { loginRateLimit, registerRateLimit } = require("../middleware/limiters");

const router = Router();


// POST /api/auth/register — public
router.post("/register", registerRateLimit, register);

// POST /api/auth/login — public
router.post("/login", loginRateLimit, login);

// GET  /api/auth/me — requires valid JWT
router.get("/me", authMiddleware, getMe);

module.exports = router;
