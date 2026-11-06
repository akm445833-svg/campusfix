const path = require("node:path");

const express = require("express");
const {
    and,
    desc,
    eq,
    ilike,
    ne,
    or,
    sql
} = require("drizzle-orm");
const { z } = require("zod");

const {
    complaintAttachments,
    complaintCategories,
    complaintNotes,
    complaintUpvotes,
    complaints,
    departments,
    slaPolicies,
    users
} = require("../db/schema");
const {
    attachmentSchema,
    complaintCreateSchema,
    feedbackSchema,
    reopenSchema,
    commentSchema,
    listQuerySchema,
    idParamSchema
} = require("../lib/validation");
const { ApiError, notFound } = require("../lib/errors");
const {
    canManageDepartment,
    canViewComplaint,
    isOperations,
    isOwner,
    canUpdateStatus,
    getComplaintRow,
    listComplaints,
    listHistory,
    listNotes,
    listAttachments,
    getAttachment,
    getUpvoteState,
    serializeComplaintRow,
    addHistory,
    addNotification,
    notifyDepartmentManagers,
    recordAudit,
    getSlaHours,
    addHours
} = require("../lib/complaint-service");

const REOPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENTS = 3;

function safeFileName(value, contentType) {
    const fallback =
        contentType === "image/png"
            ? "photo.png"
            : contentType === "image/webp"
              ? "photo.webp"
              : "photo.jpg";
    const base = path
        .basename(String(value || ""))
        .replace(/[^A-Za-z0-9._ -]/g, "_")
        .replace(/^\.+/, "")
        .trim()
        .slice(0, 200);

    return base || fallback;
}

function decodeImage(input) {
    const compact = input.dataBase64.replace(/\s+/g, "");

    if (
        compact.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
    ) {
        throw new ApiError(
            400,
            "Image data is not valid base64",
            "invalid_image"
        );
    }

    const buffer = Buffer.from(compact, "base64");

    if (buffer.length === 0 || buffer.length > 800000) {
        throw new ApiError(
            400,
            "Image must be smaller than 800 KB",
            "image_too_large"
        );
    }

    const isJpeg =
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;
    const isPng =
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;
    const isWebp =
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";

    const detected = isJpeg
        ? "image/jpeg"
        : isPng
          ? "image/png"
          : isWebp
            ? "image/webp"
            : null;

    if (!detected || detected !== input.contentType) {
        throw new ApiError(
            400,
            "Upload a JPEG, PNG or WebP image",
            "unsupported_image"
        );
    }

    return {
        buffer,
        byteSize: buffer.length,
        contentType: detected
    };
}

function maskAnonymousPeople(row, ownerVisible, history, notes) {
    if (!row.isAnonymous || ownerVisible) {
        return;
    }

    for (const entry of [...history, ...notes]) {
        if (entry.actorId === row.createdById) {
            entry.actorName = "Anonymous";
        }

        if (entry.authorId === row.createdById) {
            entry.authorName = "Anonymous";
        }
    }
}

const similarQuerySchema = z.object({
    category: z.string().trim().max(100).optional(),
    location: z.string().trim().max(500).optional(),
    title: z.string().trim().max(200).optional()
});

function createComplaintsRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    async function refreshComplaint(id, user, options = {}) {
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!canViewComplaint(user, row)) {
            throw new ApiError(
                403,
                "You do not have access to this complaint",
                "forbidden"
            );
        }

        const includeInternal = isOperations(user);
        const owner = isOwner(user, row);
        const [history, notes, attachments, upvotes] =
            await Promise.all([
                listHistory(db, id),
                listNotes(db, id, includeInternal),
                listAttachments(db, id),
                getUpvoteState(db, id, user.id)
            ]);
        maskAnonymousPeople(row, owner, history, notes);
        const canManage = canManageDepartment(user, row);
        const resolvedAt = row.resolvedAt
            ? new Date(row.resolvedAt)
            : null;
        const reopenEligible = Boolean(
            owner &&
                row.status === "Resolved" &&
                resolvedAt &&
                Date.now() - resolvedAt.getTime() <=
                    REOPEN_WINDOW_MS
        );
        const feedbackEligible = Boolean(
            owner &&
                row.status === "Resolved" &&
                row.feedbackRating === null
        );

        return {
            complaint: serializeComplaintRow(row, {
                includeCreatorEmail: isOperations(user),
                includeAssigneeEmail: isOperations(user),
                viewer: user,
                now: options.now
            }),
            history,
            notes,
            attachments,
            upvotes,
            permissions: {
                isOwner: owner,
                canManage,
                canUpdateStatus: canUpdateStatus(user, row),
                canAssign: canManage,
                canCreateInternalNote: isOperations(user),
                canUploadPhoto: owner || isOperations(user),
                canUpvote: true,
                canFeedback: feedbackEligible,
                canReopen: reopenEligible
            },
            reopenWindowEndsAt: resolvedAt
                ? new Date(
                      resolvedAt.getTime() + REOPEN_WINDOW_MS
                  )
                : null
        };
    }

    router.get("/meta", async (req, res) => {
        const [categoryRows, departmentRows, slaRows] =
            await Promise.all([
                db
                    .select({
                        id: complaintCategories.id,
                        name: complaintCategories.name,
                        departmentId:
                            complaintCategories.departmentId,
                        departmentName: departments.name
                    })
                    .from(complaintCategories)
                    .innerJoin(
                        departments,
                        eq(
                            complaintCategories.departmentId,
                            departments.id
                        )
                    )
                    .where(
                        and(
                            eq(
                                complaintCategories.isActive,
                                true
                            ),
                            eq(departments.isActive, true)
                        )
                    )
                    .orderBy(complaintCategories.sortOrder),
                db
                    .select({
                        id: departments.id,
                        code: departments.code,
                        name: departments.name
                    })
                    .from(departments)
                    .where(eq(departments.isActive, true))
                    .orderBy(departments.name),
                db.select().from(slaPolicies)
            ]);

        res.json({
            categories: categoryRows,
            departments: departmentRows,
            sla: slaRows.map((row) => ({
                priority: row.priority,
                responseHours: row.responseHours
            }))
        });
    });

    router.get("/mine", async (req, res) => {
        const input = listQuerySchema.parse(req.query);
        const result = await listComplaints(db, {
            user: req.user,
            input,
            ownOnly: true
        });

        res.json(result);
    });

    router.get("/summary", async (req, res) => {
        const rows = await db
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
                averageRating:
                    sql`round(avg(${complaints.feedbackRating})::numeric, 1)`
            })
            .from(complaints)
            .where(eq(complaints.createdBy, req.user.id));

        const summary = rows[0];

        res.json({
            total: Number(summary.total),
            pending: Number(summary.pending),
            assigned: Number(summary.assigned),
            inProgress: Number(summary.inProgress),
            resolved: Number(summary.resolved),
            reopened: Number(summary.reopened),
            rejected: Number(summary.rejected),
            overdue: Number(summary.overdue),
            averageRating:
                summary.averageRating === null
                    ? null
                    : Number(summary.averageRating)
        });
    });

    router.get("/similar", async (req, res) => {
        const input = similarQuerySchema.parse(req.query);
        const terms = [];

        if (input.category) {
            terms.push(eq(complaints.category, input.category));
        }

        if (input.location && input.location.length >= 3) {
            terms.push(
                ilike(complaints.location, `%${input.location}%`)
            );
        }

        if (input.title && input.title.length >= 4) {
            terms.push(
                ilike(complaints.title, `%${input.title}%`)
            );
        }

        if (terms.length === 0) {
            return res.json({ complaints: [] });
        }

        const rows = await db
            .select({
                id: complaints.id,
                referenceNumber: complaints.referenceNumber,
                title: complaints.title,
                category: complaints.category,
                location: complaints.location,
                status: complaints.status,
                createdAt: complaints.createdAt
            })
            .from(complaints)
            .where(
                and(
                    eq(complaints.createdBy, req.user.id),
                    or(...terms),
                    ne(complaints.status, "Rejected"),
                    ne(complaints.status, "Resolved")
                )
            )
            .orderBy(desc(complaints.createdAt))
            .limit(5);

        res.json({ complaints: rows });
    });

    router.get("/details/:id", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const result = await refreshComplaint(id, req.user);

        res.json(result);
    });

    router.post("/", async (req, res) => {
        const input = complaintCreateSchema.parse(req.body);

        const categoryRows = await db
            .select({
                name: complaintCategories.name,
                departmentId: complaintCategories.departmentId
            })
            .from(complaintCategories)
            .where(eq(complaintCategories.name, input.category))
            .limit(1);

        if (categoryRows.length === 0) {
            throw new ApiError(
                400,
                "Select a valid complaint category",
                "invalid_category"
            );
        }

        const slaHours = await getSlaHours(db, input.priority);
        const dueAt = addHours(new Date(), slaHours);

        const createdId = await db.transaction(async (tx) => {
            const rows = await tx
                .insert(complaints)
                .values({
                    title: input.title,
                    category: input.category,
                    description: input.description,
                    location: input.location,
                    priority: input.priority,
                    status: "Pending",
                    createdBy: req.user.id,
                    isAnonymous: input.anonymous,
                    departmentId: categoryRows[0].departmentId,
                    dueAt,
                    latitude: input.latitude ?? null,
                    longitude: input.longitude ?? null
                })
                .returning({
                    id: complaints.id,
                    referenceNumber: complaints.referenceNumber
                });

            const row = rows[0];

            await addHistory(tx, {
                complaintId: row.id,
                actorId: req.user.id,
                eventType: "created",
                toStatus: "Pending",
                message: input.anonymous
                    ? "Complaint submitted anonymously."
                    : "Complaint submitted."
            });

            await notifyDepartmentManagers(
                tx,
                categoryRows[0].departmentId,
                {
                    complaintId: row.id,
                    type: "complaint_created",
                    title: "New complaint awaiting triage",
                    message: `${row.referenceNumber}: ${input.title} (${input.priority} priority)`
                },
                req.user.id
            );

            return row.id;
        });

        const row = await getComplaintRow(db, createdId);
        const serialized = serializeComplaintRow(row, {
            includeCreatorEmail: false,
            viewer: req.user
        });

        res.status(201).json({
            message: "Complaint submitted successfully",
            complaint: serialized
        });
    });

    router.post("/:id/feedback", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = feedbackSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!isOwner(req.user, row)) {
            throw new ApiError(
                403,
                "Only the student who submitted this complaint can give feedback",
                "forbidden"
            );
        }

        if (row.status !== "Resolved") {
            throw new ApiError(
                400,
                "Feedback is available after the complaint is resolved",
                "not_resolved"
            );
        }

        if (row.feedbackRating !== null) {
            throw new ApiError(
                400,
                "Feedback has already been submitted",
                "feedback_exists"
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .update(complaints)
                .set({
                    feedbackRating: input.rating,
                    feedbackComment: input.comment || null,
                    feedbackAt: new Date()
                })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: "feedback_submitted",
                message: `Resolution rated ${input.rating} out of 5.`
            });

            const notificationsSent = new Set();

            if (row.assignedToId) {
                notificationsSent.add(row.assignedToId);
                await addNotification(tx, {
                    userId: row.assignedToId,
                    complaintId: id,
                    type: "feedback_received",
                    title: "Student feedback received",
                    message: `${row.referenceNumber} was rated ${input.rating}/5.`
                });
            }

            const managers = await tx
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(
                            users.departmentId,
                            row.departmentId
                        ),
                        eq(users.role, "department_manager")
                    )
                );

            for (const manager of managers) {
                if (!notificationsSent.has(manager.id)) {
                    notificationsSent.add(manager.id);
                    await addNotification(tx, {
                        userId: manager.id,
                        complaintId: id,
                        type: "feedback_received",
                        title: "Student feedback received",
                        message: `${row.referenceNumber} was rated ${input.rating}/5.`
                    });
                }
            }
        });

        const result = await refreshComplaint(id, req.user);
        res.json({
            message: "Feedback submitted successfully",
            ...result
        });
    });

    router.post("/:id/reopen", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = reopenSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!isOwner(req.user, row)) {
            throw new ApiError(
                403,
                "Only the student who submitted this complaint can reopen it",
                "forbidden"
            );
        }

        if (row.status !== "Resolved") {
            throw new ApiError(
                400,
                "Only resolved complaints can be reopened",
                "not_reopenable"
            );
        }

        if (
            !row.resolvedAt ||
            Date.now() - new Date(row.resolvedAt).getTime() >
                REOPEN_WINDOW_MS
        ) {
            throw new ApiError(
                400,
                "The 14-day reopening window has closed. Please submit a new complaint.",
                "reopen_window_closed"
            );
        }

        const slaHours = await getSlaHours(db, row.priority);

        await db.transaction(async (tx) => {
            await tx
                .update(complaints)
                .set({
                    status: "Reopened",
                    reopenedAt: new Date(),
                    dueAt: addHours(new Date(), slaHours)
                })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: "reopened",
                fromStatus: "Resolved",
                toStatus: "Reopened",
                message: input.reason
            });

            if (row.assignedToId) {
                await addNotification(tx, {
                    userId: row.assignedToId,
                    complaintId: id,
                    type: "complaint_reopened",
                    title: "Complaint reopened",
                    message: `${row.referenceNumber} was reopened by the student.`
                });
            }

            await notifyDepartmentManagers(
                tx,
                row.departmentId,
                {
                    complaintId: id,
                    type: "complaint_reopened",
                    title: "Complaint reopened",
                    message: `${row.referenceNumber} was reopened and needs attention.`
                },
                req.user.id
            );
        });

        const result = await refreshComplaint(id, req.user);
        res.json({
            message: "Complaint reopened",
            ...result
        });
    });

    router.post("/:id/comments", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = commentSchema.parse(req.body);
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

        const operations = isOperations(req.user);
        const visibility = operations
            ? input.visibility
            : "public";

        const noteId = await db.transaction(async (tx) => {
            const noteRows = await tx
                .insert(complaintNotes)
                .values({
                    complaintId: id,
                    authorId: req.user.id,
                    visibility,
                    message: input.message
                })
                .returning({ id: complaintNotes.id });

            await tx
                .update(complaints)
                .set({ updatedAt: new Date() })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: "comment_added",
                message:
                    visibility === "internal"
                        ? "Internal staff note added."
                        : "Public comment added."
            });

            if (visibility === "public" && !isOwner(req.user, row)) {
                await addNotification(tx, {
                    userId: row.createdById,
                    complaintId: id,
                    type: "comment_added",
                    title: "New comment on your complaint",
                    message: `${row.referenceNumber}: ${input.message.slice(0, 160)}`
                });
            }

            if (
                visibility === "public" &&
                row.assignedToId &&
                row.assignedToId !== req.user.id
            ) {
                await addNotification(tx, {
                    userId: row.assignedToId,
                    complaintId: id,
                    type: "comment_added",
                    title: "New public comment",
                    message: `${row.referenceNumber}: ${input.message.slice(0, 160)}`
                });
            }

            return noteRows[0].id;
        });

        const notes = await listNotes(
            db,
            id,
            operations
        );
        const note = notes.find((item) => item.id === noteId);

        res.status(201).json({
            message: "Comment added",
            comment: note
        });
    });

    router.post("/:id/attachments", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const input = attachmentSchema.parse(req.body);
        const row = await getComplaintRow(db, id);

        if (!row) {
            throw notFound("Complaint not found");
        }

        if (!isOwner(req.user, row) && !isOperations(req.user)) {
            throw new ApiError(
                403,
                "You cannot add photos to this complaint",
                "forbidden"
            );
        }

        const existing = await listAttachments(db, id);

        if (existing.length >= MAX_ATTACHMENTS) {
            throw new ApiError(
                400,
                `A complaint can have at most ${MAX_ATTACHMENTS} photos`,
                "attachment_limit"
            );
        }

        const image = decodeImage(input);
        const fileName = safeFileName(
            input.fileName,
            image.contentType
        );

        const attachmentId = await db.transaction(async (tx) => {
            const rows = await tx
                .insert(complaintAttachments)
                .values({
                    complaintId: id,
                    uploadedBy: req.user.id,
                    fileName,
                    contentType: image.contentType,
                    byteSize: image.byteSize,
                    dataBase64: image.buffer.toString("base64")
                })
                .returning({
                    id: complaintAttachments.id
                });

            await tx
                .update(complaints)
                .set({ updatedAt: new Date() })
                .where(eq(complaints.id, id));

            await addHistory(tx, {
                complaintId: id,
                actorId: req.user.id,
                eventType: "photo_added",
                message: "Photo attached to the complaint."
            });

            await recordAudit(tx, {
                actorId: req.user.id,
                action: "complaint_photo_added",
                entityType: "complaint",
                entityId: id,
                metadata: {
                    attachmentId: rows[0].id,
                    fileName,
                    contentType: image.contentType,
                    byteSize: image.byteSize
                }
            });

            return rows[0].id;
        });

        res.status(201).json({
            message: "Photo attached",
            attachment: {
                id: attachmentId,
                fileName,
                contentType: image.contentType,
                byteSize: image.byteSize
            }
        });
    });

    router.get(
        "/:id/attachments/:attachmentId",
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const attachmentId = z
                .uuid("Invalid attachment")
                .parse(req.params.attachmentId);
            const row = await getComplaintRow(db, id);

            if (!row) {
                throw notFound("Complaint not found");
            }

            if (!canViewComplaint(req.user, row)) {
                throw new ApiError(
                    403,
                    "You do not have access to this photo",
                    "forbidden"
                );
            }

            const attachment = await getAttachment(
                db,
                id,
                attachmentId
            );

            if (!attachment) {
                throw notFound("Photo not found");
            }

            const buffer = Buffer.from(
                attachment.dataBase64,
                "base64"
            );
            const safeName = safeFileName(
                attachment.fileName,
                attachment.contentType
            );

            res.setHeader("Content-Type", attachment.contentType);
            res.setHeader("Content-Length", buffer.length);
            res.setHeader(
                "Content-Disposition",
                `inline; filename="${safeName}"`
            );
            res.setHeader(
                "Cache-Control",
                "private, max-age=3600"
            );
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.send(buffer);
        }
    );

    router.delete(
        "/:id/attachments/:attachmentId",
        async (req, res) => {
            const { id } = idParamSchema.parse(req.params);
            const attachmentId = z
                .uuid("Invalid attachment")
                .parse(req.params.attachmentId);
            const row = await getComplaintRow(db, id);

            if (!row) {
                throw notFound("Complaint not found");
            }

            const attachment = await getAttachment(
                db,
                id,
                attachmentId
            );

            if (!attachment) {
                throw notFound("Photo not found");
            }

            if (
                attachment.uploadedBy !== req.user.id &&
                !isOperations(req.user)
            ) {
                throw new ApiError(
                    403,
                    "You cannot remove this photo",
                    "forbidden"
                );
            }

            await db.transaction(async (tx) => {
                await tx
                    .delete(complaintAttachments)
                    .where(
                        eq(
                            complaintAttachments.id,
                            attachmentId
                        )
                    );

                await addHistory(tx, {
                    complaintId: id,
                    actorId: req.user.id,
                    eventType: "photo_removed",
                    message: "A photo was removed."
                });

                await recordAudit(tx, {
                    actorId: req.user.id,
                    action: "complaint_photo_removed",
                    entityType: "complaint",
                    entityId: id,
                    metadata: { attachmentId }
                });
            });

            res.json({ message: "Photo removed" });
        }
    );

    router.post("/:id/upvote", async (req, res) => {
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

        const upvotes = await db.transaction(async (tx) => {
            const existing = await tx
                .select({ id: complaintUpvotes.id })
                .from(complaintUpvotes)
                .where(
                    and(
                        eq(complaintUpvotes.complaintId, id),
                        eq(complaintUpvotes.userId, req.user.id)
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                await tx
                    .delete(complaintUpvotes)
                    .where(eq(complaintUpvotes.id, existing[0].id));

                return { hasUpvoted: false };
            }

            await tx.insert(complaintUpvotes).values({
                complaintId: id,
                userId: req.user.id
            });

            return { hasUpvoted: true };
        });

        const state = await getUpvoteState(
            db,
            id,
            req.user.id
        );

        res.json({
            message: upvotes.hasUpvoted
                ? "Support added"
                : "Support removed",
            upvotes: state
        });
    });

    // Backward-compatible self-only route used by the original frontend.
    router.get("/:userId", async (req, res) => {
        const userId = z
            .uuid("Invalid user identifier")
            .parse(req.params.userId);

        if (userId !== req.user.id) {
            throw new ApiError(
                403,
                "You can only view your own complaints",
                "forbidden"
            );
        }

        const rows = await db
            .select()
            .from(complaints)
            .where(eq(complaints.createdBy, req.user.id))
            .orderBy(desc(complaints.createdAt));

        const hydrated = await Promise.all(
            rows.map((row) => getComplaintRow(db, row.id))
        );

        res.json({
            complaints: hydrated
                .filter(Boolean)
                .map((row) =>
                    serializeComplaintRow(row)
                )
        });
    });

    return router;
}

module.exports = {
    createComplaintsRouter
};
