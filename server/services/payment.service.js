function idSuffix(value) {
  if (value === undefined || value === null) return "000000";
  const str =
    typeof value === "object"
      ? String(value._id ?? value.id ?? "")
      : String(value);
  return str.slice(-6).padStart(6, "0");
}

async function processPayment({ amount, userId, eventId, seatNumber = null }) {
  // Simulate network delay to the mock payment processor
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    success: true,
    transactionId: `mock_tx_${Date.now()}_${idSuffix(userId)}`,
    amount,
    currency: "USD",
    eventId: eventId ? String(eventId) : null,
    seatNumber,
  };
}

async function refund({ transactionId, amount }) {
  if (!transactionId) {
    return { success: false, transactionId: null, amount: amount ?? 0, currency: "USD" };
  }

  try {
    // Simulate the gateway round-trip.
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      success: true,
      transactionId: String(transactionId),
      amount: amount ?? 0,
      currency: "USD",
    };
  } catch (err) {
    console.error(`[PAYMENT] refund of ${transactionId} failed:`, err);
    return {
      success: false,
      transactionId: String(transactionId),
      amount: amount ?? 0,
      currency: "USD",
    };
  }
}

module.exports = {
  processPayment,
  refund,
};
