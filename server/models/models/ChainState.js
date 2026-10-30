const mongoose = require("mongoose");

//tracks the current hash chain.

const chainStateSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: "main",
    },
    seq: {
      type: Number,
      required: true,
      default: 0,
    },
    lastHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: false,
  }
);

module.exports = mongoose.model("ChainState", chainStateSchema);
