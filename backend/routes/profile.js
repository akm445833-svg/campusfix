const express = require("express");
const bcrypt = require("bcryptjs");
const { eq } = require("drizzle-orm");

const { departments, users } = require("../db/schema");
const {
    profileUpdateSchema,
    passwordChangeSchema
} = require("../lib/validation");
const { ApiError, notFound } = require("../lib/errors");

function createProfileRouter({ config, db, auth }) {
    const router = express.Router();

    router.use(auth.authenticate);

    async function loadProfile(userId) {
        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                departmentId: users.departmentId,
                departmentName: departments.name,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt
            })
            .from(users)
            .leftJoin(
                departments,
                eq(users.departmentId, departments.id)
            )
            .where(eq(users.id, userId))
            .limit(1);

        return rows[0] || null;
    }

    router.get("/", async (req, res) => {
        const profile = await loadProfile(req.user.id);

        if (!profile) {
            throw notFound("User not found");
        }

        res.json({ profile });
    });

    router.patch("/", async (req, res) => {
        const input = profileUpdateSchema.parse(req.body);

        const rows = await db
            .update(users)
            .set({ name: input.name })
            .where(eq(users.id, req.user.id))
            .returning({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                departmentId: users.departmentId,
                updatedAt: users.updatedAt
            });

        if (rows.length === 0) {
            throw notFound("User not found");
        }

        const departmentName = req.user.departmentName || null;

        res.json({
            message: "Profile updated",
            profile: {
                ...rows[0],
                departmentName
            }
        });
    });

    router.put("/password", async (req, res) => {
        const input = passwordChangeSchema.parse(req.body);
        const rows = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user.id))
            .limit(1);
        const account = rows[0];

        if (!account) {
            throw notFound("User not found");
        }

        const passwordMatches = await bcrypt.compare(
            input.currentPassword,
            account.passwordHash
        );

        if (!passwordMatches) {
            throw new ApiError(
                400,
                "Current password is incorrect",
                "invalid_current_password"
            );
        }

        if (input.currentPassword === input.newPassword) {
            throw new ApiError(
                400,
                "Choose a password you have not already been using",
                "password_reused"
            );
        }

        const passwordHash = await bcrypt.hash(
            input.newPassword,
            config.bcryptRounds
        );

        await db
            .update(users)
            .set({ passwordHash })
            .where(eq(users.id, req.user.id));

        res.json({
            message:
                "Password updated. Use the new password the next time you sign in."
        });
    });

    return router;
}

module.exports = {
    createProfileRouter
};
