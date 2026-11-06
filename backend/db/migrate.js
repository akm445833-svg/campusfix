#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const { createDatabase, closeDatabase } = require("./client");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const MIGRATION_LOCK_ID = 727274001;

async function ensureMigrationTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    `);
}

function checksum(contents) {
    return crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex");
}

async function runMigrations() {
    const connectionString =
        process.env.DIRECT_URL || process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "DIRECT_URL or DATABASE_URL must be configured"
        );
    }

    const database = createDatabase({ connectionString });
    const { pool } = database;
    let lockClient;

    try {
        lockClient = await pool.connect();

        await lockClient.query("SELECT pg_advisory_lock($1)", [
            MIGRATION_LOCK_ID
        ]);

        await ensureMigrationTable(lockClient);

        const files = (await fs.readdir(MIGRATIONS_DIR))
            .filter((file) => file.endsWith(".sql"))
            .sort();

        for (const file of files) {
            const sql = await fs.readFile(
                path.join(MIGRATIONS_DIR, file),
                "utf8"
            );
            const hash = checksum(sql);

            const existing = await lockClient.query(
                `SELECT checksum FROM schema_migrations WHERE name = $1`,
                [file]
            );

            if (existing.rowCount > 0) {
                if (existing.rows[0].checksum !== hash) {
                    throw new Error(
                        `Applied migration ${file} has changed; refusing to continue`
                    );
                }

                console.log(`Already applied: ${file}`);
                continue;
            }

            try {
                await lockClient.query("BEGIN");
                await lockClient.query(sql);
                await lockClient.query(
                    `
                        INSERT INTO schema_migrations (name, checksum)
                        VALUES ($1, $2)
                    `,
                    [file, hash]
                );
                await lockClient.query("COMMIT");
                console.log(`Applied: ${file}`);
            } catch (error) {
                await lockClient.query("ROLLBACK");
                throw error;
            }
        }

        const verification = await lockClient.query(`
            SELECT name, applied_at
            FROM schema_migrations
            ORDER BY name
        `);

        console.log(
            `Database migrations verified (${verification.rowCount} applied).`
        );
    } finally {
        if (lockClient) {
            try {
                await lockClient.query(
                    "SELECT pg_advisory_unlock($1)",
                    [MIGRATION_LOCK_ID]
                );
            } catch (error) {
                // The session may already be gone; releasing the client
                // also releases any session-level advisory lock.
            }

            lockClient.release();
        }

        await closeDatabase(database);
    }
}

if (require.main === module) {
    runMigrations().catch((error) => {
        console.error(
            `Migration failed: ${error.message || "unknown database error"}`
        );
        process.exitCode = 1;
    });
}

module.exports = {
    runMigrations
};
