const express = require("express");
const {
    and,
    asc,
    desc,
    eq,
    gt,
    gte,
    ilike,
    inArray,
    lt,
    lte,
    ne,
    or,
    sql
} = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const { z } = require("zod");

const {
    departments,
    facilities,
    facilityBookings,
    inventoryItems,
    inventoryTransactions,
    lostFoundItems,
    maintenanceLogs,
    maintenanceTasks,
    users
} = require("../db/schema");
const {
    bookingCreateSchema,
    bookingReviewSchema,
    bookingsQuerySchema,
    facilityCreateSchema,
    facilityUpdateSchema,
    inventoryAdjustSchema,
    inventoryCreateSchema,
    inventoryQuerySchema,
    inventoryUpdateSchema,
    lostFoundCreateSchema,
    lostFoundQuerySchema,
    lostFoundStatusSchema,
    maintenanceCompleteSchema,
    maintenanceCreateSchema,
    maintenanceQuerySchema,
    maintenanceUpdateSchema
} = require("../lib/validation");
const { ApiError, notFound } = require("../lib/errors");
const {
    isAdmin,
    isOperations,
    recordAudit,
    addNotification
} = require("../lib/complaint-service");

const booker = alias(users, "facility_booker");
const reviewer = alias(users, "facility_reviewer");
const reporter = alias(users, "lost_found_reporter");
const claimedUser = alias(users, "lost_found_claimed");
const taskAssignee = alias(users, "maintenance_assignee");
const taskCreator = alias(users, "maintenance_creator");

function pagination(total, page, pageSize) {
    return {
        page,
        pageSize,
        total,
        totalPages:
            total === 0 ? 0 : Math.ceil(total / pageSize)
    };
}

function optionalBoolean(value) {
    return (
        value === true ||
        value === "true" ||
        value === "1"
    );
}

function addFrequency(date, frequency) {
    const next = new Date(date.getTime());

    if (frequency === "daily") {
        next.setUTCDate(next.getUTCDate() + 1);
    } else if (frequency === "weekly") {
        next.setUTCDate(next.getUTCDate() + 7);
    } else if (frequency === "monthly") {
        next.setUTCMonth(next.getUTCMonth() + 1);
    } else if (frequency === "quarterly") {
        next.setUTCMonth(next.getUTCMonth() + 3);
    } else if (frequency === "yearly") {
        next.setUTCFullYear(next.getUTCFullYear() + 1);
    }

    return next;
}

async function notifyFacilityReviewers(
    tx,
    facility,
    payload,
    exceptUserId
) {
    const conditions = [eq(users.role, "admin")];

    if (facility.departmentId) {
        conditions.push(
            and(
                eq(users.role, "department_manager"),
                eq(users.departmentId, facility.departmentId)
            )
        );
    }

    const reviewers = await tx
        .select({ id: users.id })
        .from(users)
        .where(or(...conditions));

    const sent = new Set();

    for (const person of reviewers) {
        if (person.id === exceptUserId || sent.has(person.id)) {
            continue;
        }

        sent.add(person.id);
        await addNotification(tx, {
            ...payload,
            userId: person.id,
            complaintId: null
        });
    }
}

function bookingScope(user) {
    if (isAdmin(user)) {
        return null;
    }

    return or(
        eq(facilities.departmentId, user.departmentId),
        eq(facilityBookings.departmentId, user.departmentId)
    );
}

function canReviewBooking(user, facility) {
    if (isAdmin(user)) {
        return true;
    }

    return Boolean(
        user.role === "department_manager" &&
            user.departmentId &&
            facility.departmentId === user.departmentId
    );
}

function bookingFields() {
    return {
        id: facilityBookings.id,
        title: facilityBookings.title,
        purpose: facilityBookings.purpose,
        startsAt: facilityBookings.startsAt,
        endsAt: facilityBookings.endsAt,
        attendees: facilityBookings.attendees,
        status: facilityBookings.status,
        decisionNote: facilityBookings.decisionNote,
        reviewedAt: facilityBookings.reviewedAt,
        createdAt: facilityBookings.createdAt,
        facilityId: facilities.id,
        facilityCode: facilities.code,
        facilityName: facilities.name,
        facilityLocation: facilities.location,
        facilityCapacity: facilities.capacity,
        facilityOpensAt: facilities.opensAt,
        facilityClosesAt: facilities.closesAt,
        facilityDepartmentId: facilities.departmentId,
        departmentId: facilityBookings.departmentId,
        bookerId: booker.id,
        bookerName: booker.name,
        bookerEmail: booker.email,
        reviewerName: reviewer.name
    };
}

function selectBookings(db) {
    return db
        .select(bookingFields())
        .from(facilityBookings)
        .innerJoin(
            facilities,
            eq(facilityBookings.facilityId, facilities.id)
        )
        .innerJoin(
            booker,
            eq(facilityBookings.bookedBy, booker.id)
        )
        .leftJoin(
            reviewer,
            eq(facilityBookings.reviewedBy, reviewer.id)
        );
}

function serializeBooking(row) {
    return {
        id: row.id,
        title: row.title,
        purpose: row.purpose,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        attendees: row.attendees,
        status: row.status,
        decisionNote: row.decisionNote,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewerName || null,
        createdAt: row.createdAt,
        facility: {
            id: row.facilityId,
            code: row.facilityCode,
            name: row.facilityName,
            location: row.facilityLocation,
            capacity: row.facilityCapacity,
            opensAt: row.facilityOpensAt,
            closesAt: row.facilityClosesAt,
            departmentId: row.facilityDepartmentId
        },
        departmentId: row.departmentId,
        bookedBy: {
            id: row.bookerId,
            name: row.bookerName,
            email: row.bookerEmail
        }
    };
}

function facilityFields() {
    return {
        id: facilities.id,
        code: facilities.code,
        name: facilities.name,
        description: facilities.description,
        location: facilities.location,
        capacity: facilities.capacity,
        departmentId: facilities.departmentId,
        departmentName: departments.name,
        opensAt: facilities.opensAt,
        closesAt: facilities.closesAt,
        isActive: facilities.isActive,
        createdAt: facilities.createdAt
    };
}

function createFacilitiesRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    router.get("/", async (req, res) => {
        const includeInactive =
            isAdmin(req.user) &&
            optionalBoolean(req.query.includeInactive);

        let query = db
            .select(facilityFields())
            .from(facilities)
            .leftJoin(
                departments,
                eq(facilities.departmentId, departments.id)
            );

        if (!includeInactive) {
            query = query.where(eq(facilities.isActive, true));
        }

        const rows = await query.orderBy(asc(facilities.name));

        res.json({ facilities: rows });
    });

    router.get("/bookings/mine", async (req, res) => {
        const input = bookingsQuerySchema.parse(req.query);
        const conditions = [
            eq(facilityBookings.bookedBy, req.user.id)
        ];

        if (input.status) {
            conditions.push(
                eq(facilityBookings.status, input.status)
            );
        }

        if (input.facilityId) {
            conditions.push(
                eq(facilityBookings.facilityId, input.facilityId)
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                or(
                    ilike(facilityBookings.title, pattern),
                    ilike(facilities.name, pattern),
                    ilike(facilityBookings.purpose, pattern)
                )
            );
        }

        const offset = (input.page - 1) * input.pageSize;
        const [rows, countRows] = await Promise.all([
            selectBookings(db)
                .where(and(...conditions))
                .orderBy(desc(facilityBookings.startsAt))
                .limit(input.pageSize)
                .offset(offset),
            db
                .select({ count: sql`count(*)::int` })
                .from(facilityBookings)
                .innerJoin(
                    facilities,
                    eq(facilityBookings.facilityId, facilities.id)
                )
                .where(and(...conditions))
        ]);

        res.json({
            bookings: rows.map(serializeBooking),
            pagination: pagination(
                Number(countRows[0].count),
                input.page,
                input.pageSize
            )
        });
    });

    router.get("/bookings", async (req, res) => {
        if (!isOperations(req.user)) {
            throw new ApiError(
                403,
                "Only campus operations can review bookings",
                "forbidden"
            );
        }

        const input = bookingsQuerySchema.parse(req.query);
        const conditions = [];
        const scope = bookingScope(req.user);

        if (scope) {
            conditions.push(scope);
        }

        if (input.status) {
            conditions.push(
                eq(facilityBookings.status, input.status)
            );
        }

        if (input.facilityId) {
            conditions.push(
                eq(facilityBookings.facilityId, input.facilityId)
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                or(
                    ilike(facilityBookings.title, pattern),
                    ilike(facilities.name, pattern),
                    ilike(booker.name, pattern),
                    ilike(booker.email, pattern)
                )
            );
        }

        const where = conditions.length
            ? and(...conditions)
            : undefined;
        const offset = (input.page - 1) * input.pageSize;

        let rowsQuery = selectBookings(db);
        let countQuery = db
            .select({ count: sql`count(*)::int` })
            .from(facilityBookings)
            .innerJoin(
                facilities,
                eq(facilityBookings.facilityId, facilities.id)
            )
            .innerJoin(
                booker,
                eq(facilityBookings.bookedBy, booker.id)
            );

        if (where) {
            rowsQuery = rowsQuery.where(where);
            countQuery = countQuery.where(where);
        }

        const [rows, countRows] = await Promise.all([
            rowsQuery
                .orderBy(
                    asc(facilityBookings.status),
                    asc(facilityBookings.startsAt)
                )
                .limit(input.pageSize)
                .offset(offset),
            countQuery
        ]);

        res.json({
            bookings: rows.map(serializeBooking),
            pagination: pagination(
                Number(countRows[0].count),
                input.page,
                input.pageSize
            )
        });
    });

    router.post("/bookings", async (req, res) => {
        const input = bookingCreateSchema.parse(req.body);
        const facilityRows = await db
            .select()
            .from(facilities)
            .where(eq(facilities.id, input.facilityId))
            .limit(1);
        const facility = facilityRows[0];

        if (!facility || !facility.isActive) {
            throw new ApiError(
                400,
                "Select an active facility",
                "invalid_facility"
            );
        }

        if (input.attendees > facility.capacity) {
            throw new ApiError(
                400,
                `${facility.name} can host at most ${facility.capacity} people`,
                "capacity_exceeded"
            );
        }

        const bookingId = await db.transaction(async (tx) => {
            await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtext(${facility.id}::text))`
            );

            const conflicts = await tx
                .select({ id: facilityBookings.id })
                .from(facilityBookings)
                .where(
                    and(
                        eq(
                            facilityBookings.facilityId,
                            facility.id
                        ),
                        inArray(facilityBookings.status, [
                            "Pending",
                            "Approved"
                        ]),
                        lt(
                            facilityBookings.startsAt,
                            input.endsAt
                        ),
                        gt(
                            facilityBookings.endsAt,
                            input.startsAt
                        )
                    )
                )
                .limit(1);

            if (conflicts.length > 0) {
                throw new ApiError(
                    409,
                    "That facility is already requested or booked for this time",
                    "booking_conflict"
                );
            }

            const rows = await tx
                .insert(facilityBookings)
                .values({
                    facilityId: facility.id,
                    bookedBy: req.user.id,
                    departmentId: req.user.departmentId || null,
                    title: input.title,
                    purpose: input.purpose || "",
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                    attendees: input.attendees,
                    status: "Pending"
                })
                .returning({ id: facilityBookings.id });

            await notifyFacilityReviewers(
                tx,
                facility,
                {
                    type: "booking_requested",
                    title: "New facility booking request",
                    message: `${facility.name} · ${input.title}`
                },
                req.user.id
            );

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "facility_booking_requested",
                entityType: "facility_booking",
                entityId: rows[0].id,
                metadata: {
                    facilityId: facility.id,
                    startsAt: input.startsAt.toISOString(),
                    endsAt: input.endsAt.toISOString()
                }
            });

            return rows[0].id;
        });

        const rows = await selectBookings(db)
            .where(eq(facilityBookings.id, bookingId))
            .limit(1);

        res.status(201).json({
            message: "Booking request submitted",
            booking: serializeBooking(rows[0])
        });
    });

    router.patch("/bookings/:id/review", async (req, res) => {
        const id = z.uuid("Invalid booking").parse(req.params.id);
        const input = bookingReviewSchema.parse(req.body);
        const rows = await selectBookings(db)
            .where(eq(facilityBookings.id, id))
            .limit(1);
        const row = rows[0];

        if (!row) {
            throw notFound("Booking not found");
        }

        const facilityRows = await db
            .select()
            .from(facilities)
            .where(eq(facilities.id, row.facilityId))
            .limit(1);
        const facility = facilityRows[0];

        if (!canReviewBooking(req.user, facility)) {
            throw new ApiError(
                403,
                "You cannot review this booking",
                "forbidden"
            );
        }

        if (row.status !== "Pending") {
            throw new ApiError(
                409,
                "Only pending bookings can be reviewed",
                "booking_already_reviewed"
            );
        }

        await db.transaction(async (tx) => {
            if (input.status === "Approved") {
                await tx.execute(
                    sql`SELECT pg_advisory_xact_lock(hashtext(${row.facilityId}::text))`
                );

                const conflicts = await tx
                    .select({ id: facilityBookings.id })
                    .from(facilityBookings)
                    .where(
                        and(
                            eq(
                                facilityBookings.facilityId,
                                row.facilityId
                            ),
                            eq(
                                facilityBookings.status,
                                "Approved"
                            ),
                            ne(facilityBookings.id, id),
                            lt(
                                facilityBookings.startsAt,
                                row.endsAt
                            ),
                            gt(
                                facilityBookings.endsAt,
                                row.startsAt
                            )
                        )
                    )
                    .limit(1);

                if (conflicts.length > 0) {
                    throw new ApiError(
                        409,
                        "Another approved booking overlaps this time",
                        "booking_conflict"
                    );
                }
            }

            await tx
                .update(facilityBookings)
                .set({
                    status: input.status,
                    reviewedBy: req.user.id,
                    reviewedAt: new Date(),
                    decisionNote: input.note || null
                })
                .where(eq(facilityBookings.id, id));

            await addNotification(tx, {
                userId: row.bookerId,
                complaintId: null,
                type: "booking_reviewed",
                title:
                    input.status === "Approved"
                        ? "Facility booking approved"
                        : "Facility booking rejected",
                message: `${row.facilityName} · ${row.title}${
                    input.note ? ` — ${input.note}` : ""
                }`
            });

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "facility_booking_reviewed",
                entityType: "facility_booking",
                entityId: id,
                metadata: {
                    status: input.status,
                    note: input.note || null
                }
            });
        });

        const updated = await selectBookings(db)
            .where(eq(facilityBookings.id, id))
            .limit(1);

        res.json({
            message: `Booking ${input.status.toLowerCase()}`,
            booking: serializeBooking(updated[0])
        });
    });

    router.post("/bookings/:id/cancel", async (req, res) => {
        const id = z.uuid("Invalid booking").parse(req.params.id);
        const rows = await selectBookings(db)
            .where(eq(facilityBookings.id, id))
            .limit(1);
        const row = rows[0];

        if (!row) {
            throw notFound("Booking not found");
        }

        const facilityRows = await db
            .select()
            .from(facilities)
            .where(eq(facilities.id, row.facilityId))
            .limit(1);
        const facility = facilityRows[0];
        const allowed =
            row.bookerId === req.user.id ||
            canReviewBooking(req.user, facility);

        if (!allowed) {
            throw new ApiError(
                403,
                "You cannot cancel this booking",
                "forbidden"
            );
        }

        if (!["Pending", "Approved"].includes(row.status)) {
            throw new ApiError(
                409,
                "This booking can no longer be cancelled",
                "booking_not_cancellable"
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .update(facilityBookings)
                .set({
                    status: "Cancelled",
                    decisionNote: "Cancelled by request."
                })
                .where(eq(facilityBookings.id, id));

            await addNotification(tx, {
                userId: row.bookerId,
                complaintId: null,
                type: "booking_cancelled",
                title: "Facility booking cancelled",
                message: `${row.facilityName} · ${row.title}`
            });

            await notifyFacilityReviewers(
                tx,
                facility,
                {
                    type: "booking_cancelled",
                    title: "Facility booking cancelled",
                    message: `${row.facilityName} · ${row.title}`
                },
                req.user.id
            );

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "facility_booking_cancelled",
                entityType: "facility_booking",
                entityId: id,
                metadata: {}
            });
        });

        res.json({ message: "Booking cancelled" });
    });

    router.post("/", async (req, res) => {
        if (!isAdmin(req.user)) {
            throw new ApiError(
                403,
                "Only administrators can add facilities",
                "forbidden"
            );
        }

        const input = facilityCreateSchema.parse(req.body);

        try {
            const rows = await db
                .insert(facilities)
                .values({
                    code: input.code,
                    name: input.name,
                    description: input.description || "",
                    location: input.location,
                    capacity: input.capacity,
                    departmentId: input.departmentId || null,
                    opensAt: input.opensAt,
                    closesAt: input.closesAt,
                    isActive: input.isActive
                })
                .returning({ id: facilities.id });

            await recordAudit(db, {
                actorId: req.user.id,
                action: "facility_created",
                entityType: "facility",
                entityId: rows[0].id,
                metadata: { code: input.code, name: input.name }
            });

            res.status(201).json({
                message: "Facility created",
                facility: { id: rows[0].id }
            });
        } catch (error) {
            if (error.code === "23505") {
                throw new ApiError(
                    409,
                    "A facility with that code or name already exists",
                    "facility_exists"
                );
            }

            throw error;
        }
    });

    router.patch("/:id", async (req, res) => {
        if (!isAdmin(req.user)) {
            throw new ApiError(
                403,
                "Only administrators can edit facilities",
                "forbidden"
            );
        }

        const id = z.uuid("Invalid facility").parse(req.params.id);
        const input = facilityUpdateSchema.parse(req.body);
        const updates = {};

        for (const field of [
            "name",
            "description",
            "location",
            "capacity",
            "opensAt",
            "closesAt",
            "isActive"
        ]) {
            if (input[field] !== undefined) {
                updates[field] = input[field];
            }
        }

        if (input.departmentId !== undefined) {
            updates.departmentId = input.departmentId || null;
        }

        if (Object.keys(updates).length === 0) {
            throw new ApiError(
                400,
                "No changes were supplied",
                "no_changes"
            );
        }

        const rows = await db
            .update(facilities)
            .set(updates)
            .where(eq(facilities.id, id))
            .returning({ id: facilities.id });

        if (rows.length === 0) {
            throw notFound("Facility not found");
        }

        await recordAudit(db, {
            actorId: req.user.id,
            action: "facility_updated",
            entityType: "facility",
            entityId: id,
            metadata: { fields: Object.keys(updates) }
        });

        res.json({ message: "Facility updated" });
    });

    return router;
}

function lostFoundFields() {
    return {
        id: lostFoundItems.id,
        type: lostFoundItems.type,
        title: lostFoundItems.title,
        description: lostFoundItems.description,
        category: lostFoundItems.category,
        location: lostFoundItems.location,
        occurredAt: lostFoundItems.occurredAt,
        status: lostFoundItems.status,
        contact: lostFoundItems.contact,
        createdAt: lostFoundItems.createdAt,
        reporterId: lostFoundItems.reporterId,
        reporterName: reporter.name,
        claimedById: lostFoundItems.claimedBy,
        claimedByName: claimedUser.name
    };
}

function serializeLostFound(row) {
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        category: row.category,
        location: row.location,
        occurredAt: row.occurredAt,
        status: row.status,
        contact: row.contact,
        createdAt: row.createdAt,
        reporter: row.reporterId
            ? {
                  id: row.reporterId,
                  name: row.reporterName
              }
            : null,
        claimedBy: row.claimedById
            ? {
                  id: row.claimedById,
                  name: row.claimedByName
              }
            : null
    };
}

function createLostFoundRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    router.get("/", async (req, res) => {
        const input = lostFoundQuerySchema.parse(req.query);
        const conditions = [];

        if (input.type) {
            conditions.push(eq(lostFoundItems.type, input.type));
        }

        if (input.status) {
            conditions.push(
                eq(lostFoundItems.status, input.status)
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                or(
                    ilike(lostFoundItems.title, pattern),
                    ilike(lostFoundItems.description, pattern),
                    ilike(lostFoundItems.location, pattern),
                    ilike(lostFoundItems.category, pattern)
                )
            );
        }

        const where = conditions.length
            ? and(...conditions)
            : undefined;
        const offset = (input.page - 1) * input.pageSize;

        let rowsQuery = db
            .select(lostFoundFields())
            .from(lostFoundItems)
            .leftJoin(
                reporter,
                eq(lostFoundItems.reporterId, reporter.id)
            )
            .leftJoin(
                claimedUser,
                eq(lostFoundItems.claimedBy, claimedUser.id)
            );
        let countQuery = db
            .select({ count: sql`count(*)::int` })
            .from(lostFoundItems);

        if (where) {
            rowsQuery = rowsQuery.where(where);
            countQuery = countQuery.where(where);
        }

        const [rows, countRows] = await Promise.all([
            rowsQuery
                .orderBy(
                    asc(lostFoundItems.status),
                    desc(lostFoundItems.occurredAt)
                )
                .limit(input.pageSize)
                .offset(offset),
            countQuery
        ]);

        res.json({
            items: rows.map(serializeLostFound),
            pagination: pagination(
                Number(countRows[0].count),
                input.page,
                input.pageSize
            )
        });
    });

    router.post("/", async (req, res) => {
        const input = lostFoundCreateSchema.parse(req.body);
        const occurredAt = input.occurredAt || new Date();

        if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
            throw new ApiError(
                400,
                "The date cannot be in the future",
                "invalid_date"
            );
        }

        const rows = await db
            .insert(lostFoundItems)
            .values({
                reporterId: req.user.id,
                type: input.type,
                title: input.title,
                description: input.description,
                category: input.category,
                location: input.location,
                occurredAt,
                contact: input.contact || "",
                status: "open"
            })
            .returning();

        await recordAudit(db, {
            actorId: req.user.id,
            action: "lost_found_reported",
            entityType: "lost_found",
            entityId: rows[0].id,
            metadata: { type: input.type, title: input.title }
        });

        const hydrated = await db
            .select(lostFoundFields())
            .from(lostFoundItems)
            .leftJoin(
                reporter,
                eq(lostFoundItems.reporterId, reporter.id)
            )
            .leftJoin(
                claimedUser,
                eq(lostFoundItems.claimedBy, claimedUser.id)
            )
            .where(eq(lostFoundItems.id, rows[0].id))
            .limit(1);

        res.status(201).json({
            message: "Item reported",
            item: serializeLostFound(hydrated[0])
        });
    });

    router.patch("/:id/status", async (req, res) => {
        const id = z.uuid("Invalid item").parse(req.params.id);
        const input = lostFoundStatusSchema.parse(req.body);
        const rows = await db
            .select()
            .from(lostFoundItems)
            .where(eq(lostFoundItems.id, id))
            .limit(1);
        const item = rows[0];

        if (!item) {
            throw notFound("Item not found");
        }

        if (
            item.reporterId !== req.user.id &&
            !isOperations(req.user)
        ) {
            throw new ApiError(
                403,
                "You cannot update this item",
                "forbidden"
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .update(lostFoundItems)
                .set({
                    status: input.status,
                    claimedBy:
                        input.status === "claimed"
                            ? item.claimedBy || req.user.id
                            : item.claimedBy
                })
                .where(eq(lostFoundItems.id, id));

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "lost_found_status_changed",
                entityType: "lost_found",
                entityId: id,
                metadata: {
                    from: item.status,
                    to: input.status
                }
            });
        });

        const updated = await db
            .select(lostFoundFields())
            .from(lostFoundItems)
            .leftJoin(
                reporter,
                eq(lostFoundItems.reporterId, reporter.id)
            )
            .leftJoin(
                claimedUser,
                eq(lostFoundItems.claimedBy, claimedUser.id)
            )
            .where(eq(lostFoundItems.id, id))
            .limit(1);

        res.json({
            message: "Item updated",
            item: serializeLostFound(updated[0])
        });
    });

    router.delete("/:id", async (req, res) => {
        const id = z.uuid("Invalid item").parse(req.params.id);
        const rows = await db
            .select()
            .from(lostFoundItems)
            .where(eq(lostFoundItems.id, id))
            .limit(1);
        const item = rows[0];

        if (!item) {
            throw notFound("Item not found");
        }

        if (
            item.reporterId !== req.user.id &&
            !isAdmin(req.user)
        ) {
            throw new ApiError(
                403,
                "You cannot delete this item",
                "forbidden"
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .delete(lostFoundItems)
                .where(eq(lostFoundItems.id, id));

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "lost_found_deleted",
                entityType: "lost_found",
                entityId: id,
                metadata: { title: item.title }
            });
        });

        res.json({ message: "Item removed" });
    });

    return router;
}

function inventoryScope(user) {
    if (isAdmin(user)) {
        return null;
    }

    return eq(inventoryItems.departmentId, user.departmentId);
}

function serializeInventory(row) {
    return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        departmentId: row.departmentId,
        departmentName: row.departmentName || null,
        location: row.location,
        quantity: row.quantity,
        unit: row.unit,
        reorderLevel: row.reorderLevel,
        unitCost:
            row.unitCost === null || row.unitCost === undefined
                ? null
                : Number(row.unitCost),
        notes: row.notes,
        isActive: row.isActive,
        lowStock: row.quantity <= row.reorderLevel,
        updatedAt: row.updatedAt
    };
}

function canManageInventory(user) {
    return ["admin", "department_manager"].includes(user.role);
}

function createOperationsRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);
    router.use((req, res, next) => {
        if (!isOperations(req.user)) {
            return next(
                new ApiError(
                    403,
                    "Campus operations access is required",
                    "forbidden"
                )
            );
        }

        return next();
    });

    router.get("/inventory", async (req, res) => {
        const input = inventoryQuerySchema.parse(req.query);
        const conditions = [];
        const scope = inventoryScope(req.user);

        if (scope) {
            conditions.push(scope);
        }

        if (input.departmentId && isAdmin(req.user)) {
            conditions.push(
                eq(inventoryItems.departmentId, input.departmentId)
            );
        }

        if (!optionalBoolean(input.includeInactive)) {
            conditions.push(eq(inventoryItems.isActive, true));
        }

        if (optionalBoolean(input.lowOnly)) {
            conditions.push(
                lte(
                    inventoryItems.quantity,
                    inventoryItems.reorderLevel
                )
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                or(
                    ilike(inventoryItems.name, pattern),
                    ilike(inventoryItems.sku, pattern),
                    ilike(inventoryItems.category, pattern),
                    ilike(inventoryItems.location, pattern)
                )
            );
        }

        const where = conditions.length
            ? and(...conditions)
            : undefined;
        const offset = (input.page - 1) * input.pageSize;

        let rowsQuery = db
            .select({
                id: inventoryItems.id,
                sku: inventoryItems.sku,
                name: inventoryItems.name,
                category: inventoryItems.category,
                departmentId: inventoryItems.departmentId,
                departmentName: departments.name,
                location: inventoryItems.location,
                quantity: inventoryItems.quantity,
                unit: inventoryItems.unit,
                reorderLevel: inventoryItems.reorderLevel,
                unitCost: inventoryItems.unitCost,
                notes: inventoryItems.notes,
                isActive: inventoryItems.isActive,
                updatedAt: inventoryItems.updatedAt
            })
            .from(inventoryItems)
            .leftJoin(
                departments,
                eq(inventoryItems.departmentId, departments.id)
            );
        let countQuery = db
            .select({ count: sql`count(*)::int` })
            .from(inventoryItems);

        if (where) {
            rowsQuery = rowsQuery.where(where);
            countQuery = countQuery.where(where);
        }

        let summaryQuery = db
            .select({
                total: sql`count(*)::int`,
                lowStock:
                    sql`count(*) filter (where ${inventoryItems.quantity} <= ${inventoryItems.reorderLevel})::int`,
                outOfStock:
                    sql`count(*) filter (where ${inventoryItems.quantity} = 0)::int`
            })
            .from(inventoryItems);

        if (where) {
            summaryQuery = summaryQuery.where(where);
        }

        const [rows, countRows, summaryRows] = await Promise.all([
            rowsQuery
                .orderBy(
                    asc(inventoryItems.name),
                    asc(inventoryItems.category)
                )
                .limit(input.pageSize)
                .offset(offset),
            countQuery,
            summaryQuery
        ]);

        const items = rows.map(serializeInventory);

        res.json({
            items,
            summary: {
                total: Number(summaryRows[0].total),
                lowStock: Number(summaryRows[0].lowStock),
                outOfStock: Number(summaryRows[0].outOfStock)
            },
            pagination: pagination(
                Number(countRows[0].count),
                input.page,
                input.pageSize
            )
        });
    });

    router.post("/inventory", async (req, res) => {
        if (!canManageInventory(req.user)) {
            throw new ApiError(
                403,
                "Only managers and administrators can add stock",
                "forbidden"
            );
        }

        const input = inventoryCreateSchema.parse(req.body);
        const sku = input.sku
            ? input.sku.trim().toUpperCase()
            : null;
        const departmentId = isAdmin(req.user)
            ? input.departmentId || null
            : req.user.departmentId;

        try {
            const rows = await db
                .insert(inventoryItems)
                .values({
                    sku,
                    name: input.name,
                    category: input.category,
                    departmentId,
                    location: input.location || "",
                    quantity: input.quantity,
                    unit: input.unit,
                    reorderLevel: input.reorderLevel,
                    unitCost:
                        input.unitCost === undefined
                            ? null
                            : String(input.unitCost),
                    notes: input.notes || "",
                    isActive: input.isActive
                })
                .returning();

            await recordAudit(db, {
                actorId: req.user.id,
                action: "inventory_item_created",
                entityType: "inventory_item",
                entityId: rows[0].id,
                metadata: {
                    name: input.name,
                    quantity: input.quantity
                }
            });

            res.status(201).json({
                message: "Inventory item created",
                item: serializeInventory(rows[0])
            });
        } catch (error) {
            if (error.code === "23505") {
                throw new ApiError(
                    409,
                    "An item with that SKU already exists",
                    "sku_exists"
                );
            }

            throw error;
        }
    });

    router.patch("/inventory/:id", async (req, res) => {
        if (!canManageInventory(req.user)) {
            throw new ApiError(
                403,
                "Only managers and administrators can edit stock",
                "forbidden"
            );
        }

        const id = z.uuid("Invalid item").parse(req.params.id);
        const input = inventoryUpdateSchema.parse(req.body);
        const rows = await db
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, id))
            .limit(1);
        const item = rows[0];

        if (!item) {
            throw notFound("Inventory item not found");
        }

        if (
            !isAdmin(req.user) &&
            item.departmentId !== req.user.departmentId
        ) {
            throw new ApiError(
                403,
                "This item belongs to another department",
                "forbidden"
            );
        }

        const updates = {};

        for (const field of [
            "name",
            "category",
            "location",
            "unit",
            "reorderLevel",
            "notes",
            "isActive"
        ]) {
            if (input[field] !== undefined) {
                updates[field] = input[field];
            }
        }

        if (input.sku !== undefined) {
            updates.sku = input.sku
                ? input.sku.toUpperCase()
                : null;
        }

        if (input.departmentId !== undefined) {
            updates.departmentId = isAdmin(req.user)
                ? input.departmentId || null
                : req.user.departmentId;
        }

        if (input.unitCost !== undefined) {
            updates.unitCost =
                input.unitCost === null
                    ? null
                    : String(input.unitCost);
        }

        if (Object.keys(updates).length === 0) {
            throw new ApiError(
                400,
                "No changes were supplied",
                "no_changes"
            );
        }

        try {
            const updated = await db
                .update(inventoryItems)
                .set(updates)
                .where(eq(inventoryItems.id, id))
                .returning();

            await recordAudit(db, {
                actorId: req.user.id,
                action: "inventory_item_updated",
                entityType: "inventory_item",
                entityId: id,
                metadata: { fields: Object.keys(updates) }
            });

            res.json({
                message: "Inventory item updated",
                item: serializeInventory(updated[0])
            });
        } catch (error) {
            if (error.code === "23505") {
                throw new ApiError(
                    409,
                    "An item with that SKU already exists",
                    "sku_exists"
                );
            }

            throw error;
        }
    });

    router.post("/inventory/:id/adjust", async (req, res) => {
        const id = z.uuid("Invalid item").parse(req.params.id);
        const input = inventoryAdjustSchema.parse(req.body);
        const item = await db.transaction(async (tx) => {
            const rows = await tx
                .select()
                .from(inventoryItems)
                .where(eq(inventoryItems.id, id))
                .limit(1)
                .for("update");
            const current = rows[0];

            if (!current) {
                throw notFound("Inventory item not found");
            }

            if (
                !isAdmin(req.user) &&
                current.departmentId !== req.user.departmentId
            ) {
                throw new ApiError(
                    403,
                    "This item belongs to another department",
                    "forbidden"
                );
            }

            const nextQuantity = current.quantity + input.delta;

            if (nextQuantity < 0) {
                throw new ApiError(
                    400,
                    "That adjustment would make the stock negative",
                    "negative_stock"
                );
            }

            await tx
                .insert(inventoryTransactions)
                .values({
                    itemId: id,
                    actorId: req.user.id,
                    delta: input.delta,
                    reason: input.reason,
                    note: input.note || ""
                });

            const updated = await tx
                .update(inventoryItems)
                .set({ quantity: nextQuantity })
                .where(eq(inventoryItems.id, id))
                .returning();

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "inventory_adjusted",
                entityType: "inventory_item",
                entityId: id,
                metadata: {
                    delta: input.delta,
                    reason: input.reason,
                    quantity: nextQuantity
                }
            });

            return updated[0];
        });

        res.json({
            message: "Stock adjusted",
            item: serializeInventory(item)
        });
    });

    router.get(
        "/inventory/:id/transactions",
        async (req, res) => {
            const id = z
                .uuid("Invalid item")
                .parse(req.params.id);
            const rows = await db
                .select()
                .from(inventoryItems)
                .where(eq(inventoryItems.id, id))
                .limit(1);
            const item = rows[0];

            if (!item) {
                throw notFound("Inventory item not found");
            }

            if (
                !isAdmin(req.user) &&
                item.departmentId !== req.user.departmentId
            ) {
                throw new ApiError(
                    403,
                    "This item belongs to another department",
                    "forbidden"
                );
            }

            const transactions = await db
                .select({
                    id: inventoryTransactions.id,
                    delta: inventoryTransactions.delta,
                    reason: inventoryTransactions.reason,
                    note: inventoryTransactions.note,
                    createdAt: inventoryTransactions.createdAt,
                    actorName: users.name
                })
                .from(inventoryTransactions)
                .leftJoin(
                    users,
                    eq(inventoryTransactions.actorId, users.id)
                )
                .where(eq(inventoryTransactions.itemId, id))
                .orderBy(desc(inventoryTransactions.createdAt))
                .limit(100);

            res.json({ transactions });
        }
    );

    function maintenanceScope(user) {
        if (isAdmin(user)) {
            return null;
        }

        return eq(maintenanceTasks.departmentId, user.departmentId);
    }

    function serializeMaintenance(row, now) {
        const nextDue = row.nextDueAt
            ? new Date(row.nextDueAt)
            : null;
        const isOverdue = Boolean(
            nextDue &&
                nextDue.getTime() < now &&
                !["Completed", "Cancelled"].includes(row.status)
        );

        return {
            id: row.id,
            title: row.title,
            description: row.description,
            assetName: row.assetName,
            location: row.location,
            departmentId: row.departmentId,
            departmentName: row.departmentName || null,
            assignedTo: row.assignedToId
                ? {
                      id: row.assignedToId,
                      name: row.assignedToName
                  }
                : null,
            frequency: row.frequency,
            nextDueAt: row.nextDueAt,
            lastCompletedAt: row.lastCompletedAt,
            status: row.status,
            priority: row.priority,
            isOverdue,
            createdBy: row.createdById
                ? {
                      id: row.createdById,
                      name: row.createdByName
                  }
                : null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        };
    }

    function maintenanceSelect(db) {
        return db
            .select({
                id: maintenanceTasks.id,
                title: maintenanceTasks.title,
                description: maintenanceTasks.description,
                assetName: maintenanceTasks.assetName,
                location: maintenanceTasks.location,
                departmentId: maintenanceTasks.departmentId,
                departmentName: departments.name,
                assignedToId: maintenanceTasks.assignedTo,
                assignedToName: taskAssignee.name,
                frequency: maintenanceTasks.frequency,
                nextDueAt: maintenanceTasks.nextDueAt,
                lastCompletedAt:
                    maintenanceTasks.lastCompletedAt,
                status: maintenanceTasks.status,
                priority: maintenanceTasks.priority,
                createdById: maintenanceTasks.createdBy,
                createdByName: taskCreator.name,
                createdAt: maintenanceTasks.createdAt,
                updatedAt: maintenanceTasks.updatedAt
            })
            .from(maintenanceTasks)
            .leftJoin(
                departments,
                eq(maintenanceTasks.departmentId, departments.id)
            )
            .leftJoin(
                taskAssignee,
                eq(maintenanceTasks.assignedTo, taskAssignee.id)
            )
            .leftJoin(
                taskCreator,
                eq(maintenanceTasks.createdBy, taskCreator.id)
            );
    }

    router.get("/maintenance", async (req, res) => {
        const input = maintenanceQuerySchema.parse(req.query);
        const conditions = [];
        const scope = maintenanceScope(req.user);
        const now = new Date();

        if (scope) {
            conditions.push(scope);
        }

        if (input.status) {
            conditions.push(eq(maintenanceTasks.status, input.status));
        }

        if (optionalBoolean(input.overdue)) {
            conditions.push(
                and(
                    lt(maintenanceTasks.nextDueAt, now),
                    inArray(maintenanceTasks.status, [
                        "Scheduled",
                        "In Progress"
                    ])
                )
            );
        }

        if (optionalBoolean(input.dueSoon)) {
            conditions.push(
                and(
                    gte(maintenanceTasks.nextDueAt, now),
                    lte(
                        maintenanceTasks.nextDueAt,
                        new Date(
                            now.getTime() + 7 * 24 * 60 * 60 * 1000
                        )
                    ),
                    inArray(maintenanceTasks.status, [
                        "Scheduled",
                        "In Progress"
                    ])
                )
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                or(
                    ilike(maintenanceTasks.title, pattern),
                    ilike(maintenanceTasks.assetName, pattern),
                    ilike(maintenanceTasks.location, pattern),
                    ilike(maintenanceTasks.description, pattern)
                )
            );
        }

        const where = conditions.length
            ? and(...conditions)
            : undefined;
        const offset = (input.page - 1) * input.pageSize;

        let rowsQuery = maintenanceSelect(db);
        let countQuery = db
            .select({ count: sql`count(*)::int` })
            .from(maintenanceTasks);

        if (where) {
            rowsQuery = rowsQuery.where(where);
            countQuery = countQuery.where(where);
        }

        let summaryQuery = db
            .select({
                total: sql`count(*)::int`,
                overdue:
                    sql`count(*) filter (where ${maintenanceTasks.nextDueAt} < now() and ${maintenanceTasks.status} in ('Scheduled', 'In Progress'))::int`,
                dueSoon:
                    sql`count(*) filter (where ${maintenanceTasks.nextDueAt} >= now() and ${maintenanceTasks.nextDueAt} <= now() + interval '7 days' and ${maintenanceTasks.status} in ('Scheduled', 'In Progress'))::int`
            })
            .from(maintenanceTasks);

        if (where) {
            summaryQuery = summaryQuery.where(where);
        }

        const [rows, countRows, summaryRows] = await Promise.all([
            rowsQuery
                .orderBy(
                    asc(maintenanceTasks.nextDueAt),
                    desc(maintenanceTasks.createdAt)
                )
                .limit(input.pageSize)
                .offset(offset),
            countQuery,
            summaryQuery
        ]);

        const tasks = rows.map((row) =>
            serializeMaintenance(row, now.getTime())
        );

        res.json({
            tasks,
            summary: {
                total: Number(summaryRows[0].total),
                overdue: Number(summaryRows[0].overdue),
                dueSoon: Number(summaryRows[0].dueSoon)
            },
            pagination: pagination(
                Number(countRows[0].count),
                input.page,
                input.pageSize
            )
        });
    });

    async function validateAssignee(db, assignedTo, departmentId, user) {
        if (!assignedTo) {
            return null;
        }

        const rows = await db
            .select({
                id: users.id,
                role: users.role,
                departmentId: users.departmentId
            })
            .from(users)
            .where(eq(users.id, assignedTo))
            .limit(1);
        const person = rows[0];

        if (!person || person.role === "student") {
            throw new ApiError(
                400,
                "Select a staff member to assign",
                "invalid_assignee"
            );
        }

        if (person.role === "admin") {
            return person.id;
        }

        if (
            !isAdmin(user) &&
            person.departmentId !== departmentId
        ) {
            throw new ApiError(
                400,
                "The assignee must belong to the same department",
                "invalid_assignee"
            );
        }

        return person.id;
    }

    router.post("/maintenance", async (req, res) => {
        if (!canManageInventory(req.user)) {
            throw new ApiError(
                403,
                "Only managers and administrators can schedule maintenance",
                "forbidden"
            );
        }

        const input = maintenanceCreateSchema.parse(req.body);
        const departmentId = isAdmin(req.user)
            ? input.departmentId || null
            : req.user.departmentId;
        const assignedTo = await validateAssignee(
            db,
            input.assignedTo,
            departmentId,
            req.user
        );

        const rows = await db
            .insert(maintenanceTasks)
            .values({
                title: input.title,
                description: input.description || "",
                assetName: input.assetName || "",
                location: input.location || "",
                departmentId,
                assignedTo,
                frequency: input.frequency,
                nextDueAt: input.nextDueAt,
                status: "Scheduled",
                priority: input.priority,
                createdBy: req.user.id
            })
            .returning({ id: maintenanceTasks.id });

        await recordAudit(db, {
            actorId: req.user.id,
            action: "maintenance_created",
            entityType: "maintenance_task",
            entityId: rows[0].id,
            metadata: {
                title: input.title,
                frequency: input.frequency
            }
        });

        res.status(201).json({
            message: "Maintenance task scheduled",
            task: { id: rows[0].id }
        });
    });

    router.patch("/maintenance/:id", async (req, res) => {
        const id = z.uuid("Invalid task").parse(req.params.id);
        const input = maintenanceUpdateSchema.parse(req.body);
        const rows = await db
            .select()
            .from(maintenanceTasks)
            .where(eq(maintenanceTasks.id, id))
            .limit(1);
        const task = rows[0];

        if (!task) {
            throw notFound("Maintenance task not found");
        }

        if (
            !canManageInventory(req.user) &&
            task.assignedTo !== req.user.id
        ) {
            throw new ApiError(
                403,
                "You cannot edit this maintenance task",
                "forbidden"
            );
        }

        if (
            !isAdmin(req.user) &&
            task.departmentId !== req.user.departmentId
        ) {
            throw new ApiError(
                403,
                "This task belongs to another department",
                "forbidden"
            );
        }

        if (
            !canManageInventory(req.user) &&
            input.status !== "In Progress"
        ) {
            throw new ApiError(
                403,
                "Assigned staff can only start a task",
                "forbidden"
            );
        }

        const departmentId =
            input.departmentId !== undefined
                ? isAdmin(req.user)
                    ? input.departmentId || null
                    : req.user.departmentId
                : task.departmentId;
        const updates = {};

        for (const field of [
            "title",
            "description",
            "assetName",
            "location",
            "frequency",
            "nextDueAt",
            "priority",
            "status"
        ]) {
            if (input[field] !== undefined) {
                updates[field] = input[field];
            }
        }

        if (
            input.departmentId !== undefined &&
            isAdmin(req.user)
        ) {
            updates.departmentId = departmentId;
        }

        if (input.assignedTo !== undefined) {
            updates.assignedTo = await validateAssignee(
                db,
                input.assignedTo,
                departmentId,
                req.user
            );
        }

        if (Object.keys(updates).length === 0) {
            throw new ApiError(
                400,
                "No changes were supplied",
                "no_changes"
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .update(maintenanceTasks)
                .set(updates)
                .where(eq(maintenanceTasks.id, id));

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "maintenance_updated",
                entityType: "maintenance_task",
                entityId: id,
                metadata: { fields: Object.keys(updates) }
            });
        });

        res.json({ message: "Maintenance task updated" });
    });

    router.post("/maintenance/:id/complete", async (req, res) => {
        const id = z.uuid("Invalid task").parse(req.params.id);
        const input = maintenanceCompleteSchema.parse(req.body);
        const rows = await db
            .select()
            .from(maintenanceTasks)
            .where(eq(maintenanceTasks.id, id))
            .limit(1);
        const task = rows[0];

        if (!task) {
            throw notFound("Maintenance task not found");
        }

        const allowed =
            isAdmin(req.user) ||
            task.assignedTo === req.user.id ||
            (req.user.role === "department_manager" &&
                task.departmentId === req.user.departmentId);

        if (!allowed) {
            throw new ApiError(
                403,
                "You cannot complete this task",
                "forbidden"
            );
        }

        if (task.status === "Cancelled") {
            throw new ApiError(
                409,
                "A cancelled task cannot be completed",
                "task_cancelled"
            );
        }

        const completedAt = new Date();
        const recurring = task.frequency !== "once";
        const nextDueAt = recurring
            ? addFrequency(completedAt, task.frequency)
            : task.nextDueAt;

        await db.transaction(async (tx) => {
            await tx
                .update(maintenanceTasks)
                .set({
                    lastCompletedAt: completedAt,
                    nextDueAt,
                    status: recurring ? "Scheduled" : "Completed"
                })
                .where(eq(maintenanceTasks.id, id));

            await tx.insert(maintenanceLogs).values({
                taskId: id,
                actorId: req.user.id,
                note: input.note || "",
                completedAt
            });

            if (
                task.createdBy &&
                task.createdBy !== req.user.id
            ) {
                await addNotification(tx, {
                    userId: task.createdBy,
                    complaintId: null,
                    type: "maintenance_completed",
                    title: "Maintenance completed",
                    message: task.title
                });
            }

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "maintenance_completed",
                entityType: "maintenance_task",
                entityId: id,
                metadata: {
                    frequency: task.frequency,
                    nextDueAt: nextDueAt.toISOString()
                }
            });
        });

        res.json({ message: "Maintenance completed" });
    });

    router.get(
        "/maintenance/:id/logs",
        async (req, res) => {
            const id = z
                .uuid("Invalid task")
                .parse(req.params.id);
            const rows = await db
                .select()
                .from(maintenanceTasks)
                .where(eq(maintenanceTasks.id, id))
                .limit(1);
            const task = rows[0];

            if (!task) {
                throw notFound("Maintenance task not found");
            }

            if (
                !isAdmin(req.user) &&
                task.departmentId !== req.user.departmentId
            ) {
                throw new ApiError(
                    403,
                    "This task belongs to another department",
                    "forbidden"
                );
            }

            const logs = await db
                .select({
                    id: maintenanceLogs.id,
                    note: maintenanceLogs.note,
                    completedAt: maintenanceLogs.completedAt,
                    actorName: users.name
                })
                .from(maintenanceLogs)
                .leftJoin(
                    users,
                    eq(maintenanceLogs.actorId, users.id)
                )
                .where(eq(maintenanceLogs.taskId, id))
                .orderBy(desc(maintenanceLogs.completedAt))
                .limit(50);

            res.json({ logs });
        }
    );

    return router;
}

module.exports = {
    createFacilitiesRouter,
    createLostFoundRouter,
    createOperationsRouter
};
