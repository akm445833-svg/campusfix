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
let adminId;

function studentAgent() {
    return request.agent(app);
}

async function registerAndLogin(agent, suffix) {
    const email = `${suffix}@example.com`;
    const password = "StudentPass123!";

    await agent
        .post("/api/register")
        .send({
            name: `Student ${suffix}`,
            email,
            password
        })
        .expect(201);

    await agent
        .post("/api/login")
        .send({ email, password })
        .expect(200);

    const me = await agent.get("/api/me").expect(200);

    return { ...me.body.user, password, email };
}

async function loginAdmin() {
    const agent = request.agent(app);

    await agent
        .post("/api/login")
        .send({
            email: "admin@example.com",
            password: "AdminPass123!"
        })
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

    const adminRows = await database.db
        .insert(users)
        .values({
            name: "CampusFix Admin",
            email: "admin@example.com",
            passwordHash: bcrypt.hashSync("AdminPass123!", 10),
            role: "admin"
        })
        .returning({ id: users.id });

    adminId = adminRows[0].id;
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

test("health endpoint checks the database", async () => {
    const response = await request(app)
        .get("/api/health")
        .expect(200);

    assert.equal(response.body.status, "OK");
    assert.equal(response.body.database, "connected");
});

test("backend source and environment files are not publicly served", async () => {
    await request(app).get("/backend/server.js").expect(404);
    await request(app).get("/backend/.env").expect(404);
    await request(app).get("/.env").expect(404);
    await request(app).get("/package.json").expect(404);

    const page = await request(app)
        .get("/login.html")
        .expect(200);

    const csp = page.headers["content-security-policy"];

    assert.ok(csp);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.equal(page.headers["x-powered-by"], undefined);
    assert.match(page.text, /js\/login\.js/);
});

test("registration validates input and never returns a token", async () => {
    const response = await request(app)
        .post("/api/register")
        .send({
            name: "Alice Student",
            email: "ALICE@example.com",
            password: "StudentPass123!"
        })
        .expect(201);

    assert.equal(response.body.user.email, "alice@example.com");
    assert.equal(response.body.user.role, "student");
    assert.equal(response.body.token, undefined);
    assert.equal(response.body.user.password, undefined);
    assert.equal(response.body.user.passwordHash, undefined);

    const duplicate = await request(app)
        .post("/api/register")
        .send({
            name: "Alice Again",
            email: "alice@example.com",
            password: "StudentPass123!"
        })
        .expect(400);

    assert.equal(duplicate.body.message, "User already exists");

    await request(app)
        .post("/api/register")
        .send({
            name: "Short Password",
            email: "short@example.com",
            password: "12345"
        })
        .expect(400);

    await request(app)
        .post("/api/register")
        .send({
            name: "Bad Email",
            email: "not-an-email",
            password: "StudentPass123!"
        })
        .expect(400);
});

test("login issues a secure HttpOnly cookie and logout clears the session", async () => {
    const agent = request.agent(app);
    const response = await agent
        .post("/api/login")
        .send({
            email: "alice@example.com",
            password: "StudentPass123!"
        })
        .expect(200);

    assert.equal(response.body.user.email, "alice@example.com");
    assert.equal(response.body.token, undefined);

    const setCookie = response.headers["set-cookie"].join(";");
    assert.match(setCookie, /campusfix_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    await agent.get("/api/logout").expect(404);
    await agent.post("/api/logout").expect(200);
    await agent.get("/api/me").expect(401);
});

test("complaint ownership is enforced and validation rejects bad input", async () => {
    const created = await request.agent(app)
        .post("/api/complaints")
        .send({})
        .expect(401);

    assert.equal(created.body.message, "Access denied. Login required.");

    const agent = studentAgent();
    await registerAndLogin(agent, "complaint-1");

    const complaint = await agent
        .post("/api/complaints")
        .send({
            title: "Broken fan",
            category: "Electricity",
            description: "The ceiling fan in room 12 is not working.",
            location: "Room 12",
            priority: "High"
        })
        .expect(201);

    assert.match(
        complaint.body.complaint.id,
        /^[0-9a-f-]{36}$/i
    );
    assert.equal(complaint.body.complaint.status, "Pending");
    assert.equal(complaint.body.complaint.priority, "High");

    const mine = await agent
        .get("/api/complaints/mine")
        .expect(200);

    assert.equal(mine.body.complaints.length, 1);
    assert.equal(mine.body.complaints[0].title, "Broken fan");

    const aliceAgent = studentAgent();
    const aliceUser = await registerAndLogin(
        aliceAgent,
        "isolation-alice"
    );
    const bobAgent = studentAgent();
    const bobUser = await registerAndLogin(
        bobAgent,
        "isolation-bob"
    );

    await aliceAgent
        .post("/api/complaints")
        .send({
            title: "Alice private complaint",
            category: "Hostel",
            description: "Private details",
            location: "Hostel A",
            priority: "Low"
        })
        .expect(201);

    const aliceComplaints = await aliceAgent
        .get("/api/complaints/mine")
        .expect(200);

    assert.equal(aliceComplaints.body.complaints.length, 1);

    await bobAgent
        .get(`/api/complaints/${aliceUser.id}`)
        .expect(403);

    await bobAgent
        .get(`/api/complaints/${bobUser.id}`)
        .expect(200);

    await agent
        .post("/api/complaints")
        .send({
            title: "Bad priority",
            category: "Water",
            description: "Test",
            location: "Test",
            priority: "Urgent"
        })
        .expect(400);

    await agent
        .post("/api/complaints")
        .send({
            title: "x".repeat(201),
            category: "Water",
            description: "Test",
            location: "Test",
            priority: "Low"
        })
        .expect(400);

    await agent
        .post("/api/complaints")
        .send({
            title: "Missing description",
            category: "Water",
            location: "Test"
        })
        .expect(400);
});

test("admin routes require an administrator role and persist status changes", async () => {
    const student = studentAgent();
    await registerAndLogin(student, "admin-access-student");

    await student.get("/api/admin/stats").expect(403);
    await student.get("/api/admin/complaints").expect(403);
    await student
        .delete("/api/admin/complaints/00000000-0000-4000-8000-000000000000")
        .expect(403);

    const admin = await loginAdmin();

    const studentComplaint = await student
        .post("/api/complaints")
        .send({
            title: "Admin managed issue",
            category: "Wi-Fi",
            description: "Wi-Fi is slow in the library.",
            location: "Library",
            priority: "Medium"
        })
        .expect(201);

    const complaintId = studentComplaint.body.complaint.id;

    const list = await admin
        .get("/api/admin/complaints")
        .expect(200);

    const found = list.body.complaints.find(
        (complaint) => complaint.id === complaintId
    );

    assert.ok(found);
    assert.equal(found.createdBy.email, "admin-access-student@example.com");
    assert.equal(found.createdBy.passwordHash, undefined);

    const updated = await admin
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "In Progress" })
        .expect(200);

    assert.equal(updated.body.complaint.status, "In Progress");

    const studentList = await student
        .get("/api/complaints/mine")
        .expect(200);

    assert.equal(studentList.body.complaints[0].status, "In Progress");

    const stats = await admin.get("/api/admin/stats").expect(200);

    assert.ok(stats.body.total >= 1);
    assert.ok(stats.body.inProgress >= 1);
    assert.equal(typeof stats.body.pending, "number");

    await admin
        .put(`/api/admin/complaints/${complaintId}/status`)
        .send({ status: "Unknown" })
        .expect(400);

    await admin
        .put("/api/admin/complaints/not-a-uuid/status")
        .send({ status: "Pending" })
        .expect(400);

    await admin
        .put(
            "/api/admin/complaints/00000000-0000-4000-8000-000000000000/status"
        )
        .send({
            status: "Resolved",
            resolution: "Validated before looking up the record."
        })
        .expect(404);

    await admin
        .delete(`/api/admin/complaints/${complaintId}`)
        .expect(200);

    const afterDelete = await student
        .get("/api/complaints/mine")
        .expect(200);

    assert.equal(afterDelete.body.complaints.length, 0);

    const info = await admin.get("/api/admin/info").expect(200);
    assert.equal(info.body.admin.role, "admin");
    assert.equal(info.body.admin.passwordHash, undefined);
});

test("students can only read their own chat threads", async () => {
    const admin = await loginAdmin();

    const aliceAgent = studentAgent();
    const alice = await registerAndLogin(
        aliceAgent,
        "chat-alice"
    );
    const bobAgent = studentAgent();
    await registerAndLogin(bobAgent, "chat-bob");

    const admins = await aliceAgent
        .get("/api/users")
        .expect(200);

    assert.equal(admins.body.users.length, 1);
    assert.equal(admins.body.users[0].id, adminId);
    assert.equal(admins.body.users[0].email, undefined);

    await aliceAgent
        .post("/api/chat")
        .send({
            receiverId: adminId,
            message: "Hello admin, I need help."
        })
        .expect(201);

    const adminThread = await admin
        .get(`/api/chat/${alice.id}`)
        .expect(200);

    assert.equal(adminThread.body.messages.length, 1);
    assert.equal(
        adminThread.body.messages[0].message,
        "Hello admin, I need help."
    );
    assert.equal(
        adminThread.body.messages[0].sender.name,
        "Student chat-alice"
    );

    const bobThread = await bobAgent
        .get(`/api/chat/${alice.id}`)
        .expect(200);

    assert.equal(bobThread.body.messages.length, 0);

    await aliceAgent
        .post("/api/chat")
        .send({ receiverId: alice.id, message: "Self message" })
        .expect(400);

    const aiResponse = await aliceAgent
        .post("/api/chat/ai")
        .send({ message: "How do I report a problem?" })
        .expect(200);

    assert.match(aiResponse.body.reply, /CampusFix/);

    const aiHistory = await aliceAgent
        .get("/api/chat/ai/history")
        .expect(200);

    assert.equal(aiHistory.body.messages.length, 2);
    assert.equal(aiHistory.body.messages[1].isAI, true);
});

test("cross-origin mutation requests are rejected", async () => {
    await request(app)
        .post("/api/login")
        .set("Origin", "https://evil.example")
        .send({
            email: "alice@example.com",
            password: "StudentPass123!"
        })
        .expect(403);

    await request(app)
        .post("/api/login")
        .set("Origin", "http://localhost:3000")
        .send({
            email: "alice@example.com",
            password: "wrong-password"
        })
        .expect(401);
});
