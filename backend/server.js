require("dotenv").config({
    path: require("node:path").join(__dirname, ".env")
});

const { loadConfig } = require("./config");
const {
    createDatabase,
    checkDatabase,
    closeDatabase
} = require("./db/client");
const { createApp } = require("./app");

async function startServer() {
    const config = loadConfig();
    const database = createDatabase({
        connectionString: config.databaseUrl
    });

    try {
        await checkDatabase(database);
    } catch (error) {
        await closeDatabase(database);
        throw new Error(
            `PostgreSQL is unavailable (${error.code || "connection failed"})`
        );
    }

    const app = createApp({ config, database });
    const server = app.listen(config.port, () => {
        console.log(
            `CampusFix API listening on port ${config.port} (${config.nodeEnv})`
        );
    });

    server.requestTimeout = 60000;
    server.headersTimeout = 65000;
    server.keepAliveTimeout = 5000;

    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log(`Received ${signal}; shutting down`);

        const forceExit = setTimeout(() => {
            console.error("Graceful shutdown timed out");
            process.exit(1);
        }, 10000);
        forceExit.unref();

        server.close(async (error) => {
            try {
                await closeDatabase(database);
            } catch (closeError) {
                console.error(
                    "Could not close the database pool cleanly"
                );
            }

            clearTimeout(forceExit);

            if (error) {
                console.error(
                    `HTTP server shutdown error: ${error.message}`
                );
                process.exit(1);
            }

            process.exit(0);
        });

        if (typeof server.closeIdleConnections === "function") {
            server.closeIdleConnections();
        }
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (error) => {
        console.error(
            `Unhandled rejection: ${error && error.message ? error.message : "unknown"}`
        );
        shutdown("unhandledRejection");
    });

    process.on("uncaughtException", (error) => {
        console.error(
            `Uncaught exception: ${error.message || "unknown"}`
        );
        shutdown("uncaughtException");
    });

    return { server, database };
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error(`CampusFix failed to start: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    startServer
};
