const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");

function buildPoolConfig(connectionString, env = process.env) {
    if (!connectionString) {
        throw new Error("A PostgreSQL connection string is required");
    }

    let parsed;

    try {
        parsed = new URL(connectionString);
    } catch (error) {
        throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
    }

    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error(
            "DATABASE_URL must use the postgres:// or postgresql:// scheme"
        );
    }

    const host = parsed.hostname.toLowerCase();
    const isLocal =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1";
    const sslMode = parsed.searchParams.get("sslmode");
    const production = env.NODE_ENV === "production";
    const useSsl =
        env.DATABASE_SSL === "true" ||
        (env.DATABASE_SSL !== "false" &&
            (Boolean(sslMode && sslMode !== "disable") ||
                (production && !isLocal)));

    const config = {
        connectionString,
        max: Number(env.DATABASE_POOL_MAX || 5),
        connectionTimeoutMillis: Number(
            env.DATABASE_CONNECT_TIMEOUT_MS || 10000
        ),
        idleTimeoutMillis: Number(
            env.DATABASE_IDLE_TIMEOUT_MS || 30000
        ),
        application_name: "campusfix"
    };

    if (useSsl) {
        config.ssl = {
            rejectUnauthorized:
                env.DATABASE_SSL_VERIFY !== "false"
        };
    }

    return config;
}

function createDatabase({ connectionString, env = process.env }) {
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    const pool = new Pool(buildPoolConfig(connectionString, env));
    const db = drizzle(pool);

    pool.on("error", (error) => {
        console.error(
            `Unexpected PostgreSQL pool error: ${error.code || "unknown"}`
        );
    });

    return { pool, db };
}

async function checkDatabase(database) {
    await database.pool.query("SELECT 1");
}

async function closeDatabase(database) {
    if (database && database.pool) {
        await database.pool.end();
    }
}

module.exports = {
    buildPoolConfig,
    createDatabase,
    checkDatabase,
    closeDatabase
};
