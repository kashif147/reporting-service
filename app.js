const express = require("express");
const dashboardRoutes = require("./routes/dashboard.routes");
const errorHandler = require("./utils/error");

const app = express();

app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Reporting Service Running");
});

// Routes
app.use("/dashboard", dashboardRoutes);

// Error handler
app.use(errorHandler);

module.exports = app;
