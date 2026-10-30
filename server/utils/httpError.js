class HttpError extends Error {

  constructor(status, message, details, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;

    if (details && typeof details === "object" && code === undefined) {
      const { code: hoisted, ...rest } = details;
      if (typeof hoisted === "string") {
        code = hoisted;
        details = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }

    if (details !== undefined) this.details = details;
    if (code !== undefined) this.code = code;
  }
}

module.exports = { HttpError };
