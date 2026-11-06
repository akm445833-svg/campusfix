const { ZodError } = require("zod");

class ApiError extends Error {
    constructor(status, message, code) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

function notFound(message = "Not found") {
    return new ApiError(404, message, "not_found");
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof ZodError) {
        const issues = error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
        }));

        return res.status(400).json({
            message: issues[0] ? issues[0].message : "Invalid request",
            errors: issues
        });
    }

    if (error instanceof ApiError) {
        return res.status(error.status).json({
            message: error.message,
            code: error.code
        });
    }

    if (error.type === "entity.parse.failed") {
        return res.status(400).json({
            message: "Request body must be valid JSON"
        });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            message: "Request body is too large"
        });
    }

    console.error(
        `[error] ${req.method} ${req.path} ${error.name || "Error"}: ${
            error.message || "unexpected error"
        }`
    );

    return res.status(500).json({
        message: "Internal server error"
    });
}

module.exports = {
    ApiError,
    notFound,
    errorHandler
};
