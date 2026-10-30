const mongoose = require("mongoose");
const { Schema } = mongoose;

const ticketSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Event reference is required"],
      index: true,
    },
    buyerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Buyer reference is required"],
      index: true,
    },
    seatNumber: {
      type: String,
      default: null, // null = general admission (no assigned seat)
      trim: true,
    },

    seatActive: {
      type: Boolean,
      default: false,
    },
    seq: {
      type: Number,
      required: [true, "Chain sequence number is required"],
      unique: true,
      index: true,
    },
    currentHash: {
      type: String,
      unique: true,
      index: true,
    },
    previousHash: {
      type: String,
      required: [true, "Previous hash is required for chain integrity"],
    },
    status: {
      type: String,
      enum: {
        values: ["valid", "used", "transferred"],
        message: "{VALUE} is not a valid ticket status",
      },
      default: "valid",
    },
    statusHash: {
      type: String,
      required: [true, "Status hash is required"],
    },

    statusUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    transferredFrom: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },
    originTicketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },

    qrPayload: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: false,
  }
);

ticketSchema.index(
  { eventId: 1, seatNumber: 1 },
  {
    unique: true,
    name: "eventId_1_seatNumber_1",
    partialFilterExpression: {
      seatNumber: { $type: "string" },
      seatActive: true,
    },
  }
);

ticketSchema.index({ buyerId: 1, seq: -1 });

ticketSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Ticket", ticketSchema);
