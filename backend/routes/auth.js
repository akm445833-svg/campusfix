const express = require("express");
const bcrypt = require("bcryptjs");
const { eq, sql } = require("drizzle-orm");

const { users } = require("../db/schema");
const {
    registerSchema,
    loginSchema
} = require("../lib/validation");
const { ApiError } = require("../lib/errors");

// Used to keep login timing roughly constant when the email is unknown.
const DUMMY_PASSWORD_HASH =
    "$2b$12$JZwR8u6e.dVl1qkJI4vkm.W3PLB2IOngKkN/9UPtKKkc6Rttmu/ke";

function createAuthRouter({ config, db, auth }) {
    const router = express.Router();

    router.post("/register", async (req, res) => {
        const input = registerSchema.parse(req.body);

        const existing = await db
            .select({ id: users.id })
            .from(users)
            .where(
                sql`lower(${users.email}) = ${input.email}`
            )
            .limit(1);

        if (existing.length > 0) {
            throw new ApiError(
                400,
                "User already exists",
                "email_exists"
            );
        }

        const passwordHash = await bcrypt.hash(
            input.password,
            config.bcryptRounds
        );

        let created;

        try {
            const rows = await db
                .insert(users)
                .values({
                    name: input.name,
                    email: input.email,
                    passwordHash,
                    role: "student"
                })
                .returning({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    role: users.role,
                    createdAt: users.createdAt
                });

            created = rows[0];
        } catch (error) {
            if (error.code === "23505") {
                throw new ApiError(
                    400,
                    "User already exists",
                    "email_exists"
                );
            }

            throw error;
        }

        res.status(201).json({
            message: "Registration successful",
            user: auth.publicUser(created)
        });
    });

    router.post("/login", async (req, res) => {
        const input = loginSchema.parse(req.body);

        const rows = await db
            .select()
            .from(users)
            .where(
                sql`lower(${users.email}) = ${input.email}`
            )
            .limit(1);

        const account = rows[0];

        const passwordMatches = await bcrypt.compare(
            input.password,
            account ? account.passwordHash : DUMMY_PASSWORD_HASH
        );

        if (!account || !passwordMatches) {
            throw new ApiError(
                401,
                "Invalid email or password",
                "invalid_credentials"
            );
        }

        auth.setSessionCookie(res, account);

        res.json({
            message: "Login successful",
            user: auth.publicUser(account)
        });
    });

    router.post("/logout", (req, res) => {
        auth.clearSessionCookie(res);
        res.json({ message: "Logged out" });
    });

    router.get("/me", auth.authenticate, (req, res) => {
        res.json({ user: auth.publicUser(req.user) });
    });

    return router;
}

module.exports = {
    createAuthRouter
};
