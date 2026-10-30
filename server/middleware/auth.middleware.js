const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { env } = require("../config/env");

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Authentication required: no token provided" });
  }

  const token = header.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ error: "Authentication required: no token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token has expired" });
    }
    // JsonWebTokenError, NotBeforeError, or anything else
    return res.status(401).json({ error: "Invalid token" });
  }

  if (!decoded?.userId) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {

    const account = await User.findById(decoded.userId).select("role tokenVersion");

    if (!account) {
      return res.status(401).json({ error: "Account no longer exists" });
    }

    const tokenVersion = Number(decoded.tokenVersion || 0);
    if (tokenVersion !== (account.tokenVersion || 0)) {
      return res.status(401).json({
        error: "Token is no longer valid — your account permissions changed. Please sign in again.",
      });
    }

    req.user = { userId: String(decoded.userId), role: account.role };
    return next();
  } catch (err) {
    // An invalid ObjectId in the token would surface as a CastError.
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = authMiddleware;
