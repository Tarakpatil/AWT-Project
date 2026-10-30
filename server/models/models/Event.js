const mongoose = require("mongoose");
const { Schema } = mongoose;

function isValidSeatMap(value) {
  if (value === null || value === undefined) return true;

  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    for (const seat of value) {
      if (typeof seat !== "string" || seat.trim() === "") return false;
    }
    // Duplicate labels would silently make a seat unsellable.
    return new Set(value).size === value.length;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    return keys.every((key) => key.trim() !== "");
  }

  return false;
}

const eventSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
      maxlength: [200, "Event title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    date: {
      type: Date,
      required: [true, "Event date is required"],
      validate: {
        validator: function (value) {
          return value > new Date();
        },
        message: "Event date must be in the future",
      },
    },
    venue: {
      type: String,
      required: [true, "Venue is required"],
      trim: true,
      maxlength: [300, "Venue cannot exceed 300 characters"],
    },
    seatMap: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: function (value) {
          if (!isValidSeatMap(value)) {
            return false;
          }
          if (
            Array.isArray(value) &&
            this.capacity !== undefined &&
            this.capacity !== null &&
            value.length !== this.capacity
          ) {
            return false;
          }
          return true;
        },
        message:
          "seatMap must be null (general admission), an array of unique non-empty seat labels, or an object keyed by seat label, and its length must equal the capacity",
      },
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    capacity: {
      type: Number,
      required: [true, "Capacity is required"],
      min: [1, "Capacity must be at least 1"],
      validate: {
        validator: function (value) {
          if (!Number.isInteger(value)) {
            return false;
          }
          // The mirror image of the seatMap check: whenever the capacity
          // changes it is compared against the venue layout.
          if (
            Array.isArray(this.seatMap) &&
            this.seatMap.length !== value
          ) {
            return false;
          }
          return true;
        },
        message:
          "Capacity must be a whole number and must equal the number of seats in seatMap",
      },
    },

    ticketsSold: {
      type: Number,
      default: 0,
      min: [0, "ticketsSold cannot be negative"],
    },
    organizerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Organizer is required"],
      index: true,
    },

    cancelled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

eventSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Event", eventSchema);
module.exports.isValidSeatMap = isValidSeatMap;
