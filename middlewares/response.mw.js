const { AppError } = require("../errors/AppError");

function responseMiddleware(req, res, next) {
  res.success = (data, message = "Success") =>
    res.status(200).json({
      status: "success",
      message,
      data,
      timestamp: new Date().toISOString(),
    });

  res.fail = (message = "Bad request") =>
    res.status(400).json({
      success: false,
      error: {
        message,
        code: "BAD_REQUEST",
        status: 400,
      },
    });

  res.notFoundRecord = (message = "Record not found") =>
    res.status(200).json({
      success: true,
      data: null,
      message,
    });

  next();
}

function templateErrorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      success: false,
      error: {
        message: error.message,
        code: error.code,
        status: error.status,
      },
    });
  }
  return next(error);
}

module.exports = responseMiddleware;
module.exports.templateErrorHandler = templateErrorHandler;
