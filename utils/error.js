/**
 * Error Handler Middleware
 * Prevents information leakage in production
 */
module.exports = (err, req, res, next) => {
  const requestId = req.id || req.headers["x-request-id"] || "unknown";
  const correlationId =
    req.correlationId || req.headers["x-correlation-id"] || null;
  const isProduction = process.env.NODE_ENV === "production";

  const status = err.status || err.statusCode || 500;

  console.error(`[${requestId}] Error:`, {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    status,
  });

  if (err.name === "AppError" || err.code === "BAD_REQUEST" || err.code === "NOT_FOUND") {
    return res.status(status).json({
      success: false,
      error: {
        message: err.message,
        code: err.code || "APP_ERROR",
        status,
      },
      requestId,
      correlationId,
    });
  }

  res.status(status).json({
    error: "Internal Server Error",
    requestId,
    correlationId,
    ...(isProduction ? {} : { message: err.message }),
  });
};
