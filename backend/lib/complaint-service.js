const {
    and,
    asc,
    desc,
    eq,
    ilike,
    isNull,
    lt,
    or,
    sql
} = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");

const {
    auditLogs,
    complaintAttachments,
    complaintHistory,
    complaintNotes,
    complaints,
    complaintUpvotes,
    departments,
    notifications,
    slaPolicies,
    users
} = require("../db/schema");
const { ApiError } = require("./errors");

const creator = alias(users, "complaint_creator");
const assignee = alias(users, "complaint_assignee");

const CLOSED_STATUSES = ["Resolved", "Rejected"];
const STATUS_TRANSITIONS = Object.freeze({
    Pending: ["Assigned", "In Progress", "Rejected"],
    Assigned: ["In Progress", "Rejected"],
    "In Progress": ["Resolved", "Rejected"],
    Resolved: ["Reopened"],
    Reopened: ["Assigned", "In Progress", "Resolved", "Rejected"],
    Rejected: ["Reopened"]
});

function isOperations(user) {
    return Boolean(
        user &&
            ["staff", "department_manager", "admin"].includes(
                user.role
            )
    );
}

function isAdmin(user) {
    return Boolean(user && user.role === "admin");
}

function isOwner(user, row) {
    return Boolean(user && row && row.createdById === user.id);
}

function sameDepartment(user, row) {
    return Boolean(
        user &&
            user.departmentId &&
            row &&
            row.departmentId === user.departmentId
    );
}

function canViewComplaint(user, row) {
    if (!user || !row) {
        return false;
    }

    if (isOwner(user, row) || isAdmin(user)) {
        return true;
    }

    return (
        ["staff", "department_manager"].includes(user.role) &&
        sameDepartment(user, row)
    );
}

function canManageDepartment(user, row) {
    if (!user || !row) {
        return false;
    }

    if (isAdmin(user)) {
        return true;
    }

    return (
        user.role === "department_manager" &&
        sameDepartment(user, row)
    );
}

function canUpdateStatus(user, row) {
    if (canManageDepartment(user, row)) {
        return true;
    }

    return Boolean(
        user &&
            user.role === "staff" &&
            sameDepartment(user, row) &&
            row.assignedToId === user.id
    );
}

function complaintFields() {
    return {
        id: complaints.id,
        legacyMongoId: complaints.legacyMongoId,
        referenceNumber: complaints.referenceNumber,
        title: complaints.title,
        category: complaints.category,
        description: complaints.description,
        location: complaints.location,
        isAnonymous: complaints.isAnonymous,
        priority: complaints.priority,
        status: complaints.status,
        createdAt: complaints.createdAt,
        updatedAt: complaints.updatedAt,
        dueAt: complaints.dueAt,
        assignedAt: complaints.assignedAt,
        resolvedAt: complaints.resolvedAt,
        reopenedAt: complaints.reopenedAt,
        resolution: complaints.resolution,
        rejectionReason: complaints.rejectionReason,
        feedbackRating: complaints.feedbackRating,
        feedbackComment: complaints.feedbackComment,
        feedbackAt: complaints.feedbackAt,
        latitude: complaints.latitude,
        longitude: complaints.longitude,
        createdById: creator.id,
        createdByName: creator.name,
        createdByEmail: creator.email,
        departmentId: departments.id,
        departmentName: departments.name,
        departmentCode: departments.code,
        assignedToId: assignee.id,
        assignedToName: assignee.name,
        assignedToEmail: assignee.email,
        upvoteCount:
            sql`(SELECT count(*)::int FROM ${complaintUpvotes} WHERE ${complaintUpvotes.complaintId} = ${complaints.id})`
    };
}

function selectComplaints(db) {
    return db
        .select(complaintFields())
        .from(complaints)
        .innerJoin(
            creator,
            eq(complaints.createdBy, creator.id)
        )
        .innerJoin(
            departments,
            eq(complaints.departmentId, departments.id)
        )
        .leftJoin(
            assignee,
            eq(complaints.assignedTo, assignee.id)
        );
}

function serializeComplaintRow(row, options = {}) {
    const includeCreatorEmail =
        options.includeCreatorEmail || false;
    const includeAssigneeEmail =
        options.includeAssigneeEmail || false;
    const now = options.now || Date.now();
    const dueAt = row.dueAt ? new Date(row.dueAt) : null;
    const isOverdue =
        dueAt &&
        dueAt.getTime() < now &&
        !CLOSED_STATUSES.includes(row.status);
    const viewer = options.viewer || null;
    const identityVisible =
        !row.isAnonymous ||
        Boolean(viewer && viewer.id === row.createdById);

    return {
        id: row.id,
        referenceNumber: row.referenceNumber,
        title: row.title,
        category: row.category,
        description: row.description,
        location: row.location,
        priority: row.priority,
        status: row.status,
        priorityLabel: row.priority,
        isAnonymous: Boolean(row.isAnonymous),
        upvoteCount: Number(row.upvoteCount || 0),
        createdBy: {
            id: identityVisible ? row.createdById : null,
            name: identityVisible
                ? row.createdByName
                : "Anonymous",
            ...(includeCreatorEmail && identityVisible
                ? { email: row.createdByEmail }
                : {})
        },
        department: {
            id: row.departmentId,
            name: row.departmentName,
            code: row.departmentCode
        },
        assignedTo: row.assignedToId
            ? {
                  id: row.assignedToId,
                  name: row.assignedToName,
                  ...(includeAssigneeEmail
                      ? { email: row.assignedToEmail }
                      : {})
              }
            : null,
        assignedAt: row.assignedAt,
        dueAt: row.dueAt,
        isOverdue: Boolean(isOverdue),
        resolution: row.resolution,
        resolvedAt: row.resolvedAt,
        reopenedAt: row.reopenedAt,
        rejectionReason: row.rejectionReason,
        feedback:
            row.feedbackRating === null ||
            row.feedbackRating === undefined
                ? null
                : {
                      rating: row.feedbackRating,
                      comment: row.feedbackComment,
                      at: row.feedbackAt
                  },
        latitude: row.latitude,
        longitude: row.longitude,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

async function getComplaintRow(db, id) {
    const rows = await selectComplaints(db)
        .where(eq(complaints.id, id))
        .limit(1);

    return rows[0] || null;
}

async function getComplaintRowByReference(db, referenceNumber) {
    const rows = await selectComplaints(db)
        .where(eq(complaints.referenceNumber, referenceNumber))
        .limit(1);

    return rows[0] || null;
}

function pagination(total, page, pageSize) {
    return {
        page,
        pageSize,
        total,
        totalPages:
            total === 0 ? 0 : Math.ceil(total / pageSize)
    };
}

function visibilityConditions(user) {
    if (isAdmin(user)) {
        return null;
    }

    if (
        user &&
        ["staff", "department_manager"].includes(user.role) &&
        user.departmentId
    ) {
        return eq(complaints.departmentId, user.departmentId);
    }

    return eq(complaints.createdBy, user.id);
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, "\\$&");
}

function filterConditions(user, input, options = {}) {
    const conditions = [];

    if (options.ownOnly) {
        conditions.push(eq(complaints.createdBy, user.id));
    } else {
        const scope = visibilityConditions(user);

        if (scope) {
            conditions.push(scope);
        }
    }

    if (input.status) {
        conditions.push(eq(complaints.status, input.status));
    }

    if (input.priority) {
        conditions.push(eq(complaints.priority, input.priority));
    }

    if (input.category) {
        conditions.push(eq(complaints.category, input.category));
    }

    if (input.departmentId) {
        conditions.push(
            eq(complaints.departmentId, input.departmentId)
        );
    }

    if (input.assignedToId) {
        conditions.push(
            eq(complaints.assignedTo, input.assignedToId)
        );
    }

    if (input.unassigned === true) {
        conditions.push(isNull(complaints.assignedTo));
    }

    if (input.overdue === true) {
        conditions.push(
            and(
                lt(complaints.dueAt, new Date()),
                sql`${complaints.status} NOT IN ('Resolved', 'Rejected')`
            )
        );
    }

    if (input.search) {
        const pattern = `%${escapeLike(input.search)}%`;

        conditions.push(
            or(
                ilike(complaints.referenceNumber, pattern),
                ilike(complaints.title, pattern),
                ilike(complaints.description, pattern),
                ilike(complaints.location, pattern),
                ilike(complaints.category, pattern),
                and(
                    eq(complaints.isAnonymous, false),
                    or(
                        ilike(creator.name, pattern),
                        ilike(creator.email, pattern)
                    )
                )
            )
        );
    }

    return conditions;
}

function orderFor(sort) {
    const priorityRank = sql`CASE ${complaints.priority}
        WHEN 'Critical' THEN 0
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        ELSE 3
    END`;

    if (sort === "oldest") {
        return [asc(complaints.createdAt)];
    }

    if (sort === "priority") {
        return [priorityRank, desc(complaints.createdAt)];
    }

    if (sort === "due") {
        return [
            asc(complaints.dueAt),
            desc(complaints.createdAt)
        ];
    }

    return [desc(complaints.createdAt)];
}

async function listComplaints(db, { user, input, ownOnly = false }) {
    const conditions = filterConditions(user, input, {
        ownOnly
    });
    const where = conditions.length
        ? and(...conditions)
        : undefined;
    const offset = (input.page - 1) * input.pageSize;

    let rowsQuery = selectComplaints(db);

    if (where) {
        rowsQuery = rowsQuery.where(where);
    }

    let countQuery = db
        .select({ count: sql`count(*)::int` })
        .from(complaints)
        .innerJoin(
            creator,
            eq(complaints.createdBy, creator.id)
        );

    if (where) {
        countQuery = countQuery.where(where);
    }

    const [rows, countRows] = await Promise.all([
        rowsQuery
            .orderBy(...orderFor(input.sort))
            .limit(input.pageSize)
            .offset(offset),
        countQuery
    ]);
    const total = Number(countRows[0].count);
    const includeEmails = isOperations(user);

    return {
        complaints: rows.map((row) =>
            serializeComplaintRow(row, {
                includeCreatorEmail: includeEmails,
                includeAssigneeEmail: includeEmails,
                viewer: user
            })
        ),
        pagination: pagination(
            total,
            input.page,
            input.pageSize
        )
    };
}

async function listHistory(db, complaintId) {
    return db
        .select({
            id: complaintHistory.id,
            eventType: complaintHistory.eventType,
            fromStatus: complaintHistory.fromStatus,
            toStatus: complaintHistory.toStatus,
            message: complaintHistory.message,
            createdAt: complaintHistory.createdAt,
            actorId: complaintHistory.actorId,
            actorName: users.name
        })
        .from(complaintHistory)
        .leftJoin(
            users,
            eq(complaintHistory.actorId, users.id)
        )
        .where(eq(complaintHistory.complaintId, complaintId))
        .orderBy(asc(complaintHistory.createdAt));
}

async function listNotes(db, complaintId, includeInternal) {
    const conditions = [
        eq(complaintNotes.complaintId, complaintId)
    ];

    if (!includeInternal) {
        conditions.push(
            eq(complaintNotes.visibility, "public")
        );
    }

    return db
        .select({
            id: complaintNotes.id,
            message: complaintNotes.message,
            visibility: complaintNotes.visibility,
            createdAt: complaintNotes.createdAt,
            authorId: complaintNotes.authorId,
            authorName: users.name
        })
        .from(complaintNotes)
        .leftJoin(
            users,
            eq(complaintNotes.authorId, users.id)
        )
        .where(and(...conditions))
        .orderBy(asc(complaintNotes.createdAt));
}

async function listAttachments(db, complaintId) {
    return db
        .select({
            id: complaintAttachments.id,
            fileName: complaintAttachments.fileName,
            contentType: complaintAttachments.contentType,
            byteSize: complaintAttachments.byteSize,
            createdAt: complaintAttachments.createdAt,
            uploadedById: complaintAttachments.uploadedBy
        })
        .from(complaintAttachments)
        .where(
            eq(complaintAttachments.complaintId, complaintId)
        )
        .orderBy(asc(complaintAttachments.createdAt));
}

async function getAttachment(db, complaintId, attachmentId) {
    const rows = await db
        .select()
        .from(complaintAttachments)
        .where(
            and(
                eq(complaintAttachments.id, attachmentId),
                eq(complaintAttachments.complaintId, complaintId)
            )
        )
        .limit(1);

    return rows[0] || null;
}

async function getUpvoteState(db, complaintId, userId) {
    const [countRows, mineRows] = await Promise.all([
        db
            .select({
                count: sql`count(*)::int`
            })
            .from(complaintUpvotes)
            .where(
                eq(complaintUpvotes.complaintId, complaintId)
            ),
        userId
            ? db
                  .select({ id: complaintUpvotes.id })
                  .from(complaintUpvotes)
                  .where(
                      and(
                          eq(
                              complaintUpvotes.complaintId,
                              complaintId
                          ),
                          eq(complaintUpvotes.userId, userId)
                      )
                  )
                  .limit(1)
            : Promise.resolve([])
    ]);

    return {
        count: Number(countRows[0].count),
        hasUpvoted: mineRows.length > 0
    };
}

async function addHistory(
    db,
    {
        complaintId,
        actorId,
        eventType,
        fromStatus,
        toStatus,
        message
    }
) {
    await db.insert(complaintHistory).values({
        complaintId,
        actorId,
        eventType,
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        message: message || null
    });
}

async function addNotification(
    db,
    { userId, complaintId, type, title, message }
) {
    if (!userId) {
        return;
    }

    await db.insert(notifications).values({
        userId,
        complaintId: complaintId || null,
        type,
        title: String(title).slice(0, 200),
        message: String(message).slice(0, 1000)
    });
}

async function notifyDepartmentManagers(
    db,
    departmentId,
    payload,
    exceptUserId
) {
    const managers = await db
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                eq(users.departmentId, departmentId),
                eq(users.role, "department_manager")
            )
        );

    for (const manager of managers) {
        if (manager.id !== exceptUserId) {
            await addNotification(db, {
                ...payload,
                userId: manager.id
            });
        }
    }
}

async function recordAudit(
    db,
    { actorId, action, entityType, entityId, metadata }
) {
    await db.insert(auditLogs).values({
        actorId: actorId || null,
        action,
        entityType,
        entityId: entityId === null ? null : String(entityId),
        metadata: metadata || {}
    });
}

function assertTransition(fromStatus, toStatus) {
    if (fromStatus === toStatus) {
        return;
    }

    const allowed = STATUS_TRANSITIONS[fromStatus] || [];

    if (!allowed.includes(toStatus)) {
        throw new ApiError(
            400,
            `A complaint cannot move from ${fromStatus} to ${toStatus}`,
            "invalid_status_transition"
        );
    }
}

async function getSlaHours(db, priority) {
    const rows = await db
        .select({ responseHours: slaPolicies.responseHours })
        .from(slaPolicies)
        .where(eq(slaPolicies.priority, priority))
        .limit(1);

    return rows[0] ? rows[0].responseHours : 72;
}

function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function complaintSummaryText(row) {
    return `${row.referenceNumber} · ${row.title}`;
}

module.exports = {
    STATUS_TRANSITIONS,
    CLOSED_STATUSES,
    isOperations,
    isAdmin,
    isOwner,
    sameDepartment,
    canViewComplaint,
    canManageDepartment,
    canUpdateStatus,
    complaintFields,
    selectComplaints,
    serializeComplaintRow,
    getComplaintRow,
    getComplaintRowByReference,
    listComplaints,
    listHistory,
    listNotes,
    listAttachments,
    getAttachment,
    getUpvoteState,
    pagination,
    addHistory,
    addNotification,
    notifyDepartmentManagers,
    recordAudit,
    assertTransition,
    getSlaHours,
    addHours,
    complaintSummaryText,
    visibilityConditions
};
