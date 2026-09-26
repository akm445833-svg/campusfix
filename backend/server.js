require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const User = require("./models/user");
const Complaint = require("./models/Complaint");
const Chat = require("./models/chat");

const app = express();


// =====================================================
// ENV TEST
// =====================================================

console.log(
    "ENV TEST:",
    process.env.MONGO_URI ? "LOADED ✅" : "NOT LOADED ❌"
);

console.log(
    "JWT TEST:",
    process.env.JWT_SECRET ? "LOADED ✅" : "NOT LOADED ❌"
);


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());

app.use(express.json());


// =====================================================
// SERVE FRONTEND (same server, same port, no CORS needed)
// =====================================================

app.use(express.static(path.join(__dirname, "..")));


// =====================================================
// MONGODB CONNECTION
// =====================================================

mongoose.connect(process.env.MONGO_URI)

    .then(() => {

        console.log("MongoDB Connected ✅");

    })

    .catch((error) => {

        console.log("MongoDB Connection Error ❌");
        console.log(error.message);

    });


// =====================================================
// HOME
// =====================================================

app.get("/api", (req, res) => {

    res.json({

        message: "CampusFix Backend is Running 🚀"

    });

});


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {

    res.json({

        status: "OK",

        message: "Server is healthy"

    });

});


// =====================================================
// AUTHENTICATION MIDDLEWARE
// =====================================================

function authenticateToken(req, res, next) {

    try {

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                message:
                    "Access denied. Token required."

            });

        }


        const parts =
            authHeader.split(" ");


        if (
            parts.length !== 2 ||
            parts[0] !== "Bearer"
        ) {

            return res.status(401).json({

                message:
                    "Invalid authorization header"

            });

        }


        const token =
            parts[1];


        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );


        req.user = decoded;


        next();


    } catch (error) {

        console.log(
            "Authentication Error ❌"
        );


        return res.status(401).json({

            message:
                "Invalid or expired token"

        });

    }

}


// =====================================================
// ADMIN MIDDLEWARE
// =====================================================

async function requireAdmin(req, res, next) {

    try {

        const user =
            await User.findById(req.user.id);


        if (!user) {

            return res.status(404).json({

                message:
                    "User not found"

            });

        }


        if (user.role !== "admin") {

            return res.status(403).json({

                message:
                    "Admin access required"

            });

        }


        next();


    } catch (error) {

        console.log(
            "Admin Check Error ❌"
        );

        console.log(
            error.message
        );


        return res.status(500).json({

            message:
                "Could not verify admin"

        });

    }

}


// =====================================================
// REGISTER
// =====================================================

app.post("/api/register", async (req, res) => {

    try {

        const {
            name,
            email,
            password
        } = req.body;


        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {

            return res.status(400).json({

                message:
                    "Please fill all fields"

            });

        }


        if (password.length < 6) {

            return res.status(400).json({

                message:
                    "Password must be at least 6 characters"

            });

        }


        const cleanEmail =
            email.trim().toLowerCase();


        const existingUser =
            await User.findOne({

                email: cleanEmail

            });


        if (existingUser) {

            return res.status(400).json({

                message:
                    "User already exists"

            });

        }


        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );


        const user =
            new User({

                name:
                    name.trim(),

                email:
                    cleanEmail,

                password:
                    hashedPassword,

                role:
                    "student"

            });


        await user.save();


        console.log(
            "User registered ✅"
        );


        res.status(201).json({

            message:
                "Registration successful",

            user: {

                id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email,

                role:
                    user.role

            }

        });


    } catch (error) {

        console.log(
            "Registration Error ❌"
        );

        console.log(
            error.message
        );


        res.status(500).json({

            message:
                "Registration failed"

        });

    }

});


// =====================================================
// LOGIN
// =====================================================

app.post("/api/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        if (
            !email ||
            !password
        ) {

            return res.status(400).json({

                message:
                    "Please fill all fields"

            });

        }


        const cleanEmail =
            email.trim().toLowerCase();


        const user =
            await User.findOne({

                email:
                    cleanEmail

            });


        if (!user) {

            return res.status(401).json({

                message:
                    "Invalid email or password"

            });

        }


        const isMatch =
            await bcrypt.compare(

                password,

                user.password

            );


        if (!isMatch) {

            return res.status(401).json({

                message:
                    "Invalid email or password"

            });

        }


        // =================================================
        // CREATE JWT
        // =================================================

        const token =
            jwt.sign(

                {

                    id:
                        user._id.toString(),

                    email:
                        user.email,

                    role:
                        user.role

                },

                process.env.JWT_SECRET,

                {

                    expiresIn:
                        "7d"

                }

            );


        console.log(
            `Login successful ✅ (${user.role})`
        );


        res.json({

            message:
                "Login successful",

            token:
                token,

            user: {

                id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email,

                role:
                    user.role

            }

        });


    } catch (error) {

        console.log(
            "Login Error ❌"
        );

        console.log(
            error.message
        );


        res.status(500).json({

            message:
                "Login failed"

        });

    }

});


// =====================================================
// CREATE COMPLAINT - STUDENT
// =====================================================

app.post(
    "/api/complaints",
    authenticateToken,
    async (req, res) => {

        try {

            const {
                title,
                category,
                description,
                location,
                priority
            } = req.body;


            if (
                typeof title !== "string" ||
                typeof category !== "string" ||
                typeof description !== "string" ||
                typeof location !== "string" ||
                !title.trim() ||
                !category.trim() ||
                !description.trim() ||
                !location.trim()
            ) {

                return res.status(400).json({

                    message:
                        "Please fill all required fields"

                });

            }


            const allowedPriorities = [

                "Low",

                "Medium",

                "High"

            ];


            if (
                priority &&
                !allowedPriorities.includes(priority)
            ) {

                return res.status(400).json({

                    message:
                        "Invalid complaint priority"

                });

            }


            const complaint =
                new Complaint({

                    title:
                        title.trim(),

                    category:
                        category,

                    description:
                        description.trim(),

                    location:
                        location.trim(),

                    priority:
                        priority || "Medium",

                    createdBy:
                        req.user.id

                });


            await complaint.save();


            console.log(
                "Complaint created ✅"
            );


            res.status(201).json({

                message:
                    "Complaint submitted successfully",

                complaint:
                    complaint

            });


        } catch (error) {

            console.log(
                "Complaint Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Complaint submission failed"

            });

        }

    }
);


// =====================================================
// GET MY COMPLAINTS - STUDENT
// =====================================================

app.get(
    "/api/complaints/:userId",
    authenticateToken,
    async (req, res) => {

        try {

            // Student can only see own complaints

            if (
                req.user.id.toString() !==
                req.params.userId.toString()
            ) {

                return res.status(403).json({

                    message:
                        "You can only view your own complaints"

                });

            }


            const complaints =
                await Complaint.find({

                    createdBy:
                        req.params.userId

                })

                .sort({

                    createdAt:
                        -1

                });


            res.json({

                complaints:
                    complaints

            });


        } catch (error) {

            console.log(
                "Fetch Complaints Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Could not fetch complaints"

            });

        }

    }
);


// =====================================================
// ADMIN - GET ALL COMPLAINTS
// =====================================================

app.get(
    "/api/admin/complaints",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const complaints =
                await Complaint.find()

                    .populate(
                        "createdBy",
                        "name email"
                    )

                    .sort({

                        createdAt:
                            -1

                    });


            res.json({

                complaints:
                    complaints

            });


        } catch (error) {

            console.log(
                "Admin Complaints Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Could not fetch complaints"

            });

        }

    }
);


// =====================================================
// ADMIN - UPDATE COMPLAINT STATUS
// =====================================================

app.put(
    "/api/admin/complaints/:id/status",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const {
                status
            } = req.body;


            const allowedStatuses = [

                "Pending",

                "In Progress",

                "Resolved"

            ];


            if (
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({

                    message:
                        "Invalid complaint status"

                });

            }


            const complaint =
                await Complaint.findByIdAndUpdate(

                    req.params.id,

                    {

                        status:
                            status

                    },

                    {

                        new:
                            true,

                        runValidators:
                            true

                    }

                );


            if (!complaint) {

                return res.status(404).json({

                    message:
                        "Complaint not found"

                });

            }


            console.log(
                "Complaint status updated ✅"
            );


            res.json({

                message:
                    "Complaint status updated successfully",

                complaint:
                    complaint

            });


        } catch (error) {

            console.log(
                "Update Status Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Could not update complaint status"

            });

        }

    }
);


// =====================================================
// ADMIN - DELETE COMPLAINT
// =====================================================

app.delete(
    "/api/admin/complaints/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const complaint =
                await Complaint.findByIdAndDelete(

                    req.params.id

                );


            if (!complaint) {

                return res.status(404).json({

                    message:
                        "Complaint not found"

                });

            }


            console.log(
                "Complaint deleted ✅"
            );


            res.json({

                message:
                    "Complaint deleted successfully"

            });


        } catch (error) {

            console.log(
                "Delete Complaint Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Could not delete complaint"

            });

        }

    }
);


// =====================================================
// ADMIN - DASHBOARD STATISTICS
// =====================================================

app.get(
    "/api/admin/stats",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const total =
                await Complaint.countDocuments();


            const pending =
                await Complaint.countDocuments({

                    status:
                        "Pending"

                });


            const inProgress =
                await Complaint.countDocuments({

                    status:
                        "In Progress"

                });


            const resolved =
                await Complaint.countDocuments({

                    status:
                        "Resolved"

                });


            res.json({

                total:
                    total,

                pending:
                    pending,

                inProgress:
                    inProgress,

                resolved:
                    resolved

            });


        } catch (error) {

            console.log(
                "Stats Error ❌"
            );

            console.log(
                error.message
            );


            res.status(500).json({

                message:
                    "Could not load statistics"

            });

        }

    }
);


// =====================================================
// GET ADMIN INFO - for chat
// =====================================================

app.get(
    "/api/admin/info",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const admin = await User.findById(req.user.id).select("-password");

            res.json({ admin: admin });

        } catch (error) {

            res.status(500).json({
                message: "Could not fetch admin info"
            });

        }
    }
);


// =====================================================
// GET USERS (for finding admins to chat with)
// =====================================================

app.get(
    "/api/users",
    authenticateToken,
    async (req, res) => {

        try {

            const users = await User.find({ role: "admin" }).select("-password");

            res.json({ users: users });

        } catch (error) {

            res.status(500).json({
                message: "Could not fetch users"
            });

        }
    }
);


// =====================================================
// SEND MESSAGE - CHAT
// =====================================================

app.post(
    "/api/chat",
    authenticateToken,
    async (req, res) => {

        try {

            const { receiverId, message } = req.body;

            if (!receiverId || !message || !message.trim()) {
                return res.status(400).json({
                    message: "Please provide a receiver and message"
                });
            }

            const chat = new Chat({
                sender: req.user.id,
                receiver: receiverId,
                message: message.trim(),
                isAI: false
            });

            await chat.save();

            res.status(201).json({
                message: "Message sent successfully",
                chat: chat
            });

        } catch (error) {
            console.log("Send Message Error ❌");
            console.log(error.message);
            res.status(500).json({
                message: "Failed to send message"
            });
        }
    }
);


// =====================================================
// GET MESSAGES - CHAT
// =====================================================

app.get(
    "/api/chat/:otherUserId",
    authenticateToken,
    async (req, res) => {

        try {

            const otherUserId = req.params.otherUserId;

            const messages = await Chat.find({
                $or: [
                    { sender: req.user.id, receiver: otherUserId },
                    { sender: otherUserId, receiver: req.user.id }
                ]
            })
                .populate("sender", "name")
                .populate("receiver", "name")
                .sort({ createdAt: 1 });

            res.json({
                messages: messages
            });

        } catch (error) {
            console.log("Get Messages Error ❌");
            console.log(error.message);
            res.status(500).json({
                message: "Could not load messages"
            });
        }
    }
);


// =====================================================
// AI ASSISTANT RESPONSE
// =====================================================

app.post(
    "/api/chat/ai",
    authenticateToken,
    async (req, res) => {

        try {

            const { message } = req.body;

            if (!message || !message.trim()) {
                return res.status(400).json({
                    message: "Please provide a message"
                });
            }

            // Save user message
            const aiReply =
                "I'm an AI assistant for CampusFix. I can help answer frequently asked questions about reporting complaints, checking status, and campus services. For specific issues, please contact the admin. Your message was: " +
                message.trim().substring(0, 50) +
                "...";

            const aiChat = new Chat({
                sender: req.user.id,
                receiver: req.user.id,
                message: message.trim(),
                isAI: true
            });

            await aiChat.save();

            // Save AI response
            const aiResponse = new Chat({
                sender: req.user.id,
                receiver: req.user.id,
                message: aiReply,
                isAI: true
            });

            await aiResponse.save();

            res.json({
                reply: aiReply,
                chat: aiResponse
            });

        } catch (error) {
            console.log("AI Chat Error ❌");
            console.log(error.message);
            res.status(500).json({
                message: "AI assistant unavailable"
            });
        }
    }
);


// =====================================================
// START SERVER
// =====================================================

const PORT =
    process.env.PORT || 5000;


app.listen(
    PORT,
    () => {

        console.log(
            `CampusFix server running on port ${PORT} 🚀`
        );

    }
);