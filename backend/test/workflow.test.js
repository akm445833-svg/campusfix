const {
    test,
    before,
    after
} = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { startTestDatabase } = require("./helpers/postgres");

let testDatabase;
let database;
let app;
let adminAgent;
let managerAgent;
let staffAgent;
let studentAgent;
let otherStudentAgent;
let departmentIds = {};
let student;
let otherStudent;
let complaintId;
let referenceNumber;

async function registerAndLogin(agent, suffix, password) {
    const email = `${suffix}@example.com`;
    const secret = password || "StudentPass123!";

    await agent
        .post("/api/register")
        .send({
            name: `User ${suffix}`,
            email,
            password: secret
        })
        .expect(201);

    await agent
        .post("/api/login")
        .send({ email, password: secret })
        .expect(200);

    const me = await agent.get("/api/me").expect(200);

    return { ...me.body.user, email, password: secret };
}

async function login(email, password) {
    const agent = request.agent(app);

    await agent
        .post("/api/login")
        .send({ email, password })
        .expect(200);

    return agent;
}

before(async () => {
    testDatabase = await startTestDatabase();

    const { loadConfig } = require("../config");
    const { createDatabase } = require("../db/client");
    const { createApp } = require("../app");
    const { users } = require("../db/schema");

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

    for (const row of departmentRows.rows) {
        departmentIds[row.code] = row.id;
    }

    const hash = bcrypt.hashSync("StaffPass123!", 10);

    await database.pool.query(
        `INSERT INTO users
            (name, email, password_hash, role, department_id)
         VALUES
            ($1, $2, $3, 'admin', NULL),
            ($4, $5, $3, 'department_manager', $6),
            ($7, $8, $3, 'staff', $6),
            ($9, $10, $3, 'staff', $11)`,
        [
            "Campus Admin",
            "admin@example.com",
            hash,
            "IT Manager",
            "manager@example.com",
            departmentIds.IT,
            "IT Staff",
            "it.staff@example.com",
            "Civil Staff",
            "civil.staff@example.com",
            departmentIds.CIVIL
        ]
    );

    adminAgent = await login(
        "admin@example.com",
        "StaffPass123!"
    );
    managerAgent = await login(
        "manager@example.com",
        "StaffPass123!"
    );
    staffAgent = await login(
        "it.staff@example.com",
        "StaffPass123!"
    );

    studentAgent = request.agent(app);
    student = await registerAndLogin(
        studentAgent,
        "workflow-student"
    );
    otherStudentAgent = request.agent(app);
    otherStudent = await registerAndLogin(
        otherStudentAgent,
        "workflow-other"
    );
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

test("student submissions receive real references, departments and SLA deadlines", async () => {
    const meta = await studentAgent
        .get("/api/complaints/meta")
        .expect(200);

    assert.ok(meta.body.categories.length >= 10);
    assert.ok(meta.body.departments.length >= 10);
    assert.equal(meta.body.sla.length, 4);

    const created = await studentAgent
        .post("/api/complaints")
        .send({
            title: "Library Wi-Fi keeps disconnecting",
            category: "Wi-Fi/IT",
            description:
                "The Wi-Fi network disconnects every few minutes in the reading room.",
            location: "Central Library, Reading Room 2",
            priority: "High",
            latitude: 22.5726,
            longitude: 88.3639
        })
        .expect(201);

    complaintId = created.body.complaint.id;
    referenceNumber =
        created.body.complaint.referenceNumber;

    assert.match(referenceNumber, /^CF-\d{4}-\d{6,}$/);
    assert.equal(created.body.complaint.status, "Pending");
    assert.equal(
        created.body.complaint.department.code,
        "IT"
    );
    assert.ok(created.body.complaint.dueAt);
    assert.equal(created.body.complaint.latitude, 22.5726);

    const invalid = await studentAgent
        .post("/api/complaints")
        .send({
            title: "Bad coordinates",
            category: "Electrical",
            description: "Only latitude supplied.",
            location: "Block A",
            priority: "Low",
            latitude: 12.3
        })
        .expect(400);

    assert.match(invalid.body.message, /Latitude/);

    const filtered = await studentAgent
        .get(
            "/api/complaints/mine?search=Library&status=Pending&page=1&pageSize=10"
        )
        .expect(200);

    assert.equal(filtered.body.complaints.length, 1);
    assert.equal(filtered.body.pagination.total, 1);

    const details = await studentAgent
        .get(`/api/complaints/details/${complaintId}`)
        .expect(200);

    assert.equal(details.body.complaint.referenceNumber, referenceNumber);
    assert.equal(details.body.permissions.isOwner, true);
    assert.ok(details.body.history.length >= 1);

    await otherStudentAgent
        .get(`/api/complaints/details/${complaintId}`)
        .expect(403);

    const managerNotifications = await managerAgent
        .get("/api/notifications?unreadOnly=true")
        .expect(200);

    assert.ok(managerNotifications.body.unreadCount >= 1);
});

test("staff conversations require the student to start the thread", async () => {
    const staffRow = await database.pool.query(
        "SELECT id FROM users WHERE email = 'it.staff@example.com'"
    );
    const staffId = staffRow.rows[0].id;

    await staffAgent
        .post("/api/chat")
        .send({
            receiverId: student.id,
            message: "Unsolicited message should be rejected."
        })
        .expect(403);

    const before = await staffAgent
        .get("/api/users")
        .expect(200);

    assert.ok(
        !before.body.users.some((row) => row.id === student.id)
    );

    await studentAgent
        .post("/api/chat")
        .send({
            receiverId: staffId,
            message: "The library Wi-Fi is still unstable."
        })
        .expect(201);

    const contacts = await staffAgent
        .get("/api/users")
        .expect(200);
    const partner = contacts.body.users.find(
        (row) => row.id === student.id
    );

    assert.ok(partner);
    assert.equal(partner.role, "student");
    assert.equal(partner.email, undefined);

    await staffAgent
        .post("/api/chat")
        .send({
            receiverId: student.id,
            message: "We will replace the access point tomorrow."
        })
        .expect(201);

    const thread = await studentAgent
        .get(`/api/chat/${staffId}`)
        .expect(200);

    assert.equal(thread.body.messages.length, 2);

    await studentAgent
        .post("/api/chat")
        .send({
            receiverId: otherStudent.id,
            message: "Students cannot message each other."
        })
        .expect(404);
});

test("assignment, internal notes, resolution, feedback and reopening follow the workflow", async () => {
    await studentAgent
        .get("/api/admin/complaints")
        .expect(403);

    const staffRows = await managerAgent
        .get("/api/admin/staff")
        .expect(200);
    const itStaff = staffRows.body.staff.find(
        (user) => user.email === undefined && user.name === "IT Staff"
    ) || staffRows.body.staff.find(
        (user) => user.name === "IT Staff"
    );

    // Staff contact lists never expose email addresses.
    assert.ok(itStaff);
    assert.equal(itStaff.email, undefined);

    const crossDepartment = await managerAgent
        .put(`/api/admin/complaints/${complaintId}/assignment`)
        .send({
            departmentId: departmentIds.CIVIL
        })
        .expect(403);

    assert.equal(crossDepartment.body.code, "forbidden");

    const assigned = await managerAgent
        .put(`/api/admin/complaints/${complaintId}/assignment`)
        .send({
            departmentId: departmentIds.IT,
            assignedToId: itStaff.id
        })
        .expect(200);

    assert.equal(assigned.body.complaint.status, "Assigned");
    assert.equal(assigned.body.complaint.assignedTo.name, "IT Staff");

    const inProgress = await staffAgent
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "In Progress" })
        .expect(200);

    assert.equal(inProgress.body.complaint.status, "In Progress");

    const internalNote = await staffAgent
        .post(`/api/complaints/${complaintId}/comments`)
        .send({
            message: "Replacing the access point on floor two.",
            visibility: "internal"
        })
        .expect(201);

    assert.equal(internalNote.body.comment.visibility, "internal");

    const studentDetailsAfterNote = await studentAgent
        .get(`/api/complaints/details/${complaintId}`)
        .expect(200);

    assert.equal(studentDetailsAfterNote.body.notes.length, 0);

    const staffDetails = await staffAgent
        .get(`/api/complaints/details/${complaintId}`)
        .expect(200);

    assert.equal(staffDetails.body.notes.length, 1);
    assert.equal(
        staffDetails.body.notes[0].message,
        "Replacing the access point on floor two."
    );

    const publicComment = await staffAgent
        .post(`/api/complaints/${complaintId}/comments`)
        .send({
            message: "The replacement part has arrived.",
            visibility: "public"
        })
        .expect(201);

    assert.equal(publicComment.body.comment.visibility, "public");

    const studentWithComment = await studentAgent
        .get(`/api/complaints/details/${complaintId}`)
        .expect(200);

    assert.equal(studentWithComment.body.notes.length, 1);

    const missingResolution = await staffAgent
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "Resolved" })
        .expect(400);

    assert.match(missingResolution.body.message, /resolution/i);

    const resolved = await staffAgent
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({
            status: "Resolved",
            resolution:
                "Replaced the faulty access point and verified coverage."
        })
        .expect(200);

    assert.equal(resolved.body.complaint.status, "Resolved");
    assert.ok(resolved.body.complaint.resolvedAt);

    const feedback = await studentAgent
        .post(`/api/complaints/${complaintId}/feedback`)
        .send({
            rating: 5,
            comment: "Fast and clear update."
        })
        .expect(200);

    assert.equal(feedback.body.complaint.feedback.rating, 5);

    await studentAgent
        .post(`/api/complaints/${complaintId}/feedback`)
        .send({ rating: 4 })
        .expect(400);

    const reopened = await studentAgent
        .post(`/api/complaints/${complaintId}/reopen`)
        .send({
            reason: "The connection dropped again this morning."
        })
        .expect(200);

    assert.equal(reopened.body.complaint.status, "Reopened");

    const invalidTransition = await adminAgent
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "Rejected", rejectionReason: "Not valid" })
        .expect(200);

    // Rejected -> Reopened is allowed, but Reopened -> Rejected is not.
    assert.equal(invalidTransition.body.complaint.status, "Rejected");

    await adminAgent
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "Rejected", rejectionReason: "Again" })
        .expect(400);

    const staffNotifications = await staffAgent
        .get("/api/notifications")
        .expect(200);

    assert.ok(staffNotifications.body.notifications.length >= 1);

    const readAll = await staffAgent
        .post("/api/notifications/read-all")
        .expect(200);

    assert.ok(readAll.body.updated >= 1);

    const unreadAfter = await staffAgent
        .get("/api/notifications?unreadOnly=true")
        .expect(200);

    assert.equal(unreadAfter.body.unreadCount, 0);

    const stats = await adminAgent
        .get("/api/admin/stats")
        .expect(200);

    assert.ok(stats.body.total >= 1);
    assert.ok(Array.isArray(stats.body.byStatus));
    assert.ok(Array.isArray(stats.body.departmentWorkload));
    assert.ok(Array.isArray(stats.body.staffWorkload));

    const managerComplaints = await managerAgent
        .get("/api/admin/complaints")
        .expect(200);

    assert.ok(
        managerComplaints.body.complaints.every(
            (complaint) =>
                complaint.department.code === "IT"
        )
    );

    await staffAgent
        .delete(`/api/admin/complaints/${complaintId}`)
        .expect(403);
});

test("notices respect publish/expiry windows and audience", async () => {
    const now = Date.now();
    const active = await adminAgent
        .post("/api/admin/notices")
        .send({
            title: "Library extended hours",
            body:
                "The central library will stay open until 11 PM during examinations.",
            audience: "students",
            priority: "High",
            publishedAt: new Date(now - 60_000).toISOString(),
            expiresAt: new Date(
                now + 7 * 24 * 60 * 60 * 1000
            ).toISOString()
        })
        .expect(201);

    await adminAgent
        .post("/api/admin/notices")
        .send({
            title: "Expired maintenance notice",
            body: "This notice must not appear as current.",
            audience: "all",
            publishedAt: new Date(
                now - 3 * 24 * 60 * 60 * 1000
            ).toISOString(),
            expiresAt: new Date(
                now - 2 * 24 * 60 * 60 * 1000
            ).toISOString()
        })
        .expect(201);

    await adminAgent
        .post("/api/admin/notices")
        .send({
            title: "Staff-only briefing",
            body: "Internal staff briefing for the operations team.",
            audience: "staff",
            publishedAt: new Date(now - 60_000).toISOString()
        })
        .expect(201);

    const studentNotices = await studentAgent
        .get("/api/notices")
        .expect(200);
    const studentTitles = studentNotices.body.notices.map(
        (notice) => notice.title
    );

    assert.ok(studentTitles.includes("Library extended hours"));
    assert.ok(!studentTitles.includes("Expired maintenance notice"));
    assert.ok(!studentTitles.includes("Staff-only briefing"));

    const staffNotices = await staffAgent
        .get("/api/notices")
        .expect(200);
    const staffTitles = staffNotices.body.notices.map(
        (notice) => notice.title
    );

    assert.ok(staffTitles.includes("Staff-only briefing"));

    const updated = await adminAgent
        .patch(`/api/admin/notices/${active.body.notice.id}`)
        .send({ title: "Library hours extended" })
        .expect(200);

    assert.equal(updated.body.notice.title, "Library hours extended");

    await studentAgent
        .post("/api/admin/notices")
        .send({
            title: "Forbidden",
            body: "Students cannot publish notices."
        })
        .expect(403);
});

test("profile, password, user access, exports and audit are protected", async () => {
    const profile = await studentAgent
        .get("/api/profile")
        .expect(200);

    assert.equal(profile.body.profile.email, student.email);

    const renamed = await studentAgent
        .patch("/api/profile")
        .send({ name: "Updated Student Name" })
        .expect(200);

    assert.equal(renamed.body.profile.name, "Updated Student Name");

    await studentAgent
        .put("/api/profile/password")
        .send({
            currentPassword: "wrong-password",
            newPassword: "NewStudentPass123!"
        })
        .expect(400);

    await studentAgent
        .put("/api/profile/password")
        .send({
            currentPassword: student.password,
            newPassword: "NewStudentPass123!"
        })
        .expect(200);

    await request(app)
        .post("/api/login")
        .send({
            email: student.email,
            password: student.password
        })
        .expect(401);

    await request(app)
        .post("/api/login")
        .send({
            email: student.email,
            password: "NewStudentPass123!"
        })
        .expect(200);

    const users = await adminAgent
        .get("/api/admin/users")
        .expect(200);
    const promoted = users.body.users.find(
        (row) => row.email === otherStudent.email
    );

    assert.ok(promoted);

    await adminAgent
        .patch(`/api/admin/users/${promoted.id}`)
        .send({
            role: "staff",
            departmentId: departmentIds.IT
        })
        .expect(200);

    const promotedAccess = await otherStudentAgent
        .get("/api/admin/stats")
        .expect(200);

    assert.equal(typeof promotedAccess.body.total, "number");

    await adminAgent
        .patch(`/api/admin/users/${promoted.id}`)
        .send({ role: "staff" })
        .expect(400);

    const adminMe = await adminAgent.get("/api/me").expect(200);

    await adminAgent
        .patch(`/api/admin/users/${adminMe.body.user.id}`)
        .send({
            role: "student",
            departmentId: null
        })
        .expect(400);

    const csv = await adminAgent
        .get("/api/admin/export")
        .expect(200);

    assert.match(
        csv.headers["content-type"],
        /text\/csv/
    );
    assert.match(csv.text, /"Reference","Title","Category"/);
    assert.match(csv.text, /CF-/);

    const audit = await adminAgent
        .get("/api/admin/audit")
        .expect(200);

    assert.ok(audit.body.logs.length >= 1);

    await studentAgent
        .get("/api/admin/audit")
        .expect(403);

    const publicConfig = await request(app)
        .get("/api/public-config")
        .expect(200);

    assert.equal(publicConfig.body.appName, "CampusFix");
    assert.ok(publicConfig.body.collegeName);
});
