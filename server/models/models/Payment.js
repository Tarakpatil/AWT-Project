const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Payer is required"],
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Event is required"],
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "USD",
    },
    transactionId: {
      type: String,
      required: [true, "Transaction id is required"],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ["captured", "refunded", "failed"],
        message: "{VALUE} is not a valid payment status",
      },
      default: "captured",
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

paymentSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Payment", paymentSchema);
