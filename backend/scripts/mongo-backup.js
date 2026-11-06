#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const { EJSON } = require("bson");
const { MongoClient } = require("mongodb");

const BACKUP_FORMAT = "campusfix-mongo-backup";
const BACKUP_VERSION = 1;
const MAX_COLLECTIONS = 200;

function safeFileName(name) {
    return String(name)
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 150);
}

function sha256(contents) {
    return crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex");
}

async function fileDigest(filePath) {
    const contents = await fs.readFile(filePath);
    const lineCount = contents
        .toString("utf8")
        .split("\n")
        .filter(Boolean).length;

    return {
        sha256: sha256(contents),
        lineCount,
        bytes: contents.byteLength
    };
}

async function verifyBackupDirectory(backupDir) {
    const rawManifest = await fs.readFile(
        path.join(backupDir, "manifest.json"),
        "utf8"
    );
    const manifest = JSON.parse(rawManifest);

    if (
        manifest.format !== BACKUP_FORMAT ||
        manifest.version !== BACKUP_VERSION
    ) {
        throw new Error("Unsupported backup format");
    }

    if (
        !Array.isArray(manifest.collections) ||
        manifest.collections.length > MAX_COLLECTIONS
    ) {
        throw new Error("Backup manifest is invalid");
    }

    for (const collection of manifest.collections) {
        if (
            !collection ||
            typeof collection.file !== "string" ||
            !/^[A-Za-z0-9._-]+\.jsonl$/.test(collection.file)
        ) {
            throw new Error("Backup manifest contains an unsafe filename");
        }

        const details = await fileDigest(
            path.join(backupDir, collection.file)
        );

        if (
            details.sha256 !== collection.sha256 ||
            details.lineCount !== collection.count
        ) {
            throw new Error(
                `Backup verification failed for ${collection.file}`
            );
        }
    }

    return manifest;
}

async function createMongoBackup(options = {}) {
    const mongoUri = options.mongoUri || process.env.MONGO_URI;
    const backupRoot =
        options.backupRoot ||
        process.env.BACKUP_DIR ||
        path.resolve(__dirname, "..", "..", "backups");

    if (!mongoUri) {
        throw new Error(
            "MONGO_URI is not configured. Set it locally to a read-only MongoDB account before creating a backup."
        );
    }

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");
    const backupDir = path.join(
        backupRoot,
        `mongo-${timestamp}`
    );
    const partialDir = `${backupDir}.partial`;

    await fs.mkdir(partialDir, { recursive: true });

    const client = new MongoClient(mongoUri, {
        appName: "campusfix-migration-backup",
        serverSelectionTimeoutMS: 10000
    });

    let db;

    try {
        await client.connect();
        db = client.db(process.env.MONGODB_DB || undefined);

        const collections = await db
            .listCollections({}, { nameOnly: true })
            .toArray();

        if (collections.length > MAX_COLLECTIONS) {
            throw new Error(
                `Source database has more than ${MAX_COLLECTIONS} collections; refusing an unbounded export`
            );
        }

        const manifestCollections = [];

        for (const { name } of collections.sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            const fileName = `${safeFileName(name)}.jsonl`;
            const filePath = path.join(partialDir, fileName);
            const handle = await fs.open(filePath, "w");
            const hash = crypto.createHash("sha256");
            let count = 0;

            try {
                const cursor = db.collection(name).find({});

                for await (const document of cursor) {
                    const line = `${EJSON.stringify(document, {
                        relaxed: false
                    })}\n`;
                    hash.update(line);
                    await handle.write(line);
                    count += 1;
                }
            } finally {
                await handle.close();
            }

            manifestCollections.push({
                name,
                file: fileName,
                count,
                sha256: hash.digest("hex")
            });

            console.log(
                `Exported ${count} document(s) from collection ${name}`
            );
        }

        const manifest = {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            sourceDatabase: db.databaseName,
            note: "Read-only export. The source MongoDB data was not modified.",
            collections: manifestCollections
        };

        await fs.writeFile(
            path.join(partialDir, "manifest.json"),
            `${JSON.stringify(manifest, null, 2)}\n`,
            "utf8"
        );

        await verifyBackupDirectory(partialDir);
        await fs.rename(partialDir, backupDir);

        console.log(`Backup complete: ${backupDir}`);
        console.log(
            `Collections: ${manifestCollections.length}; documents: ${manifestCollections.reduce(
                (total, item) => total + item.count,
                0
            )}`
        );

        return {
            backupDir,
            manifest
        };
    } catch (error) {
        await fs.rm(partialDir, {
            recursive: true,
            force: true
        });
        throw error;
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    createMongoBackup().catch((error) => {
        console.error(
            `MongoDB backup failed: ${error.message || "unknown error"}`
        );
        process.exitCode = 1;
    });
}

module.exports = {
    BACKUP_FORMAT,
    BACKUP_VERSION,
    createMongoBackup,
    verifyBackupDirectory
};
