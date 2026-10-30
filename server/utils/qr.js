const qrcode = require("qrcode");
const crypto = require("crypto");
const { env } = require("../config/env");

function buildQrPayload({ hash, ticketId }) {
  const payload = { hash: String(hash), ticketId: String(ticketId) };

  // this works on HMAC-SHA256
  if (env.signQr) {
    payload.sig = signQrPayload(payload.hash, payload.ticketId);
  }

  return payload;
}

/** Computes the HMAC-SHA256 signature over `hash|ticketId`. */
function signQrPayload(hash, ticketId) {
  return crypto
    .createHmac("sha256", env.qrSigningSecret)
    .update(`${String(hash)}|${String(ticketId)}`)
    .digest("hex");
}

function verifyQrSignature(hash, ticketId, sig) {
  if (!env.signQr) return true;
  if (!sig || !hash || !ticketId) return false;

  const expected = Buffer.from(signQrPayload(hash, ticketId), "utf8");
  const provided = Buffer.from(String(sig), "utf8");

  if (expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(expected, provided);
}

async function generateQR({ hash, ticketId }) {
  const payloadObj = buildQrPayload({ hash, ticketId });
  const payloadStr = JSON.stringify(payloadObj);
  return qrcode.toDataURL(payloadStr);
}

function buildQrPayloadString({ hash, ticketId }) {
  return JSON.stringify(buildQrPayload({ hash, ticketId }));
}

module.exports = {
  generateQR,
  buildQrPayload,
  buildQrPayloadString,
  signQrPayload,
  verifyQrSignature,
};
