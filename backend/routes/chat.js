const express = require("express");
const {
    and,
    asc,
    eq,
    or
} = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const { z } = require("zod");

const { chats, users } = require("../db/schema");
const {
    chatSendSchema,
    aiChatSchema
} = require("../lib/validation");
const { ApiError } = require("../lib/errors");

function createChatRouter({ db, auth }) {
    const router = express.Router();

    const sender = alias(users, "sender_user");
    const receiver = alias(users, "receiver_user");

    router.use(auth.authenticate);

    async function threadMessages(userId, otherUserId) {
        return db
            .select({
                id: chats.id,
                message: chats.message,
                isAI: chats.isAI,
                createdAt: chats.createdAt,
                sender: {
                    id: sender.id,
                    name: sender.name
                },
                receiver: {
                    id: receiver.id,
                    name: receiver.name
                }
            })
            .from(chats)
            .innerJoin(
                sender,
                eq(chats.senderId, sender.id)
            )
            .innerJoin(
                receiver,
                eq(chats.receiverId, receiver.id)
            )
            .where(
                or(
                    and(
                        eq(chats.senderId, userId),
                        eq(chats.receiverId, otherUserId)
                    ),
                    and(
                        eq(chats.senderId, otherUserId),
                        eq(chats.receiverId, userId)
                    )
                )
            )
            .orderBy(asc(chats.createdAt));
    }

    router.post("/", async (req, res) => {
        const input = chatSendSchema.parse(req.body);

        if (input.receiverId === req.user.id) {
            throw new ApiError(
                400,
                "Choose another recipient",
                "invalid_receiver"
            );
        }

        const recipient = await db
            .select({ id: users.id, role: users.role })
            .from(users)
            .where(eq(users.id, input.receiverId))
            .limit(1);

        if (recipient.length === 0) {
            throw new ApiError(
                404,
                "Recipient not found",
                "receiver_not_found"
            );
        }

        const operationsRoles = [
            "staff",
            "department_manager",
            "admin"
        ];
        const senderIsOperations = operationsRoles.includes(
            req.user.role
        );

        if (!senderIsOperations && recipient[0].role === "student") {
            throw new ApiError(
                404,
                "Recipient not found",
                "receiver_not_found"
            );
        }

        if (
            senderIsOperations &&
            recipient[0].role === "student"
        ) {
            const existingThread = await db
                .select({ id: chats.id })
                .from(chats)
                .where(
                    or(
                        and(
                            eq(chats.senderId, req.user.id),
                            eq(chats.receiverId, input.receiverId)
                        ),
                        and(
                            eq(chats.senderId, input.receiverId),
                            eq(chats.receiverId, req.user.id)
                        )
                    )
                )
                .limit(1);

            if (existingThread.length === 0) {
                throw new ApiError(
                    403,
                    "Students need to start this conversation first",
                    "chat_not_started"
                );
            }
        }

        const rows = await db
            .insert(chats)
            .values({
                senderId: req.user.id,
                receiverId: input.receiverId,
                message: input.message,
                isAI: false
            })
            .returning();

        res.status(201).json({
            message: "Message sent successfully",
            chat: {
                id: rows[0].id,
                senderId: rows[0].senderId,
                receiverId: rows[0].receiverId,
                message: rows[0].message,
                isAI: rows[0].isAI,
                createdAt: rows[0].createdAt
            }
        });
    });

    function helperReply(message) {
        const text = String(message).toLowerCase();

        if (/(password|sign in|login|account)/.test(text)) {
            return "Automated CampusFix helper: open Profile to update your display name or password. Password changes keep this device signed in. If you cannot sign in, contact your campus administrator and do not share your password with anyone.";
        }

        if (/(notice|announcement|update)/.test(text)) {
            return "Automated CampusFix helper: the Notices page lists official campus announcements for your role. Notices are never cached offline, so check them while connected.";
        }

        if (/(status|track|progress|reference|reopen)/.test(text)) {
            return "Automated CampusFix helper: open your dashboard and select a complaint to see its status, department, assigned staff, response target, and history. Resolved complaints can be rated, or reopened within 14 days.";
        }

        if (/(photo|photo upload|image|attach)/.test(text)) {
            return "Automated CampusFix helper: photo uploads are not enabled in this deployment because no file storage provider is configured. Include a precise location and detailed description instead.";
        }

        if (/(submit|report|complaint|issue)/.test(text)) {
            return "Automated CampusFix helper: choose “New complaint” on your dashboard, then add a clear title, category, description, and location. You will receive a unique reference number to track it.";
        }

        return "Automated CampusFix helper: I can share general guidance about submitting complaints, tracking status, notices, and account settings. I cannot make decisions or see your complaint details. For a specific issue, message campus staff.";
    }

    router.post("/ai", async (req, res) => {
        const input = aiChatSchema.parse(req.body);
        const aiReply = helperReply(input.message);

        const rows = await db
            .insert(chats)
            .values([
                {
                    senderId: req.user.id,
                    receiverId: req.user.id,
                    message: input.message,
                    isAI: false
                },
                {
                    senderId: req.user.id,
                    receiverId: req.user.id,
                    message: aiReply,
                    isAI: true
                }
            ])
            .returning();

        const reply =
            rows.find((row) => row.isAI) || rows[0];

        res.json({
            reply: aiReply,
            chat: {
                id: reply.id,
                message: reply.message,
                isAI: reply.isAI,
                createdAt: reply.createdAt
            }
        });
    });

    router.get("/ai/history", async (req, res) => {
        const rows = await db
            .select({
                id: chats.id,
                message: chats.message,
                isAI: chats.isAI,
                createdAt: chats.createdAt
            })
            .from(chats)
            .where(
                and(
                    eq(chats.senderId, req.user.id),
                    eq(chats.receiverId, req.user.id)
                )
            )
            .orderBy(asc(chats.createdAt));

        res.json({ messages: rows });
    });

    router.get("/:otherUserId", async (req, res) => {
        const otherUserId = z
            .uuid("Invalid chat participant")
            .parse(req.params.otherUserId);

        const messages = await threadMessages(
            req.user.id,
            otherUserId
        );

        res.json({ messages });
    });

    return router;
}

module.exports = {
    createChatRouter
};
