class AppError extends Error {
  constructor(message, status = 500, code = "APP_ERROR", extras = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    Object.assign(this, extras);
  }

  static notFound(message = "Not found", extras = {}) {
    return new AppError(message, 404, "NOT_FOUND", extras);
  }

  static badRequest(message = "Bad request", extras = {}) {
    return new AppError(message, 400, "BAD_REQUEST", extras);
  }

  static forbidden(message = "Forbidden", extras = {}) {
    return new AppError(message, 403, "FORBIDDEN", extras);
  }

  static unauthorized(message = "Unauthorized", extras = {}) {
    return new AppError(message, 401, "UNAUTHORIZED", extras);
  }
}

module.exports = { AppError };
