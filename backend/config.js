const MIN_JWT_SECRET_LENGTH = 32;

function parseOrigins(value) {
    return String(value || "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
}

function booleanValue(value, fallback = false) {
    if (value === undefined) {
        return fallback;
    }

    return value === "true";
}

function numberValue(value, fallback) {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : fallback;
}

function loadConfig(env = process.env) {
    const nodeEnv = env.NODE_ENV || "development";
    const production = nodeEnv === "production";
    const databaseUrl = env.DATABASE_URL;
    const jwtSecret = env.JWT_SECRET;

    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }

    if (!jwtSecret) {
        throw new Error("JWT_SECRET is required");
    }

    if (
        production &&
        Buffer.byteLength(jwtSecret, "utf8") <
            MIN_JWT_SECRET_LENGTH
    ) {
        throw new Error(
            `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} bytes in production`
        );
    }

    const allowedOrigins = parseOrigins(env.CORS_ORIGINS);

    if (production && allowedOrigins.length === 0) {
        throw new Error(
            "CORS_ORIGINS must list the deployed frontend origin in production"
        );
    }

    return {
        nodeEnv,
        production,
        databaseUrl,
        jwtSecret,
        port: Number(env.PORT || 5000),
        cookieSecure: production || booleanValue(env.COOKIE_SECURE),
        cookieName: "campusfix_session",
        sessionDurationMs: 7 * 24 * 60 * 60 * 1000,
        allowedOrigins,
        allowedOriginsSet: new Set(allowedOrigins),
        collegeName:
            String(env.COLLEGE_NAME || "CampusFix")
                .trim()
                .slice(0, 120) || "CampusFix",
        trustProxy: numberValue(env.TRUST_PROXY_HOPS, production ? 1 : 0),
        rateLimitEnabled:
            nodeEnv !== "test" &&
            !booleanValue(env.DISABLE_RATE_LIMIT),
        authRateLimitMax: numberValue(env.AUTH_RATE_LIMIT_MAX, 10),
        apiRateLimitMax: numberValue(env.API_RATE_LIMIT_MAX, 300),
        bcryptRounds: Math.max(
            10,
            Math.min(14, numberValue(env.BCRYPT_ROUNDS, 12))
        )
    };
}

module.exports = {
    loadConfig,
    parseOrigins,
    MIN_JWT_SECRET_LENGTH
};
