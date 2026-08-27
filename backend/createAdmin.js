require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./models/user");

async function createAdmin() {

    try {

        await mongoose.connect(process.env.MONGO_URI);

        console.log("MongoDB Connected ✅");

        const email = "admin@campusfix.com";
        const password = "Admin@123";

        const existingAdmin = await User.findOne({
            email: email
        });

        if (existingAdmin) {

            console.log("Admin already exists ⚠️");

            process.exit();

        }

        const hashedPassword =
            await bcrypt.hash(password, 10);

        const admin = new User({

            name: "CampusFix Admin",

            email: email,

            password: hashedPassword,

            role: "admin"

        });

        await admin.save();

        console.log("================================");
        console.log("ADMIN CREATED SUCCESSFULLY ✅");
        console.log("Email:", email);
        console.log("Password:", password);
        console.log("Role: admin");
        console.log("================================");

        process.exit();

    } catch (error) {

        console.log("Admin Creation Error ❌");
        console.log(error.message);

        process.exit(1);

    }

}

createAdmin();