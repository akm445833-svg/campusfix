const express = require("express");
const {
    and,
    desc,
    eq,
    isNull,
    sql
} = require("drizzle-orm");

const { notifications } = require("../db/schema");
const {
    idParamSchema,
    notificationsQuerySchema
} = require("../lib/validation");
const { notFound } = require("../lib/errors");

function createNotificationsRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    router.get("/", async (req, res) => {
        const input = notificationsQuerySchema.parse(req.query);
        const conditions = [
            eq(notifications.userId, req.user.id)
        ];

        if (input.unreadOnly) {
            conditions.push(isNull(notifications.readAt));
        }

        const offset =
            (input.page - 1) * input.pageSize;
        const [rows, countRows, unreadRows] =
            await Promise.all([
                db
                    .select()
                    .from(notifications)
                    .where(and(...conditions))
                    .orderBy(desc(notifications.createdAt))
                    .limit(input.pageSize)
                    .offset(offset),
                db
                    .select({ count: sql`count(*)::int` })
                    .from(notifications)
                    .where(and(...conditions)),
                db
                    .select({ count: sql`count(*)::int` })
                    .from(notifications)
                    .where(
                        and(
                            eq(
                                notifications.userId,
                                req.user.id
                            ),
                            isNull(notifications.readAt)
                        )
                    )
            ]);

        const total = Number(countRows[0].count);

        res.json({
            notifications: rows,
            unreadCount: Number(unreadRows[0].count),
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total,
                totalPages:
                    total === 0
                        ? 0
                        : Math.ceil(total / input.pageSize)
            }
        });
    });

    router.post("/read-all", async (req, res) => {
        const result = await db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(
                and(
                    eq(
                        notifications.userId,
                        req.user.id
                    ),
                    isNull(notifications.readAt)
                )
            )
            .returning({ id: notifications.id });

        res.json({
            message: "Notifications marked as read",
            updated: result.length
        });
    });

    router.post("/:id/read", async (req, res) => {
        const { id } = idParamSchema.parse(req.params);
        const rows = await db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(
                and(
                    eq(notifications.id, id),
                    eq(notifications.userId, req.user.id)
                )
            )
            .returning();

        if (rows.length === 0) {
            throw notFound("Notification not found");
        }

        res.json({
            message: "Notification marked as read",
            notification: rows[0]
        });
    });

    return router;
}

module.exports = {
    createNotificationsRouter
};
