const express = require("express");
const {
    and,
    asc,
    desc,
    eq,
    inArray,
    ne,
    or,
    sql
} = require("drizzle-orm");
const { z } = require("zod");

const {
    auditLogs,
    chats,
    complaintCategories,
    complaints,
    departments,
    notices,
    slaPolicies,
    users
} = require("../db/schema");
const {
    assignmentSchema,
    categoryCreateSchema,
    categoryUpdateSchema,
    departmentCreateSchema,
    departmentUpdateSchema,
    idParamSchema,
    listQuerySchema,
    noticeCreateSchema,
    noticeUpdateSchema,
    priorityUpdateSchema,
    slaUpdateSchema,
    statusUpdateSchema,
    userUpdateSchema,
    PRIORITIES
} = require("../lib/validation");
const { ApiError, notFound } = require("../lib/errors");
const {
    addHistory,
    addNotification,
    addHours,
    assertTransition,
    canManageDepartment,
    canUpdateStatus,
    canViewComplaint,
    getComplaintRow,
    getSlaHours,
    listComplaints,
    listHistory,
    listNotes,
    notifyDepartmentManagers,
    recordAudit,
    serializeComplaintRow,
    visibilityConditions
} = require("../lib/complaint-service");

const priorityParamSchema = z.object({
    priority: z.enum(PRIORITIES)
});

const auditQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

const userListQuerySchema = z.object({
    search: z.string().trim().max(200).optional(),
    role: z.enum([
        "student",
        "staff",
        "department_manager",
        "admin"
    ]).optional(),
    departmentId: z.uuid().optional()
});

function withUniqueError(error, message) {
    if (error && error.code === "23505") {
        throw new ApiError(409, message, "conflict");
    }

    throw error;
}

function csvCell(value) {
    if (value === null || value === undefined) {
        return '""';
    }

    let text =
        value instanceof Date
            ? value.toISOString()
            : String(value);

    if (/^[=+\-@\t\r]/.test(text)) {
        text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
}

function createAdminRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate, auth.requireOperations);

    router.get("/info", (req, res) => {
        res.json({ admin: auth.publicUser(req.user) });
    });

    router.get("/complaints", async (req, res) => {
        const input = listQuerySchema.parse(req.query);
        const result = await listComplaints(db, {
            user: req.user,
            input
        });

        res.json(result);
    });

    router.get("/complaints/:id", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!canViewComplaint(req.user, row)) {
            throw new ApiError(
                403,
                "You do not have access to this complaint",
                "forbidden"
            );
        }

        const [history, notes] = await Promise.all([
            listHistory(db, id),
            listNotes(db, id, true)
        ]);

        res.json({
            complaint: serializeComplaintRow(row, {
                includeCreatorEmail: true,
                includeAssigneeEmail: true
            }),
            history,
            notes,
            permissions: {
                canManage: canManageDepartment(req.user, row),
                canUpdateStatus: canUpdateStatus(req.user, row),
                canAssign: canManageDepartment(req.user, row)
            }
        });
    });

    router.put("/complaints/:id/status", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = statusUpdateSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!canUpdateStatus(req.user, row)) {
            throw new ApiError(
                403,
                "You cannot update this complaint",
                "forbidden"
            );
        }

        if (row.status === input.status) {
            throw new ApiError(
                400,
                `This complaint is already ${input.status}`,
                "status_unchanged"
            );
        }

        assertTransition(row.status, input.status);

        if (
            input.status === "Assigned" &&
            !row.assignedToId
        ) {
            throw new ApiError(
                400,
                "Assign a staff member before setting this status",
                "assignment_required"
            );
        }

        const now = new Date();
        const updates = { status: input.status };
        let historyMessage =
            input.note ||
            `Status changed from ${row.status} to ${input.status}.`;

        if (input.status === "Resolved") {
            updates.resolution = input.resolution;
            updates.resolvedAt = now;
            updates.rejectionReason = null;
            historyMessage =
                input.note ||
                "Complaint marked resolved with a resolution summary.";
        }

        if (input.status === "Rejected") {
            updates.rejectionReason = input.rejectionReason;
            historyMessage =
                input.note ||
                `Complaint rejected: ${input.rejectionReason}`;
        }

        if (input.status === "Reopened") {
            updates.reopenedAt = now;
            const slaHours = await getSlaHours(
                db,
                row.priority
            );
            updates.dueAt = addHours(now, slaHours);
        }

        await db.transaction(async (tx) => {
            await tx
                .update(complaints)
                .set(updates)
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType:
                    input.status === "Resolved"
                        ? "resolved"
                        : input.status === "Rejected"
                          ? "rejected"
                          : "status_changed",
                fromStatus: row.status,
                toStatus: input.status,
                message: historyMessage
            });

            if (row.createdById !== req.user.id) {
                await addNotification(tx, {
                    userId: row.createdById,
                    complaintId: id,
                    type: "status_changed",
                    title: `Complaint ${input.status.toLowerCase()}`,
                    message: `${row.referenceNumber}: ${historyMessage}`
                });
            }

            if (
                row.assignedToId &&
                row.assignedToId !== req.user.id
            ) {
                await addNotification(tx, {
                    userId: row.assignedToId,
                    complaintId: id,
                    type: "status_changed",
                    title: "Complaint status updated",
                    message: `${row.referenceNumber} is now ${input.status}.`
                });
            }

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "complaint.status_updated",
                entityType: "complaint",
                entityId: id,
                metadata: {
                    fromStatus: row.status,
                    toStatus: input.status
                }
            });
        });

        const updated = await getComplaintRow(db, id);

        res.json({
            message: "Complaint status updated successfully",
            complaint: serializeComplaintRow(updated, {
                includeCreatorEmail: true,
                includeAssigneeEmail: true
            })
        });
    });

    router.put("/complaints/:id/assignment", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = assignmentSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!canManageDepartment(req.user, row)) {
            throw new ApiError(
                403,
                "Only an administrator or the department manager can assign complaints",
                "forbidden"
            );
        }

        if (
            req.user.role === "department_manager" &&
            input.departmentId !== row.departmentId
        ) {
            throw new ApiError(
                403,
                "You can only assign within your department",
                "forbidden"
            );
        }

        const departmentRows = await db
            .select({
                id: departments.id,
                name: departments.name
            })
            .from(departments)
            .where(
                and(
                    eq(departments.id, input.departmentId),
                    eq(departments.isActive, true)
                )
            )
            .limit(1);

        if (departmentRows.length === 0) {
            throw new ApiError(
                400,
                "Selected department is unavailable",
                "invalid_department"
            );
        }

        let assignee = null;

        if (input.assignedToId) {
            const assigneeRows = await db
                .select({
                    id: users.id,
                    name: users.name,
                    role: users.role,
                    departmentId: users.departmentId
                })
                .from(users)
                .where(eq(users.id, input.assignedToId))
                .limit(1);

            assignee = assigneeRows[0];

            if (
                !assignee ||
                !["staff", "department_manager"].includes(
                    assignee.role
                ) ||
                assignee.departmentId !== input.departmentId
            ) {
                throw new ApiError(
                    400,
                    "Assign a staff member or manager from the selected department",
                    "invalid_assignee"
                );
            }
        }

        const nextStatus =
            assignee &&
            ["Pending", "Reopened"].includes(row.status)
                ? "Assigned"
                : !assignee && row.status === "Assigned"
                  ? "Pending"
                  : row.status;
        const now = new Date();

        await db.transaction(async (tx) => {
            await tx
                .update(complaints)
                .set({
                    departmentId: input.departmentId,
                    assignedTo: assignee ? assignee.id : null,
                    assignedBy: req.user.id,
                    assignedAt: assignee ? now : null,
                    status: nextStatus
                })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: assignee ? "assigned" : "unassigned",
                fromStatus: row.status,
                toStatus: nextStatus,
                message: assignee
                    ? `Assigned to ${assignee.name} (${departmentRows[0].name}).`
                    : "Complaint unassigned and returned to the department queue."
            });

            if (
                row.departmentId !== input.departmentId
            ) {
                await addHistory(tx, {
                    complaintId: id,
                    actorId: req.user.id,
                    eventType: "department_changed",
                    message: `Moved to ${departmentRows[0].name}.`
                });
            }

            if (
                assignee &&
                assignee.id !== req.user.id
            ) {
                await addNotification(tx, {
                    userId: assignee.id,
                    complaintId: id,
                    type: "complaint_assigned",
                    title: "Complaint assigned to you",
                    message: `${row.referenceNumber}: ${row.title}`
                });
            }

            if (row.createdById !== req.user.id) {
                await addNotification(tx, {
                    userId: row.createdById,
                    complaintId: id,
                    type: "assignment_changed",
                    title: "Complaint assignment updated",
                    message: assignee
                        ? `${row.referenceNumber} is assigned to ${assignee.name}.`
                        : `${row.referenceNumber} is back in the department queue.`
                });
            }

            if (
                row.departmentId !== input.departmentId
            ) {
                await notifyDepartmentManagers(
                    tx,
                    input.departmentId,
                    {
                        complaintId: id,
                        type: "complaint_assigned",
                        title: "Complaint moved to your department",
                        message: `${row.referenceNumber}: ${row.title}`
                    },
                    req.user.id
                );
            }

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "complaint.assignment_updated",
                entityType: "complaint",
                entityId: id,
                metadata: {
                    departmentId: input.departmentId,
                    assignedToId: assignee ? assignee.id : null
                }
            });
        });

        const updated = await getComplaintRow(db, id);

        res.json({
            message: assignee
                ? "Complaint assigned"
                : "Complaint unassigned",
            complaint: serializeComplaintRow(updated, {
                includeCreatorEmail: true,
                includeAssigneeEmail: true
            })
        });
    });

    router.put("/complaints/:id/priority", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = priorityUpdateSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!canManageDepartment(req.user, row)) {
            throw new ApiError(
                403,
                "Only an administrator or the department manager can change priority",
                "forbidden"
            );
        }

        const slaHours = await getSlaHours(db, input.priority);
        const dueAt = addHours(
            new Date(row.createdAt),
            slaHours
        );

        await db.transaction(async (tx) => {
            await tx
                .update(complaints)
                .set({
                    priority: input.priority,
                    dueAt
                })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: "priority_changed",
                message: `Priority changed from ${row.priority} to ${input.priority}.`
            });

            if (row.assignedToId) {
                await addNotification(tx, {
                    userId: row.assignedToId,
                    complaintId: id,
                    type: "priority_changed",
                    title: "Complaint priority updated",
                    message: `${row.referenceNumber} is now ${input.priority} priority.`
                });
            }

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "complaint.priority_updated",
                entityType: "complaint",
                entityId: id,
                metadata: {
                    fromPriority: row.priority,
                    toPriority: input.priority
                }
            });
        });

        const updated = await getComplaintRow(db, id);

        res.json({
            message: "Complaint priority updated",
            complaint: serializeComplaintRow(updated, {
                includeCreatorEmail: true,
                includeAssigneeEmail: true
            })
        });
    });

    router.delete(
        "/complaints/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const row = await getComplaintRow(db, id);

            if (!row) {
                throw notFound("Complaint not found");
            }

            await db.transaction(async (tx) => {
                await recordAudit(tx, {
                    actorId: req.user.id,
                    action: "complaint.deleted",
                    entityType: "complaint",
                    entityId: id,
                    metadata: {
                        referenceNumber: row.referenceNumber,
                        title: row.title,
                        status: row.status
                    }
                });

                await tx
                    .delete(complaints)
                    .where(eq(complaints.id, id));
            });

            res.json({
                message: "Complaint deleted successfully"
            });
        }
    );

    router.get("/stats", async (req, res) => {
        const scope = visibilityConditions(req.user);

        let summaryQuery = db
            .select({
                total: sql`count(*)::int`,
                pending:
                    sql`count(*) filter (where ${complaints.status} = 'Pending')::int`,
                assigned:
                    sql`count(*) filter (where ${complaints.status} = 'Assigned')::int`,
                inProgress:
                    sql`count(*) filter (where ${complaints.status} = 'In Progress')::int`,
                resolved:
                    sql`count(*) filter (where ${complaints.status} = 'Resolved')::int`,
                reopened:
                    sql`count(*) filter (where ${complaints.status} = 'Reopened')::int`,
                rejected:
                    sql`count(*) filter (where ${complaints.status} = 'Rejected')::int`,
                overdue:
                    sql`count(*) filter (where ${complaints.dueAt} < now() and ${complaints.status} not in ('Resolved', 'Rejected'))::int`,
                unassigned:
                    sql`count(*) filter (where ${complaints.assignedTo} is null and ${complaints.status} not in ('Resolved', 'Rejected'))::int`,
                averageResolutionHours:
                    sql`round((avg(extract(epoch from (${complaints.resolvedAt} - ${complaints.createdAt})) / 3600) filter (where ${complaints.status} = 'Resolved' and ${complaints.resolvedAt} is not null))::numeric, 1)`
            })
            .from(complaints);

        if (scope) {
            summaryQuery = summaryQuery.where(scope);
        }

        let distributionQuery = db
            .select({
                status: complaints.status,
                count: sql`count(*)::int`
            })
            .from(complaints);

        if (scope) {
            distributionQuery =
                distributionQuery.where(scope);
        }

        let departmentQuery = db
            .select({
                id: departments.id,
                name: departments.name,
                total: sql`count(${complaints.id})::int`,
                active:
                    sql`count(*) filter (where ${complaints.status} not in ('Resolved', 'Rejected'))::int`,
                resolved:
                    sql`count(*) filter (where ${complaints.status} = 'Resolved')::int`,
                overdue:
                    sql`count(*) filter (where ${complaints.dueAt} < now() and ${complaints.status} not in ('Resolved', 'Rejected'))::int`
            })
            .from(complaints)
            .innerJoin(
                departments,
                eq(complaints.departmentId, departments.id)
            );

        if (scope) {
            departmentQuery =
                departmentQuery.where(scope);
        }

        let staffQuery = db
            .select({
                id: users.id,
                name: users.name,
                total: sql`count(${complaints.id})::int`,
                active:
                    sql`count(*) filter (where ${complaints.status} not in ('Resolved', 'Rejected'))::int`,
                resolved:
                    sql`count(*) filter (where ${complaints.status} = 'Resolved')::int`,
                overdue:
                    sql`count(*) filter (where ${complaints.dueAt} < now() and ${complaints.status} not in ('Resolved', 'Rejected'))::int`
            })
            .from(complaints)
            .innerJoin(users, eq(complaints.assignedTo, users.id));

        if (scope) {
            staffQuery = staffQuery.where(scope);
        }

        const [summaryRows, distributionRows, departmentRows, staffRows] =
            await Promise.all([
                summaryQuery,
                distributionQuery.groupBy(complaints.status),
                departmentQuery
                    .groupBy(departments.id, departments.name)
                    .orderBy(asc(departments.name)),
                staffQuery
                    .groupBy(users.id, users.name)
                    .orderBy(asc(users.name))
            ]);

        const summary = summaryRows[0];

        res.json({
            total: Number(summary.total),
            pending: Number(summary.pending),
            assigned: Number(summary.assigned),
            inProgress: Number(summary.inProgress),
            resolved: Number(summary.resolved),
            reopened: Number(summary.reopened),
            rejected: Number(summary.rejected),
            overdue: Number(summary.overdue),
            unassigned: Number(summary.unassigned),
            averageResolutionHours:
                summary.averageResolutionHours === null
                    ? null
                    : Number(summary.averageResolutionHours),
            byStatus: distributionRows.map((row) => ({
                status: row.status,
                count: Number(row.count)
            })),
            departmentWorkload: departmentRows.map((row) => ({
                ...row,
                total: Number(row.total),
                active: Number(row.active),
                resolved: Number(row.resolved),
                overdue: Number(row.overdue)
            })),
            staffWorkload: staffRows.map((row) => ({
                ...row,
                total: Number(row.total),
                active: Number(row.active),
                resolved: Number(row.resolved),
                overdue: Number(row.overdue)
            }))
        });
    });

    router.get("/export", async (req, res) => {
        const input = listQuerySchema.parse(req.query);
        const result = await listComplaints(db, {
            user: req.user,
            input: {
                ...input,
                page: 1,
                pageSize: 5000
            }
        });
        const header = [
            "Reference",
            "Title",
            "Category",
            "Department",
            "Priority",
            "Status",
            "Created by",
            "Assigned to",
            "Location",
            "Submitted at",
            "Due at",
            "Resolved at"
        ];
        const lines = [header.map(csvCell).join(",")];

        for (const complaint of result.complaints) {
            lines.push(
                [
                    complaint.referenceNumber,
                    complaint.title,
                    complaint.category,
                    complaint.department.name,
                    complaint.priority,
                    complaint.status,
                    complaint.createdBy.name,
                    complaint.assignedTo
                        ? complaint.assignedTo.name
                        : "",
                    complaint.location,
                    complaint.createdAt,
                    complaint.dueAt,
                    complaint.resolvedAt
                ]
                    .map(csvCell)
                    .join(",")
            );
        }

        const filename = `campusfix-complaints-${new Date()
            .toISOString()
            .slice(0, 10)}.csv`;

        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
            "Content-Type",
            "text/csv; charset=utf-8"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );
        res.send(lines.join("\r\n"));
    });

    router.get("/departments", async (req, res) => {
        const rows = await db
            .select()
            .from(departments)
            .orderBy(asc(departments.name));

        res.json({ departments: rows });
    });

    router.post(
        "/departments",
        auth.requireAdmin,
        async (req, res) => {
            const input = departmentCreateSchema.parse(req.body);
            let created;

            try {
                const rows = await db
                    .insert(departments)
                    .values({
                        code: input.code,
                        name: input.name,
                        description: input.description,
                        contactEmail:
                            input.contactEmail || null,
                        isActive: input.isActive
                    })
                    .returning();

                created = rows[0];
            } catch (error) {
                withUniqueError(
                    error,
                    "A department with this code or name already exists"
                );
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "department.created",
                entityType: "department",
                entityId: created.id,
                metadata: {
                    code: created.code,
                    name: created.name
                }
            });

            res.status(201).json({
                message: "Department created",
                department: created
            });
        }
    );

    router.patch(
        "/departments/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const input = departmentUpdateSchema.parse(req.body);

            if (Object.keys(input).length === 0) {
                throw new ApiError(
                    400,
                    "No department changes supplied",
                    "empty_update"
                );
            }

            let updated;

            try {
                const rows = await db
                    .update(departments)
                    .set(input)
                    .where(eq(departments.id, id))
                    .returning();

                updated = rows[0];
            } catch (error) {
                withUniqueError(
                    error,
                    "A department with this name already exists"
                );
            }

            if (!updated) {
                throw notFound("Department not found");
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "department.updated",
                entityType: "department",
                entityId: id,
                metadata: {
                    fields: Object.keys(input)
                }
            });

            res.json({
                message: "Department updated",
                department: updated
            });
        }
    );

    router.get("/categories", async (req, res) => {
        const rows = await db
            .select({
                id: complaintCategories.id,
                name: complaintCategories.name,
                departmentId:
                    complaintCategories.departmentId,
                departmentName: departments.name,
                isActive: complaintCategories.isActive,
                sortOrder: complaintCategories.sortOrder,
                createdAt: complaintCategories.createdAt,
                updatedAt: complaintCategories.updatedAt
            })
            .from(complaintCategories)
            .innerJoin(
                departments,
                eq(
                    complaintCategories.departmentId,
                    departments.id
                )
            )
            .orderBy(
                asc(complaintCategories.sortOrder),
                asc(complaintCategories.name)
            );

        res.json({ categories: rows });
    });

    router.post(
        "/categories",
        auth.requireAdmin,
        async (req, res) => {
            const input = categoryCreateSchema.parse(req.body);
            let created;

            try {
                const rows = await db
                    .insert(complaintCategories)
                    .values(input)
                    .returning();

                created = rows[0];
            } catch (error) {
                withUniqueError(
                    error,
                    "A category with this name already exists"
                );
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "category.created",
                entityType: "category",
                entityId: created.id,
                metadata: { name: created.name }
            });

            res.status(201).json({
                message: "Category created",
                category: created
            });
        }
    );

    router.patch(
        "/categories/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const input = categoryUpdateSchema.parse(req.body);

            if (Object.keys(input).length === 0) {
                throw new ApiError(
                    400,
                    "No category changes supplied",
                    "empty_update"
                );
            }

            let updated;

            try {
                const rows = await db
                    .update(complaintCategories)
                    .set(input)
                    .where(eq(complaintCategories.id, id))
                    .returning();

                updated = rows[0];
            } catch (error) {
                withUniqueError(
                    error,
                    "A category with this name already exists"
                );
            }

            if (!updated) {
                throw notFound("Category not found");
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "category.updated",
                entityType: "category",
                entityId: id,
                metadata: {
                    fields: Object.keys(input)
                }
            });

            res.json({
                message: "Category updated",
                category: updated
            });
        }
    );

    router.get("/sla", async (req, res) => {
        const rows = await db
            .select()
            .from(slaPolicies)
            .orderBy(asc(slaPolicies.priority));

        res.json({ sla: rows });
    });

    router.put(
        "/sla/:priority",
        auth.requireAdmin,
        async (req, res) => {
            const { priority } = priorityParamSchema.parse(
                req.params
            );
            const input = slaUpdateSchema.parse(req.body);
            const rows = await db
                .update(slaPolicies)
                .set({ responseHours: input.responseHours })
                .where(eq(slaPolicies.priority, priority))
                .returning();

            if (rows.length === 0) {
                throw notFound("SLA policy not found");
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "sla.updated",
                entityType: "sla_policy",
                entityId: priority,
                metadata: {
                    responseHours: input.responseHours
                }
            });

            res.json({
                message: "SLA policy updated",
                sla: rows[0]
            });
        }
    );

    router.get("/staff", async (req, res) => {
        const departmentId = z
            .uuid()
            .optional()
            .parse(req.query.departmentId || undefined);
        const conditions = [
            inArray(users.role, [
                "staff",
                "department_manager",
                "admin"
            ])
        ];

        if (req.user.role !== "admin") {
            conditions.push(
                eq(users.departmentId, req.user.departmentId)
            );
        } else if (departmentId) {
            conditions.push(
                eq(users.departmentId, departmentId)
            );
        }

        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                role: users.role,
                departmentId: users.departmentId,
                departmentName: departments.name
            })
            .from(users)
            .leftJoin(
                departments,
                eq(users.departmentId, departments.id)
            )
            .where(and(...conditions))
            .orderBy(asc(users.name));

        res.json({ staff: rows });
    });

    router.get(
        "/users",
        auth.requireAdmin,
        async (req, res) => {
            const input = userListQuerySchema.parse(req.query);
            const conditions = [];

            if (input.role) {
                conditions.push(eq(users.role, input.role));
            }

            if (input.departmentId) {
                conditions.push(
                    eq(users.departmentId, input.departmentId)
                );
            }

            if (input.search) {
                const pattern = `%${input.search}%`;
                conditions.push(
                    sql`(${users.name} ILIKE ${pattern} OR ${users.email} ILIKE ${pattern})`
                );
            }

            let query = db
                .select({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    role: users.role,
                    departmentId: users.departmentId,
                    departmentName: departments.name,
                    createdAt: users.createdAt
                })
                .from(users)
                .leftJoin(
                    departments,
                    eq(users.departmentId, departments.id)
                );

            if (conditions.length) {
                query = query.where(and(...conditions));
            }

            const rows = await query
                .orderBy(asc(users.name))
                .limit(500);

            res.json({ users: rows });
        }
    );

    router.patch(
        "/users/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const input = userUpdateSchema.parse(req.body);

            if (id === req.user.id && input.role !== "admin") {
                throw new ApiError(
                    400,
                    "You cannot remove your own administrator access",
                    "self_demotion_blocked"
                );
            }

            const targetRows = await db
                .select()
                .from(users)
                .where(eq(users.id, id))
                .limit(1);
            const target = targetRows[0];

            if (!target) {
                throw notFound("User not found");
            }

            if (target.role === "admin" && input.role !== "admin") {
                const countRows = await db
                    .select({ count: sql`count(*)::int` })
                    .from(users)
                    .where(eq(users.role, "admin"));

                if (Number(countRows[0].count) <= 1) {
                    throw new ApiError(
                        400,
                        "At least one administrator account is required",
                        "last_admin"
                    );
                }
            }

            if (input.departmentId) {
                const departmentRows = await db
                    .select({ id: departments.id })
                    .from(departments)
                    .where(
                        and(
                            eq(departments.id, input.departmentId),
                            eq(departments.isActive, true)
                        )
                    )
                    .limit(1);

                if (departmentRows.length === 0) {
                    throw new ApiError(
                        400,
                        "Selected department is unavailable",
                        "invalid_department"
                    );
                }
            }

            const departmentId = [
                "staff",
                "department_manager"
            ].includes(input.role)
                ? input.departmentId || null
                : null;

            const rows = await db
                .update(users)
                .set({
                    role: input.role,
                    departmentId
                })
                .where(eq(users.id, id))
                .returning({
                    id: users.id,
                    name: users.name,
                    role: users.role,
                    departmentId: users.departmentId
                });

            await recordAudit(db, {
                actorId: req.user.id,
                action: "user.role_updated",
                entityType: "user",
                entityId: id,
                metadata: {
                    previousRole: target.role,
                    role: input.role,
                    departmentId
                }
            });

            res.json({
                message: "User access updated",
                user: rows[0]
            });
        }
    );

    router.get(
        "/audit",
        auth.requireAdmin,
        async (req, res) => {
            const input = auditQuerySchema.parse(req.query);
            const offset =
                (input.page - 1) * input.pageSize;

            const [rows, countRows] = await Promise.all([
                db
                    .select({
                        id: auditLogs.id,
                        action: auditLogs.action,
                        entityType: auditLogs.entityType,
                        entityId: auditLogs.entityId,
                        metadata: auditLogs.metadata,
                        createdAt: auditLogs.createdAt,
                        actorId: auditLogs.actorId,
                        actorName: users.name
                    })
                    .from(auditLogs)
                    .leftJoin(
                        users,
                        eq(auditLogs.actorId, users.id)
                    )
                    .orderBy(desc(auditLogs.createdAt))
                    .limit(input.pageSize)
                    .offset(offset),
                db
                    .select({ count: sql`count(*)::int` })
                    .from(auditLogs)
            ]);

            res.json({
                logs: rows,
                pagination: {
                    page: input.page,
                    pageSize: input.pageSize,
                    total: Number(countRows[0].count),
                    totalPages: Math.ceil(
                        Number(countRows[0].count) /
                            input.pageSize
                    )
                }
            });
        }
    );

    router.get("/notices", async (req, res) => {
        const rows = await db
            .select()
            .from(notices)
            .orderBy(desc(notices.publishedAt))
            .limit(200);

        res.json({ notices: rows });
    });

    router.post(
        "/notices",
        auth.requireAdmin,
        async (req, res) => {
            const input = noticeCreateSchema.parse(req.body);
            const rows = await db
                .insert(notices)
                .values({
                    title: input.title,
                    body: input.body,
                    audience: input.audience,
                    priority: input.priority,
                    publishedAt:
                        input.publishedAt || new Date(),
                    expiresAt: input.expiresAt || null,
                    createdBy: req.user.id
                })
                .returning();

            await recordAudit(db, {
                actorId: req.user.id,
                action: "notice.created",
                entityType: "notice",
                entityId: rows[0].id,
                metadata: { title: rows[0].title }
            });

            res.status(201).json({
                message: "Notice published",
                notice: rows[0]
            });
        }
    );

    router.patch(
        "/notices/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const input = noticeUpdateSchema.parse(req.body);
            const existingRows = await db
                .select()
                .from(notices)
                .where(eq(notices.id, id))
                .limit(1);
            const existing = existingRows[0];

            if (!existing) {
                throw notFound("Notice not found");
            }

            if (Object.keys(input).length === 0) {
                throw new ApiError(
                    400,
                    "No notice changes supplied",
                    "empty_update"
                );
            }

            const publishedAt =
                input.publishedAt || existing.publishedAt;
            const expiresAt =
                input.expiresAt === undefined
                    ? existing.expiresAt
                    : input.expiresAt;

            if (
                expiresAt &&
                new Date(expiresAt).getTime() <=
                    new Date(publishedAt).getTime()
            ) {
                throw new ApiError(
                    400,
                    "Expiry must be after the publish time",
                    "invalid_expiry"
                );
            }

            const rows = await db
                .update(notices)
                .set(input)
                .where(eq(notices.id, id))
                .returning();

            await recordAudit(db, {
                actorId: req.user.id,
                action: "notice.updated",
                entityType: "notice",
                entityId: id,
                metadata: {
                    fields: Object.keys(input)
                }
            });

            res.json({
                message: "Notice updated",
                notice: rows[0]
            });
        }
    );

    router.delete(
        "/notices/:id",
        auth.requireAdmin,
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const rows = await db
                .delete(notices)
                .where(eq(notices.id, id))
                .returning({ id: notices.id });

            if (rows.length === 0) {
                throw notFound("Notice not found");
            }

            await recordAudit(db, {
                actorId: req.user.id,
                action: "notice.deleted",
                entityType: "notice",
                entityId: id
            });

            res.json({ message: "Notice deleted" });
        }
    );

    return router;
}

function createUsersRouter({ db, auth }) {
    const router = express.Router();
    const operationsRoles = [
        "admin",
        "department_manager",
        "staff"
    ];

    router.get("/", auth.authenticate, async (req, res) => {
        if (req.user.role !== "student") {
            // Operations users can only reply to people who have already
            // started a conversation with them. This avoids exposing the
            // student directory and prevents unsolicited messaging.
            const contacts = await db
                .selectDistinct({
                    id: users.id,
                    name: users.name,
                    role: users.role,
                    departmentName: departments.name
                })
                .from(users)
                .leftJoin(
                    departments,
                    eq(users.departmentId, departments.id)
                )
                .innerJoin(
                    chats,
                    or(
                        and(
                            eq(chats.senderId, req.user.id),
                            eq(chats.receiverId, users.id)
                        ),
                        and(
                            eq(chats.receiverId, req.user.id),
                            eq(chats.senderId, users.id)
                        )
                    )
                )
                .where(ne(users.id, req.user.id))
                .orderBy(asc(users.name));

            return res.json({ users: contacts });
        }

        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                role: users.role,
                departmentName: departments.name
            })
            .from(users)
            .leftJoin(
                departments,
                eq(users.departmentId, departments.id)
            )
            .where(inArray(users.role, operationsRoles))
            .orderBy(asc(users.name));

        res.json({ users: rows });
    });

    return router;
}

module.exports = {
    createAdminRouter,
    createUsersRouter,
    csvCell
};
