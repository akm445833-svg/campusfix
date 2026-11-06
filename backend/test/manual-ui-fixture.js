"use strict";

/* Temporary local UI fixture. Run directly; never deployed. */

const http = require("node:http");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { startTestDatabase } = require("./helpers/postgres");

const PORT = 5055;
const PASSWORD = "VerifyPass123!";

async function main() {
    const testDatabase = await startTestDatabase();
    process.env.CORS_ORIGINS =
        "http://127.0.0.1:5055,http://localhost:5055";

    const { loadConfig } = require("../config");
    const { createDatabase, closeDatabase } = require("../db/client");
    const { createApp } = require("../app");

    const database = createDatabase({
        connectionString: testDatabase.connectionString
    });
    const app = createApp({
        config: loadConfig(),
        database
    });

    const departmentRows = await database.pool.query(
        "SELECT id, code FROM departments"
    );
    const departments = Object.fromEntries(
        departmentRows.rows.map((row) => [row.code, row.id])
    );

    const hash = bcrypt.hashSync(PASSWORD, 10);

    await database.pool.query(
        `INSERT INTO users
            (name, email, password_hash, role, department_id)
         VALUES
            ($1, $2, $3, 'admin', NULL),
            ($4, $5, $3, 'department_manager', $6),
            ($7, $8, $3, 'staff', $6),
            ($9, $10, $3, 'staff', $11),
            ($12, $13, $3, 'staff', $14),
            ($15, $16, $3, 'student', NULL),
            ($17, $18, $3, 'student', NULL)`,
        [
            "Priya Nair",
            "admin@campusfix.test",
            hash,
            "Vikram Rao",
            "manager@campusfix.test",
            departments.IT,
            "Neha Singh",
            "staff@campusfix.test",
            "Arjun Das",
            "arjun@campusfix.test",
            departments.ELECTRICAL,
            "Gita Sharma",
            "gita@campusfix.test",
            departments.HOUSEKEEPING,
            "Asha Verma",
            "student@campusfix.test",
            "Rohan Mehta",
            "rohan@campusfix.test"
        ]
    );

    async function login(email) {
        const agent = request.agent(app);
        await agent
            .post("/api/login")
            .send({ email, password: PASSWORD })
            .expect(200);
        return agent;
    }

    const student = await login("student@campusfix.test");
    const admin = await login("admin@campusfix.test");
    const itStaff = await login("staff@campusfix.test");

    const staffRows = await admin.get("/api/admin/staff").expect(200);
    const staffUser = (name) =>
        staffRows.body.staff.find((row) => row.name === name);

    const complaints = [
        {
            title: "Library Wi-Fi keeps disconnecting",
            category: "Wi-Fi/IT",
            priority: "High",
            description:
                "The Wi-Fi network drops every few minutes in the reading room, which interrupts online exams and research.",
            location: "Central Library, Reading Room 2",
            latitude: 22.5726,
            longitude: 88.3639
        },
        {
            title: "Flickering lights in Computer Lab 2",
            category: "Electrical",
            priority: "Medium",
            description:
                "Two tube lights above the last row of desktops flicker constantly and make it hard to read the board.",
            location: "Academic Block B, Computer Lab 2"
        },
        {
            title: "Overflowing waste bin near canteen",
            category: "Cleaning",
            priority: "Low",
            description:
                "The large bin beside the canteen entrance has not been emptied since Monday and waste is spilling onto the walkway.",
            location: "Canteen main entrance"
        },
        {
            title: "Leaking tap in Hostel B washroom",
            category: "Plumbing",
            priority: "Critical",
            description:
                "A tap on the first floor is running continuously and water is pooling near the electrical socket.",
            location: "Hostel B, first floor washroom"
        }
    ];

    const created = [];

    for (const complaint of complaints) {
        const response = await student
            .post("/api/complaints")
            .send(complaint)
            .expect(201);
        created.push(response.body.complaint);
    }

    const [wifi, electrical, cleaning, leaking] = created;

    await admin
        .put(`/api/admin/complaints/${wifi.id}/assignment`)
        .send({
            departmentId: departments.IT,
            assignedToId: staffUser("Neha Singh").id
        })
        .expect(200);
    await itStaff
        .put(`/api/admin/complaints/${wifi.id}/status`)
        .send({ status: "In Progress" })
        .expect(200);
    await itStaff
        .post(`/api/complaints/${wifi.id}/comments`)
        .send({
            message:
                "The floor-two access point is failing. Replacement hardware arrives tomorrow.",
            visibility: "internal"
        })
        .expect(201);
    await itStaff
        .post(`/api/complaints/${wifi.id}/comments`)
        .send({
            message:
                "Our network team has confirmed the fault and will replace the access point tomorrow morning.",
            visibility: "public"
        })
        .expect(201);

    await admin
        .put(`/api/admin/complaints/${cleaning.id}/assignment`)
        .send({
            departmentId: departments.HOUSEKEEPING,
            assignedToId: staffUser("Gita Sharma").id
        })
        .expect(200);
    const housekeeping = await login("gita@campusfix.test");
    await housekeeping
        .put(`/api/admin/complaints/${cleaning.id}/status`)
        .send({ status: "In Progress" })
        .expect(200);
    await housekeeping
        .put(`/api/admin/complaints/${cleaning.id}/status`)
        .send({
            status: "Resolved",
            resolution:
                "Bin emptied and the area disinfected. An extra collection was added to the evening round."
        })
        .expect(200);
    await student
        .post(`/api/complaints/${cleaning.id}/feedback`)
        .send({
            rating: 4,
            comment: "Much better. Hope the extra collection is permanent."
        })
        .expect(200);

    await database.pool.query(
        "UPDATE complaints SET due_at = now() - interval '2 hours' WHERE id = $1",
        [leaking.id]
    );

    await student
        .post("/api/chat")
        .send({
            receiverId: staffUser("Neha Singh").id,
            message:
                "Hi Neha, the library Wi-Fi is still unstable this afternoon. Any update?"
        })
        .expect(201);
    await itStaff
        .post("/api/chat")
        .send({
            receiverId: (
                await student.get("/api/me").expect(200)
            ).body.user.id,
            message:
                "We have the replacement access point and will install it at 9 AM tomorrow."
        })
        .expect(201);

    const adminRow = await database.pool.query(
        "SELECT id FROM users WHERE email = 'admin@campusfix.test'"
    );
    await student
        .post("/api/chat")
        .send({
            receiverId: adminRow.rows[0].id,
            message:
                "Could the library reading room stay open later during exams?"
        })
        .expect(201);

    const notices = [        {
            title: "Library extended hours during exams",
            body:
                "The Central Library will remain open until 11 PM from Monday through the end of examinations. Bring your campus ID for late-entry access.",
            audience: "students",
            priority: "High"
        },
        {
            title: "Staff safety briefing on Friday",
            body:
                "All operations staff are invited to the quarterly safety briefing in Seminar Hall A at 3 PM on Friday.",
            audience: "staff",
            priority: "Normal"
        },
        {
            title: "Water supply maintenance in Hostel B",
            body:
                "Scheduled tank cleaning will pause water supply in Hostel B on Saturday between 10 AM and 1 PM.",
            audience: "all",
            priority: "Normal"
        }
    ];

    for (const notice of notices) {
        await admin.post("/api/admin/notices").send(notice).expect(201);
    }

    /* Campus services fixture data (local verification only). */
    const manager = await login("manager@campusfix.test");
    const rohan = await login("rohan@campusfix.test");
    const facilitiesResponse = await student
        .get("/api/facilities")
        .expect(200);
    const facilities = facilitiesResponse.body.facilities;
    const itFacility =
        facilities.find(
            (row) => row.departmentId === departments.IT
        ) || facilities[0];
    const otherFacility =
        facilities.find((row) => row.id !== itFacility.id) ||
        facilities[1];

    function bookingWindow(daysFromNow, hour) {
        const start = new Date();
        start.setDate(start.getDate() + daysFromNow);
        start.setHours(hour, 0, 0, 0);
        return {
            startsAt: start.toISOString(),
            endsAt: new Date(
                start.getTime() + 2 * 60 * 60 * 1000
            ).toISOString()
        };
    }

    const pendingBooking = await student
        .post("/api/facilities/bookings")
        .send({
            facilityId: itFacility.id,
            title: "Robotics club build session",
            purpose:
                "Weekly build session for the robotics club. We need tables and power outlets.",
            ...bookingWindow(3, 10),
            attendees: 24
        })
        .expect(201);

    await rohan
        .post("/api/facilities/bookings")
        .send({
            facilityId: otherFacility.id,
            title: "Photography society review",
            ...bookingWindow(4, 14),
            attendees: 12
        })
        .expect(201);

    const approvedBooking = await rohan
        .post("/api/facilities/bookings")
        .send({
            facilityId: itFacility.id,
            title: "Placement mock interviews",
            purpose: "Mock interviews for final-year students.",
            ...bookingWindow(5, 9),
            attendees: 30
        })
        .expect(201);

    await manager
        .patch(
            `/api/facilities/bookings/${approvedBooking.body.booking.id}/review`
        )
        .send({
            status: "Approved",
            note: "Confirmed with the placement cell."
        })
        .expect(200);

    const rejectedBooking = await rohan
        .post("/api/facilities/bookings")
        .send({
            facilityId: itFacility.id,
            title: "Late-night gaming tournament",
            ...bookingWindow(6, 22),
            attendees: 40
        })
        .expect(201);

    await manager
        .patch(
            `/api/facilities/bookings/${rejectedBooking.body.booking.id}/review`
        )
        .send({
            status: "Rejected",
            note: "The building closes at 9 PM; choose an earlier slot."
        })
        .expect(200);

    const foundItem = await student
        .post("/api/lost-found")
        .send({
            type: "found",
            title: "Blue steel water bottle",
            description:
                "Found a blue bottle with a dented cap near the library entrance.",
            category: "Personal items",
            location: "Central Library entrance",
            contact: "student@campusfix.test"
        })
        .expect(201);

    const lostItem = await rohan
        .post("/api/lost-found")
        .send({
            type: "lost",
            title: "Student ID card",
            description:
                "Lost my ID card somewhere between the canteen and Academic Block B.",
            category: "Documents",
            location: "Canteen to Academic Block B",
            occurredAt: new Date(
                Date.now() - 2 * 24 * 60 * 60 * 1000
            ).toISOString(),
            contact: "rohan@campusfix.test"
        })
        .expect(201);

    await student
        .patch(`/api/lost-found/${foundItem.body.item.id}/status`)
        .send({ status: "claimed" })
        .expect(200);

    await manager
        .post("/api/operations/inventory")
        .send({
            sku: "hdmi-2m",
            name: "HDMI cable 2m",
            category: "AV accessories",
            departmentId: departments.IT,
            location: "IT store room",
            quantity: 5,
            unit: "pieces",
            reorderLevel: 3,
            unitCost: 250
        })
        .expect(201);

    const wifiAp = await manager
        .post("/api/operations/inventory")
        .send({
            sku: "ap-ax3000",
            name: "Wi-Fi access point AX3000",
            category: "Network hardware",
            departmentId: departments.IT,
            location: "IT store room, shelf 2",
            quantity: 2,
            unit: "units",
            reorderLevel: 4,
            unitCost: 8900
        })
        .expect(201);

    await itStaff
        .post(
            `/api/operations/inventory/${wifiAp.body.item.id}/adjust`
        )
        .send({
            delta: -2,
            reason: "issue",
            note: "Installed in the library reading room."
        })
        .expect(200);

    await manager
        .post("/api/operations/inventory")
        .send({
            sku: "toner-cart",
            name: "Laser printer toner cartridge",
            category: "Print consumables",
            departmentId: departments.IT,
            location: "IT store room",
            quantity: 0,
            unit: "cartridges",
            reorderLevel: 2,
            unitCost: 3200
        })
        .expect(201);

    const overdueTask = await manager
        .post("/api/operations/maintenance")
        .send({
            title: "Inspect hostel B water pump",
            description:
                "Check pressure, clean the intake filter, and log the flow rate.",
            assetName: "Water pump WP-02",
            location: "Hostel B, pump room",
            departmentId: departments.IT,
            assignedTo: staffUser("Neha Singh").id,
            frequency: "monthly",
            nextDueAt: new Date(
                Date.now() - 2 * 24 * 60 * 60 * 1000
            ).toISOString(),
            priority: "High"
        })
        .expect(201);

    await manager
        .post("/api/operations/maintenance")
        .send({
            title: "Clean projector filters",
            description:
                "Clean filters and check lamp hours in Computer Lab 1.",
            assetName: "Projector PL-01",
            location: "IT Block, Computer Lab 1",
            departmentId: departments.IT,
            assignedTo: staffUser("Neha Singh").id,
            frequency: "weekly",
            nextDueAt: new Date(
                Date.now() + 2 * 24 * 60 * 60 * 1000
            ).toISOString(),
            priority: "Medium"
        })
        .expect(201);

    const completedTask = await manager
        .post("/api/operations/maintenance")
        .send({
            title: "Test emergency lighting",
            description:
                "Press-test all emergency lights in the academic block.",
            assetName: "Emergency lighting",
            location: "Academic Block B",
            departmentId: departments.IT,
            assignedTo: staffUser("Neha Singh").id,
            frequency: "monthly",
            nextDueAt: new Date(
                Date.now() + 10 * 24 * 60 * 60 * 1000
            ).toISOString(),
            priority: "Low"
        })
        .expect(201);

    await itStaff
        .post(
            `/api/operations/maintenance/${completedTask.body.task.id}/complete`
        )
        .send({
            note: "All fourteen units tested; two batteries replaced."
        })
        .expect(200);

    await database.pool.query(
        "UPDATE maintenance_tasks SET status = 'In Progress' WHERE id = $1",
        [overdueTask.body.task.id]
    );

    /* Anonymous complaint with a photo for complaint detail checks. */
    const anonymous = await student
        .post("/api/complaints")
        .send({
            title: "Broken bench near the sports ground",
            category: "Other",
            priority: "Medium",
            description:
                "One of the concrete benches beside the sports ground has a cracked leg and tips when someone sits on it.",
            location: "Sports ground, north stand",
            anonymous: true
        })
        .expect(201);

    await admin
        .post(`/api/complaints/${anonymous.body.complaint.id}/upvote`)
        .expect(200);

    console.log(
        `Services fixture: bookings=${pendingBooking.body.booking.id ? 4 : 0}, lostFound=2, inventory=3, maintenance=3`
    );

    await student
        .post("/api/chat/ai")
        .send({
            message: "How do I track the complaint I submitted?"
        })
        .expect(200);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

    console.log(`UI fixture ready at http://127.0.0.1:${PORT}`);
    console.log("Accounts (local only):");
    console.log(`  student@campusfix.test / ${PASSWORD}`);
    console.log(`  staff@campusfix.test / ${PASSWORD}`);
    console.log(`  manager@campusfix.test / ${PASSWORD}`);
    console.log(`  admin@campusfix.test / ${PASSWORD}`);
    console.log(`  complaints=${created.length}, references=${created.map((row) => row.referenceNumber).join(", ")}`);

    async function shutdown() {
        await new Promise((resolve) => server.close(resolve));
        await closeDatabase(database);
        await testDatabase.stop();
        process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
