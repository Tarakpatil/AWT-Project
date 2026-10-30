const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { env } = require("../config/env");
const { HttpError } = require("../utils/httpError");

// --------------- Helpers ---------------

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

const SELF_ASSIGNABLE_ROLES = ["organizer", "buyer", "staff"];


function pickRegistrationFields(body) {
  return {
    name: body.name,
    email: body.email,
    password: body.password,
    role: body.role,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

async function register(req, res, next) {
  try {
    const { name, email, password, role } = pickRegistrationFields(req.body);

    // ── Validate required fields ──
    if (!name || !email || !password || !role) {
      throw new HttpError(
        400,
        "name, email, password, and role are required"
      );
    }

    // ── Block admin self-assignment ──
    if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
      throw new HttpError(
        403,
        `Role "${role}" cannot be self-assigned. Allowed: ${SELF_ASSIGNABLE_ROLES.join(", ")}`
      );
    }

    // ── Enforce password length ──
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(
        400,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      );
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      // bcrypt silently truncates beyond 72 bytes; reject instead of
      // hashing a truncated secret.
      throw new HttpError(
        400,
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
      );
    }

    // ── Hash password & create user ──
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, role });

    const token = signToken(user);

    return res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new HttpError(400, "Email and password are required");
    }

    // Need passwordHash for comparison — override `select: false`
    const user = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select("+passwordHash");

    // Generic message — identical for missing user and wrong password
    const GENERIC_FAIL = "Invalid email or password";

    if (!user) {
      throw new HttpError(401, GENERIC_FAIL);
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new HttpError(401, GENERIC_FAIL);
    }

    const token = signToken(user);

    // user.toJSON() strips passwordHash via the schema transform
    return res.json({ token, user });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    return res.json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, getMe };
