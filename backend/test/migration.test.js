const {
    test,
    before,
    after
} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const bcrypt = require("bcryptjs");
const { EJSON } = require("bson");
const { ObjectId } = require("mongodb");

const { startTestDatabase } = require("./helpers/postgres");

let testDatabase;
let backupDir;
let source;
let database;

function writeCollection(dir, name, documents) {
    const contents = documents
        .map((document) =>
            EJSON.stringify(document, { relaxed: false })
        )
        .join("\n")
        .concat(documents.length ? "\n" : "");
    const file = `${name}.jsonl`;

    fs.writeFileSync(path.join(dir, file), contents, "utf8");

    return {
        name,
        file,
        count: documents.length,
        sha256: crypto
            .createHash("sha256")
            .update(Buffer.from(contents, "utf8"))
            .digest("hex")
    };
}

function createFixtureBackup() {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "campusfix-backup-")
    );

    const studentId = new ObjectId();
    const adminId = new ObjectId();
    const complaintId = new ObjectId();
    const chatId = new ObjectId();
    const createdAt = new Date("2024-03-01T10:00:00.000Z");
    const updatedAt = new Date("2024-03-02T11:30:00.000Z");

    const users = [
        {
            _id: studentId,
            name: "Legacy Student",
            email: "legacy.student@example.com",
            password: bcrypt.hashSync("LegacyPass123!", 10),
            role: "student",
            createdAt,
            updatedAt,
            __v: 0
        },
        {
            _id: adminId,
            name: "Legacy Admin",
            email: "legacy.admin@example.com",
            password: bcrypt.hashSync("LegacyAdmin123!", 10),
            role: "admin",
            createdAt,
            updatedAt,
            __v: 0
        }
    ];

    const complaints = [
        {
            _id: complaintId,
            title: "Legacy broken light",
            category: "Electricity",
            description: "Corridor light is broken.",
            location: "Block B",
            priority: "High",
            status: "In Progress",
            createdBy: studentId,
            createdAt,
            updatedAt,
            __v: 0
        }
    ];

    const chats = [
        {
            _id: chatId,
            sender: studentId,
            receiver: adminId,
            message: "Please check the corridor light.",
            isAI: false,
            createdAt,
            updatedAt,
            __v: 0
        }
    ];

    const collections = [
        writeCollection(dir, "users", users),
        writeCollection(dir, "complaints", complaints),
        writeCollection(dir, "chats", chats)
    ];

    fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify(
            {
                format: "campusfix-mongo-backup",
                version: 1,
                createdAt: "2024-03-03T00:00:00.000Z",
                sourceDatabase: "campusfix_test_source",
                note: "Test fixture only",
                collections
            },
            null,
            2
        )
    );

    return {
        dir,
        studentId,
        adminId,
        complaintId,
        chatId,
        complaintCreatedAt: createdAt
    };
}

before(async () => {
    testDatabase = await startTestDatabase();
    const { createDatabase } = require("../db/client");

    database = createDatabase({
        connectionString: testDatabase.connectionString
    });

    const fixture = createFixtureBackup();
    backupDir = fixture.dir;
    source = fixture;
});

after(async () => {
    const { closeDatabase } = require("../db/client");

    if (database) {
        await closeDatabase(database);
    }

    if (testDatabase) {
        await testDatabase.stop();
    }

    if (backupDir) {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
});

test("schema applies enums, uniqueness and triggers", async () => {
    const migrations = await database.pool.query(
        "SELECT name FROM schema_migrations ORDER BY name"
    );

    assert.equal(migrations.rowCount, 3);
    assert.deepEqual(
        migrations.rows.map((row) => row.name),
        [
            "001_initial.sql",
            "002_core_workflow.sql",
            "003_campus_services.sql"
        ]
    );

    const statuses = await database.pool.query(
        "SELECT enum_range(NULL::complaint_status) AS values"
    );

    assert.match(statuses.rows[0].values, /Reopened/);
    assert.match(statuses.rows[0].values, /Assigned/);

    const priorities = await database.pool.query(
        "SELECT enum_range(NULL::complaint_priority) AS values"
    );

    assert.match(priorities.rows[0].values, /Critical/);

    const anonymousColumn = await database.pool.query(
        `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'complaints' AND column_name = 'is_anonymous'`
    );

    assert.equal(anonymousColumn.rowCount, 1);
    assert.equal(anonymousColumn.rows[0].data_type, "boolean");
    assert.equal(anonymousColumn.rows[0].is_nullable, "NO");
    assert.match(anonymousColumn.rows[0].column_default, /false/);

    const facilitySeed = await database.pool.query(
        "SELECT count(*)::int AS count FROM facilities"
    );

    assert.equal(facilitySeed.rows[0].count, 6);

    const bookingStatuses = await database.pool.query(
        "SELECT enum_range(NULL::booking_status) AS values"
    );

    assert.match(bookingStatuses.rows[0].values, /Approved/);

    const serviceTables = await database.pool.query(
        `SELECT count(*)::int AS count
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (
               'complaint_attachments',
               'complaint_upvotes',
               'facilities',
               'facility_bookings',
               'lost_found_items',
               'inventory_items',
               'inventory_transactions',
               'maintenance_tasks',
               'maintenance_logs'
           )`
    );

    assert.equal(serviceTables.rows[0].count, 9);

    await database.pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Schema User', 'schema@example.com', $1, 'student')`,
        [bcrypt.hashSync("SchemaPass123!", 10)]
    );

    await assert.rejects(
        database.pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Duplicate', 'schema@example.com', $1, 'student')`,
            [bcrypt.hashSync("SchemaPass123!", 10)]
        ),
        (error) => error.code === "23505"
    );

    await assert.rejects(
        database.pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Uppercase', 'UPPER@example.com', $1, 'student')`,
            [bcrypt.hashSync("SchemaPass123!", 10)]
        ),
        (error) => error.code === "23514"
    );

    await assert.rejects(
        database.pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Researcher', 'researcher@example.com', $1, 'researcher')`,
            [bcrypt.hashSync("SchemaPass123!", 10)]
        ),
        (error) => error.code === "22P02"
    );

    const trigger = await database.pool.query(
        `UPDATE users
         SET name = 'Schema User Updated'
         WHERE email = 'schema@example.com'
         RETURNING updated_at > created_at AS touched`
    );

    assert.equal(trigger.rows[0].touched, true);

    await database.pool.query(
        "DELETE FROM users WHERE email = 'schema@example.com'"
    );
});

test("MongoDB backup imports transactionally with verified records", async () => {
    const {
        importMongoBackup,
        loadBackupData
    } = require("../scripts/import-mongo-backup");

    const { data } = await loadBackupData(backupDir);

    assert.equal(data.errors.length, 0);
    assert.equal(data.warnings.length, 0);

    const counts = await importMongoBackup({
        backupDir,
        connectionString: testDatabase.connectionString
    });

    assert.deepEqual(counts, {
        users: 2,
        complaints: 1,
        chats: 1
    });

    const importedUsers = await database.pool.query(
        `SELECT name, email, role, password_hash, legacy_mongo_id
         FROM users
         ORDER BY email`
    );

    assert.equal(importedUsers.rowCount, 2);
    const admin = importedUsers.rows.find(
        (row) => row.role === "admin"
    );
    assert.equal(admin.email, "legacy.admin@example.com");
    assert.match(admin.password_hash, /^\$2[aby]\$/);
    assert.equal(
        bcrypt.compareSync("LegacyAdmin123!", admin.password_hash),
        true
    );
    assert.equal(admin.legacy_mongo_id, source.adminId.toHexString());

    const importedComplaint = await database.pool.query(
        `SELECT c.title, c.status, c.priority, c.created_at,
                c.legacy_mongo_id, u.email AS owner_email
         FROM complaints c
         JOIN users u ON u.id = c.created_by
         WHERE c.legacy_mongo_id = $1`,
        [source.complaintId.toHexString()]
    );

    assert.equal(importedComplaint.rowCount, 1);
    assert.equal(
        importedComplaint.rows[0].title,
        "Legacy broken light"
    );
    assert.equal(importedComplaint.rows[0].status, "In Progress");
    assert.equal(importedComplaint.rows[0].priority, "High");
    assert.equal(
        importedComplaint.rows[0].owner_email,
        "legacy.student@example.com"
    );
    assert.equal(
        importedComplaint.rows[0].created_at.toISOString(),
        source.complaintCreatedAt.toISOString()
    );

    const importedChat = await database.pool.query(
        `SELECT message, is_ai, legacy_mongo_id FROM chats`
    );

    assert.equal(importedChat.rowCount, 1);
    assert.equal(
        importedChat.rows[0].legacy_mongo_id,
        source.chatId.toHexString()
    );
    assert.equal(importedChat.rows[0].is_ai, false);

    const {
        verifyMigration
    } = require("../scripts/verify-migration");

    const verified = await verifyMigration({
        backupDir,
        connectionString: testDatabase.connectionString
    });

    assert.deepEqual(verified, {
        users: 2,
        complaints: 1,
        chats: 1
    });
});

test("import refuses to overwrite an existing database", async () => {
    const {
        importMongoBackup
    } = require("../scripts/import-mongo-backup");

    await assert.rejects(
        importMongoBackup({
            backupDir,
            connectionString: testDatabase.connectionString
        }),
        /already contains CampusFix data/
    );
});

test("backup verification detects tampering", async () => {
    const {
        verifyBackupDirectory
    } = require("../scripts/mongo-backup");

    const tampered = fs.mkdtempSync(
        path.join(os.tmpdir(), "campusfix-tampered-")
    );

    try {
        fs.cpSync(backupDir, tampered, { recursive: true });
        fs.appendFileSync(
            path.join(tampered, "users.jsonl"),
            "{}\n",
            "utf8"
        );

        await assert.rejects(
            verifyBackupDirectory(tampered),
            /Backup verification failed/
        );
    } finally {
        fs.rmSync(tampered, {
            recursive: true,
            force: true
        });
    }
});
