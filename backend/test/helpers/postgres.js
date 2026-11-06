const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const EmbeddedPostgres = require("embedded-postgres").default;

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function startTestDatabase() {
    const port = await freePort();
    const dataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "campusfix-pg-")
    );
    const databaseName = "campusfix_test";

    const postgres = new EmbeddedPostgres({
        databaseDir: dataDir,
        port,
        user: "postgres",
        password: "postgres",
        persistent: false,
        onLog: () => {},
        onError: () => {}
    });

    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase(databaseName);

    const connectionString =
        `postgres://postgres:postgres@127.0.0.1:${port}/${databaseName}`;

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = connectionString;
    process.env.JWT_SECRET =
        "test-only-jwt-secret-with-more-than-thirty-two-bytes";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    process.env.DISABLE_RATE_LIMIT = "true";
    process.env.BCRYPT_ROUNDS = "10";
    process.env.COOKIE_SECURE = "false";

    const { runMigrations } = require("../../db/migrate");
    await runMigrations();

    async function stop() {
        try {
            await postgres.stop();
        } catch (error) {
            // The cluster may already have been stopped by the exit hook.
        }

        try {
            fs.rmSync(dataDir, { recursive: true, force: true });
        } catch (error) {
            // Windows may briefly hold a file handle; temp cleanup is best-effort.
        }
    }

    return {
        connectionString,
        dataDir,
        port,
        stop
    };
}

module.exports = {
    startTestDatabase
};
