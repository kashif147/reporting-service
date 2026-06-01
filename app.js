const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const dashboardRoutes = require("./routes/dashboard.routes");
const membershipReportRoutes = require("./routes/membershipReport.routes");
const errorHandler = require("./utils/error");
const bizLogger = require("./config/bizLogger.js");
const {
  correlationIdMiddleware,
  logErrorMiddleware,
  createSystemLogsRouter,
} = require("@projectShell/logging-lib");

const app = express();

// Disable Express automatic ETag generation (304 responses)
app.set("etag", false);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginEmbedderPolicy: false, // Disable for API compatibility
  })
);

// CORS — skip when the API gateway sets Access-Control-* (avoids duplicate headers)
const gatewayHandlesCors =
  process.env.GATEWAY_HANDLES_CORS === "true" ||
  process.env.GATEWAY_HANDLES_CORS === "1";

if (!gatewayHandlesCors) {
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  };
  app.use(cors(corsOptions));
} else {
  console.log("✅ CORS handled by API gateway (GATEWAY_HANDLES_CORS)");
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests",
    code: "RATE_LIMIT_EXCEEDED",
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use(express.json());

app.use(correlationIdMiddleware);
app.use("/api", createSystemLogsRouter(bizLogger));

// Request ID middleware
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader("X-Request-ID", req.id);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.send("Reporting Service Running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP" });
});

// Routes — mount under /api for gateway (rewrite sends /reporting-service/api/* → /api/*)
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports/membership", membershipReportRoutes);
// Direct access (Postman, local without gateway prefix)
app.use("/dashboard", dashboardRoutes);
app.use("/reports/membership", membershipReportRoutes);

// Error handler
app.use(logErrorMiddleware(bizLogger));
app.use(errorHandler);

module.exports = app;
