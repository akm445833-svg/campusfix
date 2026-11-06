const {
    test,
    before,
    after
} = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { startTestDatabase } = require("./helpers/postgres");

const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let testDatabase;
let database;
let app;
let adminAgent;
let managerAgent;
let staffAgent;
let studentAgent;
let otherStudentAgent;
let managerId;
let staffId;
let student;
let facilityId;
let anonymousComplaintId;
let bookingId;
let inventoryItemId;
let maintenanceTaskId;

async function login(email, password) {
    const agent = request.agent(app);

    await agent
        .post("/api/login")
        .send({ email, password })
        .expect(200);

    return agent;
}

async function registerAndLogin(agent, suffix) {
    const email = `${suffix}@example.com`;
    const password = "StudentPass123!";

    await agent
        .post("/api/register")
        .send({
            name: `User ${suffix}`,
            email,
            password
        })
        .expect(201);

    await agent
        .post("/api/login")
        .send({ email, password })
        .expect(200);

    const me = await agent.get("/api/me").expect(200);

    return { ...me.body.user, email, password };
}

before(async () => {
    testDatabase = await startTestDatabase();

    const { loadConfig } = require("../config");
    const { createDatabase } = require("../db/client");
    const { createApp } = require("../app");

    database = createDatabase({
        connectionString: testDatabase.connectionString
    });

    app = createApp({
        config: loadConfig(),
        database
    });

    const departmentRows = await database.pool.query(
        "SELECT id, code FROM departments"
    );
    const departmentIds = {};

    for (const row of departmentRows.rows) {
        departmentIds[row.code] = row.id;
    }

    const hash = bcrypt.hashSync("StaffPass123!", 10);
    const staffRows = await database.pool.query(
        `INSERT INTO users
            (name, email, password_hash, role, department_id)
         VALUES
            ($1, $2, $3, 'admin', NULL),
            ($4, $5, $3, 'department_manager', $6),
            ($7, $8, $3, 'staff', $6)
         RETURNING id, email, role`,
        [
            "Service Admin",
            "services.admin@example.com",
            hash,
            "IT Manager",
            "services.manager@example.com",
            departmentIds.IT,
            "IT Staff",
            "services.staff@example.com"
        ]
    );

    managerId = staffRows.rows.find(
        (row) => row.role === "department_manager"
    ).id;
    staffId = staffRows.rows.find(
        (row) => row.role === "staff"
    ).id;

    adminAgent = await login(
        "services.admin@example.com",
        "StaffPass123!"
    );
    managerAgent = await login(
        "services.manager@example.com",
        "StaffPass123!"
    );
    staffAgent = await login(
        "services.staff@example.com",
        "StaffPass123!"
    );

    studentAgent = request.agent(app);
    student = await registerAndLogin(
        studentAgent,
        "services-student"
    );
    otherStudentAgent = request.agent(app);
    await registerAndLogin(
        otherStudentAgent,
        "services-other"
    );

    const facilityRows = await database.pool.query(
        "SELECT id FROM facilities WHERE code = 'COMPUTER_LAB'"
    );
    facilityId = facilityRows.rows[0].id;
});

after(async () => {
    const { closeDatabase } = require("../db/client");

    if (database) {
        await closeDatabase(database);
    }

    if (testDatabase) {
        await testDatabase.stop();
    }
});

test("anonymous complaints hide the reporter and support photos and upvotes", async () => {
    const created = await studentAgent
        .post("/api/complaints")
        .send({
            title: "Anonymous projector fault",
            category: "Wi-Fi/IT",
            description:
                "The projector in Lab 1 shuts down after ten minutes.",
            location: "IT Block, Computer Lab 1",
            priority: "High",
            anonymous: true
        })
        .expect(201);

    anonymousComplaintId = created.body.complaint.id;

    assert.equal(created.body.complaint.isAnonymous, true);
    assert.equal(created.body.complaint.createdBy.name, student.name);

    const managerView = await managerAgent
        .get(`/api/complaints/details/${anonymousComplaintId}`)
        .expect(200);

    assert.equal(managerView.body.complaint.createdBy.name, "Anonymous");
    assert.equal(managerView.body.complaint.createdBy.id, null);
    assert.equal(
        managerView.body.history[0].actorName,
        "Anonymous"
    );
    assert.equal(
        managerView.body.permissions.canUploadPhoto,
        true
    );

    const searchLeak = await managerAgent
        .get(
            `/api/admin/complaints?search=${encodeURIComponent(student.name)}`
        )
        .expect(200);

    assert.equal(searchLeak.body.pagination.total, 0);

    const upload = await studentAgent
        .post(`/api/complaints/${anonymousComplaintId}/attachments`)
        .send({
            fileName: "projector.png",
            contentType: "image/png",
            dataBase64: PNG_BASE64
        })
        .expect(201);

    const attachmentId = upload.body.attachment.id;
    const image = await managerAgent
        .get(
            `/api/complaints/${anonymousComplaintId}/attachments/${attachmentId}`
        )
        .expect(200);

    assert.equal(image.headers["content-type"], "image/png");
    assert.equal(image.body.length, 68);

    await otherStudentAgent
        .get(
            `/api/complaints/${anonymousComplaintId}/attachments/${attachmentId}`
        )
        .expect(403);

    const invalidImage = await studentAgent
        .post(`/api/complaints/${anonymousComplaintId}/attachments`)
        .send({
            fileName: "fake.png",
            contentType: "image/png",
            dataBase64: Buffer.from("not a real image").toString(
                "base64"
            )
        })
        .expect(400);

    assert.match(invalidImage.body.message, /JPEG|PNG|WebP/);

    const upvote = await managerAgent
        .post(`/api/complaints/${anonymousComplaintId}/upvote`)
        .expect(200);

    assert.equal(upvote.body.upvotes.count, 1);
    assert.equal(upvote.body.upvotes.hasUpvoted, true);

    const details = await studentAgent
        .get(`/api/complaints/details/${anonymousComplaintId}`)
        .expect(200);

    assert.equal(details.body.complaint.upvoteCount, 1);
    assert.equal(details.body.attachments.length, 1);

    const removed = await managerAgent
        .post(`/api/complaints/${anonymousComplaintId}/upvote`)
        .expect(200);

    assert.equal(removed.body.upvotes.count, 0);
    assert.equal(removed.body.upvotes.hasUpvoted, false);
});

test("facility bookings enforce capacity, overlap and review permissions", async () => {
    const facilities = await studentAgent
        .get("/api/facilities")
        .expect(200);

    assert.equal(facilities.body.facilities.length, 6);

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const tooMany = await studentAgent
        .post("/api/facilities/bookings")
        .send({
            facilityId,
            title: "Oversized workshop",
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            attendees: 500
        })
        .expect(400);

    assert.match(tooMany.body.message, /at most/);

    const created = await studentAgent
        .post("/api/facilities/bookings")
        .send({
            facilityId,
            title: "Robotics workshop",
            purpose: "Department workshop for second-year students.",
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            attendees: 30
        })
        .expect(201);

    bookingId = created.body.booking.id;
    assert.equal(created.body.booking.status, "Pending");

    const overlap = await otherStudentAgent
        .post("/api/facilities/bookings")
        .send({
            facilityId,
            title: "Overlapping seminar",
            startsAt: new Date(
                start.getTime() + 60 * 60 * 1000
            ).toISOString(),
            endsAt: new Date(
                end.getTime() + 60 * 60 * 1000
            ).toISOString(),
            attendees: 10
        })
        .expect(409);

    assert.match(overlap.body.message, /already/);

    await staffAgent
        .patch(`/api/facilities/bookings/${bookingId}/review`)
        .send({ status: "Approved" })
        .expect(403);

    const approved = await managerAgent
        .patch(`/api/facilities/bookings/${bookingId}/review`)
        .send({ status: "Approved" })
        .expect(200);

    assert.equal(approved.body.booking.status, "Approved");
    assert.equal(approved.body.booking.reviewedBy, "IT Manager");

    const mine = await studentAgent
        .get("/api/facilities/bookings/mine")
        .expect(200);

    assert.equal(mine.body.bookings.length, 1);
    assert.equal(mine.body.bookings[0].status, "Approved");

    const queue = await managerAgent
        .get("/api/facilities/bookings?status=Approved")
        .expect(200);

    assert.equal(queue.body.bookings.length, 1);

    await studentAgent
        .post(`/api/facilities/bookings/${bookingId}/cancel`)
        .expect(200);

    const cancelled = await studentAgent
        .get("/api/facilities/bookings/mine")
        .expect(200);

    assert.equal(cancelled.body.bookings[0].status, "Cancelled");
});

test("lost and found is shared, scoped and auditable", async () => {
    const reported = await studentAgent
        .post("/api/lost-found")
        .send({
            type: "found",
            title: "Blue water bottle",
            description:
                "Found a blue steel bottle near the library entrance.",
            category: "Personal items",
            location: "Central Library entrance",
            contact: "student@example.com"
        })
        .expect(201);

    const itemId = reported.body.item.id;
    assert.equal(reported.body.item.status, "open");

    const shared = await otherStudentAgent
        .get("/api/lost-found?type=found&status=open")
        .expect(200);

    assert.ok(
        shared.body.items.some((item) => item.id === itemId)
    );

    await otherStudentAgent
        .patch(`/api/lost-found/${itemId}/status`)
        .send({ status: "claimed" })
        .expect(403);

    const claimed = await studentAgent
        .patch(`/api/lost-found/${itemId}/status`)
        .send({ status: "claimed" })
        .expect(200);

    assert.equal(claimed.body.item.status, "claimed");

    await otherStudentAgent
        .delete(`/api/lost-found/${itemId}`)
        .expect(403);

    await adminAgent.delete(`/api/lost-found/${itemId}`).expect(200);

    const remaining = await studentAgent
        .get("/api/lost-found")
        .expect(200);

    assert.equal(
        remaining.body.items.some((item) => item.id === itemId),
        false
    );
});

test("inventory tracks stock transactions and department scope", async () => {
    await studentAgent.get("/api/operations/inventory").expect(403);

    const created = await managerAgent
        .post("/api/operations/inventory")
        .send({
            sku: "hdmi-2m",
            name: "HDMI cable 2m",
            category: "AV accessories",
            location: "IT store room",
            quantity: 5,
            unit: "pieces",
            reorderLevel: 2,
            unitCost: 250
        })
        .expect(201);

    inventoryItemId = created.body.item.id;
    assert.equal(created.body.item.sku, "HDMI-2M");
    assert.equal(created.body.item.quantity, 5);

    const adjusted = await staffAgent
        .post(
            `/api/operations/inventory/${inventoryItemId}/adjust`
        )
        .send({
            delta: -3,
            reason: "issue",
            note: "Issued for a classroom repair."
        })
        .expect(200);

    assert.equal(adjusted.body.item.quantity, 2);
    assert.equal(adjusted.body.item.lowStock, true);

    const negative = await staffAgent
        .post(
            `/api/operations/inventory/${inventoryItemId}/adjust`
        )
        .send({ delta: -10, reason: "issue" })
        .expect(400);

    assert.match(negative.body.message, /negative/);

    const transactions = await managerAgent
        .get(
            `/api/operations/inventory/${inventoryItemId}/transactions`
        )
        .expect(200);

    assert.equal(transactions.body.transactions.length, 1);
    assert.equal(transactions.body.transactions[0].delta, -3);
    assert.equal(
        transactions.body.transactions[0].actorName,
        "IT Staff"
    );

    const list = await managerAgent
        .get("/api/operations/inventory?lowOnly=true")
        .expect(200);

    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.summary.lowStock, 1);
    assert.equal(list.body.summary.total, 1);
});

test("preventive maintenance supports assignment, completion and recurrence", async () => {
    await studentAgent.get("/api/operations/maintenance").expect(403);

    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await managerAgent
        .post("/api/operations/maintenance")
        .send({
            title: "Inspect lab projector filters",
            description:
                "Clean filters and check lamp hours in Computer Lab 1.",
            assetName: "Projector PL-01",
            location: "IT Block, Computer Lab 1",
            assignedTo: staffId,
            frequency: "weekly",
            nextDueAt: dueAt.toISOString(),
            priority: "High"
        })
        .expect(201);

    maintenanceTaskId = created.body.task.id;

    const started = await staffAgent
        .patch(`/api/operations/maintenance/${maintenanceTaskId}`)
        .send({ status: "In Progress" })
        .expect(200);

    assert.equal(started.body.message, "Maintenance task updated");

    const completed = await staffAgent
        .post(
            `/api/operations/maintenance/${maintenanceTaskId}/complete`
        )
        .send({ note: "Filters cleaned; lamp at 62%." })
        .expect(200);

    assert.equal(completed.body.message, "Maintenance completed");

    const list = await managerAgent
        .get("/api/operations/maintenance")
        .expect(200);

    const task = list.body.tasks.find(
        (row) => row.id === maintenanceTaskId
    );

    assert.equal(task.status, "Scheduled");
    assert.ok(task.lastCompletedAt);
    assert.ok(
        new Date(task.nextDueAt).getTime() >
            Date.now() + 6 * 24 * 60 * 60 * 1000
    );
    assert.equal(task.assignedTo.id, staffId);

    const logs = await managerAgent
        .get(
            `/api/operations/maintenance/${maintenanceTaskId}/logs`
        )
        .expect(200);

    assert.equal(logs.body.logs.length, 1);
    assert.match(logs.body.logs[0].note, /Filters cleaned/);
    assert.equal(logs.body.logs[0].actorName, "IT Staff");

    await managerAgent
        .post("/api/operations/maintenance")
        .send({
            title: "Overdue fire extinguisher check",
            assetName: "Extinguisher FE-12",
            frequency: "monthly",
            nextDueAt: new Date(
                Date.now() - 3 * 24 * 60 * 60 * 1000
            ).toISOString()
        })
        .expect(201);

    const overdue = await managerAgent
        .get("/api/operations/maintenance?overdue=true")
        .expect(200);

    assert.equal(overdue.body.tasks.length, 1);
    assert.equal(overdue.body.tasks[0].isOverdue, true);
    assert.equal(overdue.body.summary.overdue, 1);
});

test("department scoping keeps other teams out of IT operations", async () => {
    const departmentRows = await database.pool.query(
        "SELECT id FROM departments WHERE code = 'CIVIL'"
    );
    const hash = bcrypt.hashSync("StaffPass123!", 10);

    await database.pool.query(
        `INSERT INTO users
            (name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, 'department_manager', $4)`,
        [
            "Civil Manager",
            "civil.manager@example.com",
            hash,
            departmentRows.rows[0].id
        ]
    );

    const civilAgent = await login(
        "civil.manager@example.com",
        "StaffPass123!"
    );

    const inventory = await civilAgent
        .get("/api/operations/inventory")
        .expect(200);

    assert.equal(inventory.body.items.length, 0);

    const maintenance = await civilAgent
        .get("/api/operations/maintenance")
        .expect(200);

    assert.equal(maintenance.body.tasks.length, 0);

    const bookings = await civilAgent
        .get("/api/facilities/bookings")
        .expect(200);

    assert.equal(bookings.body.bookings.length, 0);
});
