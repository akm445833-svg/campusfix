const express = require("express");
const {
    and,
    desc,
    eq,
    gt,
    isNull,
    lte,
    or,
    sql
} = require("drizzle-orm");

const { notices, users } = require("../db/schema");
const { noticesQuerySchema } = require("../lib/validation");

function createNoticesRouter({ db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    router.get("/", async (req, res) => {
        const input = noticesQuerySchema.parse(req.query);
        const conditions = [
            lte(notices.publishedAt, new Date()),
            or(
                isNull(notices.expiresAt),
                gt(notices.expiresAt, new Date())
            )
        ];

        if (req.user.role !== "admin") {
            const audience =
                req.user.role === "student"
                    ? "students"
                    : "staff";

            conditions.push(
                or(
                    eq(notices.audience, "all"),
                    eq(notices.audience, audience)
                )
            );
        }

        if (input.audience) {
            conditions.push(
                eq(notices.audience, input.audience)
            );
        }

        if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
                sql`(${notices.title} ILIKE ${pattern} OR ${notices.body} ILIKE ${pattern})`
            );
        }

        const rows = await db
            .select({
                id: notices.id,
                title: notices.title,
                body: notices.body,
                audience: notices.audience,
                priority: notices.priority,
                publishedAt: notices.publishedAt,
                expiresAt: notices.expiresAt,
                createdAt: notices.createdAt,
                updatedAt: notices.updatedAt,
                authorName: users.name
            })
            .from(notices)
            .leftJoin(users, eq(notices.createdBy, users.id))
            .where(and(...conditions))
            .orderBy(
                desc(notices.priority),
                desc(notices.publishedAt)
            )
            .limit(input.limit);

        res.json({ notices: rows });
    });

    return router;
}

module.exports = {
    createNoticesRouter
};
