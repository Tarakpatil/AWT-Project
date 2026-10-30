const mongoose = require("mongoose");
const { Schema } = mongoose;

const entryLogSchema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      default: null, // null when the scan was a forged / unknown hash
    },
    scannedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Scanner (staff) reference is required"],
    },
    // The event whose door the scan happened at. Recorded so the admin
    // entry-log listing can be filtered by event.
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      default: null,
      index: true,
    },
    scanResult: {
      type: String,
      enum: {
        values: ["valid", "invalid", "already_used"],
        message: "{VALUE} is not a valid scan result",
      },
      required: [true, "Scan result is required"],
    },
    scannedHash: {
      type: String,
      required: [true, "Scanned hash must be recorded"],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // No automatic timestamps — we use `timestamp` explicitly.
    timestamps: false,
  }
);

entryLogSchema.index({ ticketId: 1, scanResult: 1, timestamp: 1 });
entryLogSchema.index({ timestamp: -1 });
entryLogSchema.index({ scannedBy: 1, timestamp: -1 });

entryLogSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("EntryLog", entryLogSchema);
