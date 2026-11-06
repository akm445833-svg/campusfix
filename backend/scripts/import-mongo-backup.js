#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const { EJSON } = require("bson");
const { sql } = require("drizzle-orm");
const {
    createDatabase,
    closeDatabase,
    checkDatabase
} = require("../db/client");
const {
    users,
    complaints,
    complaintHistory,
    chats
} = require("../db/schema");
const { verifyBackupDirectory } = require("./mongo-backup");

const REQUIRED_COLLECTIONS = {
    users: "users",
    complaints: "complaints",
    chats: "chats"
};

function legacyId(value) {
    if (!value) {
        return null;
    }

    return typeof value === "string"
        ? value
        : value.toHexString
          ? value.toHexString()
          : String(value);
}

function dateOr(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseEmail(value) {
    return typeof value === "string"
        ? value.trim().toLowerCase()
        : "";
}

function readLines(contents) {
    return contents
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => EJSON.parse(line, { relaxed: false }));
}

async function loadCollection(backupDir, manifest, name) {
    const entry = manifest.collections.find(
        (collection) => collection.name === name
    );

    if (!entry) {
        return [];
    }

    const contents = await fs.readFile(
        path.join(backupDir, entry.file),
        "utf8"
    );

    return readLines(contents);
}

function issue(collection, index, message) {
    return `${collection}[${index}]: ${message}`;
}

function normaliseSourceData(raw) {
    const errors = [];
    const warnings = [];
    const usersByLegacyId = new Map();
    const emails = new Set();
    const sourceUserIds = new Set();

    const normalisedUsers = raw.users.map((document, index) => {
        const id = legacyId(document._id);
        const email = normaliseEmail(document.email);
        const name =
            typeof document.name === "string"
                ? document.name.trim()
                : "";
        const password =
            typeof document.password === "string"
                ? document.password.trim()
                : "";
        const role = document.role || "student";
        const createdAt = dateOr(document.createdAt);
        const updatedAt = dateOr(document.updatedAt);

        if (!id) {
            errors.push(issue("users", index, "missing _id"));
        }

        if (!name || name.length > 120) {
            errors.push(
                issue("users", index, "invalid name")
            );
        }

        if (
            !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
            email.length > 320
        ) {
            errors.push(
                issue("users", index, "invalid email address")
            );
        }

        if (!["student", "admin"].includes(role)) {
            errors.push(
                issue("users", index, "invalid user role")
            );
        }

        if (
            password.length < 20 ||
            password.length > 255
        ) {
            errors.push(
                issue("users", index, "invalid password hash")
            );
        }

        if (!/^\$2[aby]\$\d{2}\$/.test(password)) {
            warnings.push(
                issue(
                    "users",
                    index,
                    "password hash is not a recognised bcrypt hash"
                )
            );
        }

        if (!createdAt) {
            errors.push(
                issue("users", index, "invalid createdAt timestamp")
            );
        }

        if (emails.has(email)) {
            errors.push(
                issue("users", index, "duplicate email address")
            );
        }

        emails.add(email);

        if (id) {
            if (usersByLegacyId.has(id)) {
                errors.push(
                    issue("users", index, "duplicate legacy _id")
                );
            }

            usersByLegacyId.set(id, {
                legacyMongoId: id,
                name,
                email,
                passwordHash: password,
                role,
                createdAt,
                updatedAt: updatedAt || createdAt,
                sourceIndex: index
            });
            sourceUserIds.add(id);
        }

        return null;
    });

    const normalisedComplaints = raw.complaints.map(
        (document, index) => {
            const id = legacyId(document._id);
            const ownerId = legacyId(document.createdBy);
            const priority = document.priority || "Medium";
            const status = document.status || "Pending";
            const createdAt = dateOr(document.createdAt);
            const updatedAt = dateOr(document.updatedAt);
            const title =
                typeof document.title === "string"
                    ? document.title.trim()
                    : "";
            const category =
                typeof document.category === "string"
                    ? document.category.trim()
                    : "";
            const description =
                typeof document.description === "string"
                    ? document.description.trim()
                    : "";
            const location =
                typeof document.location === "string"
                    ? document.location.trim()
                    : "";

            if (!id) {
                errors.push(
                    issue("complaints", index, "missing _id")
                );
            }

            if (!sourceUserIds.has(ownerId)) {
                errors.push(
                    issue(
                        "complaints",
                        index,
                        "createdBy does not reference a source user"
                    )
                );
            }

            if (!title || title.length > 200) {
                errors.push(
                    issue("complaints", index, "invalid title")
                );
            }

            if (!category || category.length > 100) {
                errors.push(
                    issue("complaints", index, "invalid category")
                );
            }

            if (
                !description ||
                description.length > 20000
            ) {
                errors.push(
                    issue(
                        "complaints",
                        index,
                        "invalid description"
                    )
                );
            }

            if (!location || location.length > 500) {
                errors.push(
                    issue("complaints", index, "invalid location")
                );
            }

            if (
                ![
                    "Low",
                    "Medium",
                    "High",
                    "Critical"
                ].includes(priority)
            ) {
                errors.push(
                    issue("complaints", index, "invalid priority")
                );
            }

            if (
                ![
                    "Pending",
                    "Assigned",
                    "In Progress",
                    "Resolved",
                    "Reopened",
                    "Rejected"
                ].includes(status)
            ) {
                errors.push(
                    issue("complaints", index, "invalid status")
                );
            }

            if (!createdAt) {
                errors.push(
                    issue(
                        "complaints",
                        index,
                        "invalid createdAt timestamp"
                    )
                );
            }

            return {
                legacyMongoId: id,
                ownerLegacyId: ownerId,
                title,
                category,
                description,
                location,
                priority,
                status,
                createdAt,
                updatedAt: updatedAt || createdAt
            };
        }
    );

    const normalisedChats = raw.chats.map((document, index) => {
        const id = legacyId(document._id);
        const senderId = legacyId(document.sender);
        const receiverId = legacyId(document.receiver);
        const message =
            typeof document.message === "string"
                ? document.message.trim()
                : "";
        const createdAt = dateOr(document.createdAt);
        const updatedAt = dateOr(document.updatedAt);

        if (!id) {
            errors.push(issue("chats", index, "missing _id"));
        }

        if (!sourceUserIds.has(senderId)) {
            errors.push(
                issue(
                    "chats",
                    index,
                    "sender does not reference a source user"
                )
            );
        }

        if (!sourceUserIds.has(receiverId)) {
            errors.push(
                issue(
                    "chats",
                    index,
                    "receiver does not reference a source user"
                )
            );
        }

        if (!message || message.length > 10000) {
            errors.push(
                issue("chats", index, "invalid message")
            );
        }

        if (!createdAt) {
            errors.push(
                issue(
                    "chats",
                    index,
                    "invalid createdAt timestamp"
                )
            );
        }

        return {
            legacyMongoId: id,
            senderLegacyId: senderId,
            receiverLegacyId: receiverId,
            message,
            isAI: Boolean(document.isAI),
            createdAt,
            updatedAt: updatedAt || createdAt
        };
    });

    return {
        users: normalisedUsers.length
            ? Array.from(usersByLegacyId.values())
            : [],
        complaints: normalisedComplaints,
        chats: normalisedChats,
        errors,
        warnings,
        sourceCounts: {
            users: raw.users.length,
            complaints: raw.complaints.length,
            chats: raw.chats.length
        }
    };
}

function digestRows(rows) {
    const contents = rows
        .map((row) => JSON.stringify(row))
        .sort()
        .join("\n");

    return crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex");
}

async function verifyImportedData(db, data) {
    const userCount = await db
        .select({ count: sql`count(*)` })
        .from(users);
    const complaintCount = await db
        .select({ count: sql`count(*)` })
        .from(complaints);
    const chatCount = await db
        .select({ count: sql`count(*)` })
        .from(chats);

    const counts = {
        users: Number(userCount[0].count),
        complaints: Number(complaintCount[0].count),
        chats: Number(chatCount[0].count)
    };

    for (const [table, expected] of Object.entries(
        data.sourceCounts
    )) {
        if (counts[table] !== expected) {
            throw new Error(
                `Count verification failed for ${table}: expected ${expected}, found ${counts[table]}`
            );
        }
    }

    const targetUsers = await db.select().from(users);
    const targetComplaints = await db
        .select()
        .from(complaints);
    const targetChats = await db.select().from(chats);

    const sourceDigest = digestRows([
        ...data.users.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            name: row.name,
            email: row.email,
            role: row.role
        })),
        ...data.complaints.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            title: row.title,
            priority: row.priority,
            status: row.status
        })),
        ...data.chats.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            message: row.message,
            isAI: row.isAI
        }))
    ]);

    const targetDigest = digestRows([
        ...targetUsers.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            name: row.name,
            email: row.email,
            role: row.role
        })),
        ...targetComplaints.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            title: row.title,
            priority: row.priority,
            status: row.status
        })),
        ...targetChats.map((row) => ({
            legacyMongoId: row.legacyMongoId,
            message: row.message,
            isAI: row.isAI
        }))
    ]);

    if (sourceDigest !== targetDigest) {
        throw new Error(
            "Representative-record checksum verification failed"
        );
    }

    return counts;
}

async function loadBackupData(backupDir) {
    if (!backupDir) {
        throw new Error(
            "BACKUP_DIR is required. Pass the completed mongo-* backup directory."
        );
    }

    const manifest = await verifyBackupDirectory(backupDir);
    const raw = {};

    for (const [key, collectionName] of Object.entries(
        REQUIRED_COLLECTIONS
    )) {
        raw[key] = await loadCollection(
            backupDir,
            manifest,
            collectionName
        );
    }

    return {
        manifest,
        data: normaliseSourceData(raw)
    };
}

async function importMongoBackup(options = {}) {
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
            "DIRECT_URL or DATABASE_URL is required to import into PostgreSQL"
        );
    }

    const { data } = await loadBackupData(backupDir);

    if (data.warnings.length > 0) {
        console.warn(
            `${data.warnings.length} password hash warning(s) found; review before allowing those accounts to log in.`
        );
    }

    if (data.errors.length > 0) {
        throw new Error(
            `Source validation failed with ${data.errors.length} error(s):\n${data.errors
                .slice(0, 20)
                .join("\n")}`
        );
    }

    const database = createDatabase({
        connectionString,
        env: process.env
    });

    try {
        await checkDatabase(database);

        const existing = await database.pool.query(`
            SELECT
                (SELECT count(*) FROM users)::int AS users,
                (SELECT count(*) FROM complaints)::int AS complaints,
                (SELECT count(*) FROM chats)::int AS chats
        `);

        const rows = existing.rows[0];

        if (
            rows.users > 0 ||
            rows.complaints > 0 ||
            rows.chats > 0
        ) {
            throw new Error(
                "Target database already contains CampusFix data. Refusing to overwrite it."
            );
        }

        const counts = await database.db.transaction(
            async (tx) => {
                const userRows =
                    data.users.length > 0
                        ? await tx
                              .insert(users)
                              .values(
                                  data.users.map((user) => ({
                                      legacyMongoId:
                                          user.legacyMongoId,
                                      name: user.name,
                                      email: user.email,
                                      passwordHash:
                                          user.passwordHash,
                                      role: user.role,
                                      createdAt: user.createdAt,
                                      updatedAt: user.updatedAt
                                  }))
                              )
                              .returning({
                                  id: users.id,
                                  legacyMongoId:
                                      users.legacyMongoId
                              })
                        : [];

                const userIds = new Map(
                    userRows.map((user) => [
                        user.legacyMongoId,
                        user.id
                    ])
                );

                if (data.complaints.length > 0) {
                    const complaintRows = await tx
                        .insert(complaints)
                        .values(
                            data.complaints.map((complaint) => ({
                                legacyMongoId:
                                    complaint.legacyMongoId,
                                title: complaint.title,
                                category: complaint.category,
                                description:
                                    complaint.description,
                                location: complaint.location,
                                priority: complaint.priority,
                                status: complaint.status,
                                createdBy: userIds.get(
                                    complaint.ownerLegacyId
                                ),
                                createdAt: complaint.createdAt,
                                updatedAt: complaint.updatedAt
                            }))
                        )
                        .returning({
                            id: complaints.id,
                            status: complaints.status,
                            createdBy: complaints.createdBy,
                            createdAt: complaints.createdAt
                        });

                    const historyRows = [];

                    for (const row of complaintRows) {
                        historyRows.push({
                            complaintId: row.id,
                            actorId: row.createdBy,
                            eventType: "created",
                            message:
                                "Complaint imported from the legacy MongoDB backup.",
                            createdAt: row.createdAt
                        });

                        if (row.status !== "Pending") {
                            historyRows.push({
                                complaintId: row.id,
                                actorId: row.createdBy,
                                eventType: "status_imported",
                                toStatus: row.status,
                                message:
                                    "Current status preserved from the legacy record.",
                                createdAt: row.createdAt
                            });
                        }
                    }

                    await tx
                        .insert(complaintHistory)
                        .values(historyRows);
                }

                if (data.chats.length > 0) {
                    await tx.insert(chats).values(
                        data.chats.map((chat) => ({
                            legacyMongoId: chat.legacyMongoId,
                            senderId: userIds.get(
                                chat.senderLegacyId
                            ),
                            receiverId: userIds.get(
                                chat.receiverLegacyId
                            ),
                            message: chat.message,
                            isAI: chat.isAI,
                            createdAt: chat.createdAt,
                            updatedAt: chat.updatedAt
                        }))
                    );
                }

                return verifyImportedData(tx, data);
            }
        );

        console.log(
            `Import verified: users=${counts.users}, complaints=${counts.complaints}, chats=${counts.chats}.`
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

    importMongoBackup({ backupDir }).catch((error) => {
        console.error(
            `PostgreSQL import failed: ${error.message || "unknown error"}`
        );
        process.exitCode = 1;
    });
}

module.exports = {
    importMongoBackup,
    loadBackupData,
    normaliseSourceData,
    verifyImportedData
};
