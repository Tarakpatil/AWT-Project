#!/usr/bin/env node
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const { env, initEnv } = require("./config/env");
const connectDB = require("./config/db");
const errorMiddleware = require("./middleware/error.middleware");

// Validate the environment BEFORE anything else touches it.
initEnv();

const authRoutes = require("./routes/auth.routes");
const eventRoutes = require("./routes/event.routes");
const ticketRoutes = require("./routes/ticket.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        env.isDevelopment &&
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      if (env.clientUrls.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const userId = req.user?.userId || "anon";
    const line = `${req.method} ${req.path} ${res.statusCode} ${duration}ms user=${userId}`;

    if (res.statusCode >= 500) {
      console.error(`[REQ] ${line}`);
    } else {
      console.log(`[REQ] ${line}`);
    }
  });

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    environment: env.nodeEnv,
    transactions: mongoose.connection.readyState === 1,
    uptime: Math.round(process.uptime()),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/admin", adminRoutes);

app.all("/api/{*splat}", (_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error middleware must be last.
app.use(errorMiddleware);

const PORT = env.port;
let server;
let shuttingDown = false;

async function start() {
  await connectDB();
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${env.nodeEnv})`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received. Shutting down gracefully...`);

  if (server) {
    await new Promise((resolve) => {
      const forceExit = setTimeout(() => {
        console.error("HTTP server did not close in time; forcing exit.");
        resolve();
      }, 10_000);
      if (typeof forceExit.unref === "function") forceExit.unref();

      server.close(() => {
        clearTimeout(forceExit);
        console.log("HTTP server closed.");
        resolve();
      });
    });
  }

  try {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  } catch (err) {
    console.error("Error closing MongoDB connection:", err);
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("FATAL: Unhandled promise rejection:", reason);
  shutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error("FATAL: Uncaught exception:", err);
  shutdown("uncaughtException");
});

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
