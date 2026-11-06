#!/usr/bin/env node

const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const {
    createDatabase,
    closeDatabase,
    checkDatabase
} = require("../db/client");
const {
    loadBackupData,
    verifyImportedData
} = require("./import-mongo-backup");

async function verifyMigration(options = {}) {
    const backupDir =
        options.backupDir || process.env.BACKUP_DIR;
    const connectionString =
        options.connectionString ||
        process.env.DIRECT_URL ||
        process.env.DATABASE_URL;

    if (!backupDir) {
        throw new Error(
            "BACKUP_DIR is required. Pass the completed mongo-* backup directory."
        );
    }

    if (!connectionString) {
        throw new Error(
            "DIRECT_URL or DATABASE_URL is required to verify PostgreSQL"
        );
    }

    const { manifest, data } = await loadBackupData(backupDir);

    if (data.errors.length > 0) {
        throw new Error(
            `Backup has ${data.errors.length} validation error(s):\n${data.errors
                .slice(0, 20)
                .join("\n")}`
        );
    }

    const database = createDatabase({ connectionString });

    try {
        await checkDatabase(database);

        const counts = await verifyImportedData(database.db, data);

        const integrity = await database.pool.query(`
            SELECT
                (SELECT count(*) FROM users
                    WHERE legacy_mongo_id IS NULL)::int
                    AS users_without_legacy_id,
                (SELECT count(*) FROM complaints
                    WHERE legacy_mongo_id IS NULL)::int
                    AS complaints_without_legacy_id,
                (SELECT count(*) FROM chats
                    WHERE legacy_mongo_id IS NULL)::int
                    AS chats_without_legacy_id,
                (SELECT count(*) FROM complaints c
                    LEFT JOIN users u ON u.id = c.created_by
                    WHERE u.id IS NULL)::int
                    AS complaints_without_owner,
                (SELECT count(*) FROM chats c
                    LEFT JOIN users s ON s.id = c.sender_id
                    LEFT JOIN users r ON r.id = c.receiver_id
                    WHERE s.id IS NULL OR r.id IS NULL)::int
                    AS chats_without_participant,
                (SELECT count(*) FROM users
                    WHERE role = 'admin')::int AS admins
        `);

        const row = integrity.rows[0];

        for (const [key, value] of Object.entries(row)) {
            if (Number(value) !== 0 && key !== "admins") {
                throw new Error(
                    `Integrity verification failed: ${key}=${value}`
                );
            }
        }

        console.log("Migration verification passed.");
        console.log(
            `Source backup: ${manifest.sourceDatabase} (${manifest.createdAt})`
        );
        console.log(
            `Rows: users=${counts.users}, complaints=${counts.complaints}, chats=${counts.chats}, admins=${row.admins}`
        );
        console.log(
            "Legacy IDs, ownership references, chat participants and representative records match the backup."
        );

        return counts;
    } finally {
        await closeDatabase(database);
    }
}

function argumentValue(name) {
    const prefix = `--${name}=`;
    const argument = process.argv.find((value) =>
        value.startsWith(prefix)
    );

    return argument ? argument.slice(prefix.length) : undefined;
}

if (require.main === module) {
    const backupDir =
        argumentValue("backup") || process.env.BACKUP_DIR;

    verifyMigration({ backupDir }).catch((error) => {
        console.error(
            `Migration verification failed: ${error.message || "unknown error"}`
        );
        process.exitCode = 1;
    });
}

module.exports = {
    verifyMigration
};
