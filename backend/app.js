const path = require("node:path");

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const { checkDatabase } = require("./db/client");
const { createAuthService } = require("./lib/auth");
const { errorHandler, notFound } = require("./lib/errors");
const { createAuthRouter } = require("./routes/auth");
const {
    createComplaintsRouter
} = require("./routes/complaints");
const {
    createAdminRouter,
    createUsersRouter
} = require("./routes/admin");
const { createChatRouter } = require("./routes/chat");
const {
    createNotificationsRouter
} = require("./routes/notifications");
const { createNoticesRouter } = require("./routes/notices");
const { createProfileRouter } = require("./routes/profile");
const {
    createFacilitiesRouter,
    createLostFoundRouter,
    createOperationsRouter
} = require("./routes/services");
const {
    FRONTEND_FILES: FRONTEND_FILE_LIST
} = require("./lib/frontend-files");

const FRONTEND_ROOT = path.join(__dirname, "..");
const FRONTEND_FILES = new Set(FRONTEND_FILE_LIST);

function normalizeOrigin(origin) {
    return String(origin || "").replace(/\/$/, "");
}

function originGuard(config) {
    return function checkOrigin(req, res, next) {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            return next();
        }

        const origin = req.get("origin");

        if (origin) {
            if (
                !config.allowedOriginsSet.has(
                    normalizeOrigin(origin)
                )
            ) {
                return res.status(403).json({
                    message: "Request origin is not allowed"
                });
            }

            return next();
        }

        const referer = req.get("referer");

        if (referer) {
            try {
                const refererOrigin = new URL(referer).origin;

                if (
                    !config.allowedOriginsSet.has(
                        normalizeOrigin(refererOrigin)
                    )
                ) {
                    return res.status(403).json({
                        message: "Request origin is not allowed"
                    });
                }
            } catch (error) {
                return res.status(403).json({
                    message: "Invalid request origin"
                });
            }
        }

        next();
    };
}

function corsOptions(config) {
    return {
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }

            return callback(
                null,
                config.allowedOriginsSet.has(
                    normalizeOrigin(origin)
                )
            );
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        maxAge: 600
    };
}

function securityHeaders(config) {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                imgSrc: ["'self'", "data:"],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'"],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                upgradeInsecureRequests:
                    config.production ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: {
            policy: "same-origin"
        },
        hsts: config.production
            ? {
                  maxAge: 15552000,
                  includeSubDomains: true
              }
            : false,
        referrerPolicy: {
            policy: "no-referrer"
        }
    });
}

function createApp({ config, database }) {
    const app = express();
    const auth = createAuthService({
        config,
        db: database.db
    });

    app.disable("x-powered-by");
    app.set("trust proxy", config.trustProxy);

    app.use(securityHeaders(config));
    app.use((req, res, next) => {
        res.setHeader(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(self)"
        );
        next();
    });
    app.use(cors(corsOptions(config)));
    app.use(express.json({ limit: "2mb" }));
    app.use(cookieParser());
    app.use(originGuard(config));

    app.use("/api", (req, res, next) => {
        if (req.is("multipart/form-data")) {
            return res.status(415).json({
                message:
                    "File uploads are not supported by this API"
            });
        }

        next();
    });

    const limiterOptions = {
        windowMs: 15 * 60 * 1000,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        skip: () => !config.rateLimitEnabled
    };

    const apiLimiter = rateLimit({
        ...limiterOptions,
        limit: config.apiRateLimitMax,
        message: {
            message:
                "Too many requests. Please try again later."
        }
    });

    const authLimiter = rateLimit({
        ...limiterOptions,
        limit: config.authRateLimitMax,
        message: {
            message:
                "Too many authentication attempts. Please try again later."
        }
    });

    app.get("/api", (req, res) => {
        res.json({
            message: "CampusFix Backend is Running"
        });
    });

    app.get("/api/public-config", (req, res) => {
        res.setHeader("Cache-Control", "public, max-age=300");
        res.json({
            collegeName:
                config.collegeName || "CampusFix",
            appName: "CampusFix"
        });
    });

    app.get("/api/health", async (req, res) => {
        try {
            await checkDatabase(database);
            res.json({
                status: "OK",
                database: "connected"
            });
        } catch (error) {
            res.status(503).json({
                status: "ERROR",
                database: "unavailable"
            });
        }
    });

    app.use("/api", apiLimiter);
    app.use("/api/login", authLimiter);
    app.use("/api/register", authLimiter);

    app.use("/api", createAuthRouter({ config, db: database.db, auth }));
    app.use(
        "/api/complaints",
        createComplaintsRouter({ db: database.db, auth })
    );
    app.use(
        "/api/admin",
        createAdminRouter({ db: database.db, auth })
    );
    app.use(
        "/api/users",
        createUsersRouter({ db: database.db, auth })
    );
    app.use(
        "/api/chat",
        createChatRouter({ db: database.db, auth })
    );
    app.use(
        "/api/notifications",
        createNotificationsRouter({
            db: database.db,
            auth
        })
    );
    app.use(
        "/api/notices",
        createNoticesRouter({ db: database.db, auth })
    );
    app.use(
        "/api/profile",
        createProfileRouter({
            config,
            db: database.db,
            auth
        })
    );
    app.use(
        "/api/facilities",
        createFacilitiesRouter({ db: database.db, auth })
    );
    app.use(
        "/api/lost-found",
        createLostFoundRouter({ db: database.db, auth })
    );
    app.use(
        "/api/operations",
        createOperationsRouter({ db: database.db, auth })
    );

    app.use("/api", (req, res, next) => {
        next(notFound("API route not found"));
    });

    app.get("/", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(path.join(FRONTEND_ROOT, "index.html"));
    });

    app.use((req, res, next) => {
        if (
            req.method !== "GET" ||
            !FRONTEND_FILES.has(req.path.slice(1))
        ) {
            return next(notFound());
        }

        const isHtml = req.path.endsWith(".html");
        const isServiceWorker = req.path === "/sw.js";

        res.setHeader(
            "Cache-Control",
            isServiceWorker
                ? "no-cache"
                : isHtml
                  ? "no-store"
                  : "public, max-age=300"
        );

        return res.sendFile(
            path.join(FRONTEND_ROOT, req.path.slice(1))
        );
    });

    app.use((req, res, next) => {
        next(notFound());
    });

    app.use(errorHandler);

    return app;
}

module.exports = {
    createApp,
    FRONTEND_FILES
};
