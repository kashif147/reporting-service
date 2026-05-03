/**
 * Error Handler Middleware
 * Prevents information leakage in production
 */
module.exports = (err, req, res, next) => {
  const requestId = req.id || req.headers["x-request-id"] || "unknown";
  const correlationId =
    req.correlationId || req.headers["x-correlation-id"] || null;
  const isProduction = process.env.NODE_ENV === "production";
  
  // Log full error details server-side for debugging
  console.error(`[${requestId}] Error:`, {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    status: err.status || 500,
  });
  
  // Generic message in production, detailed in development
  const status = err.status || 500;
  res.status(status).json({
    error: "Internal Server Error",
    requestId,
    correlationId,
    ...(isProduction ? {} : { message: err.message }),
  });
};
