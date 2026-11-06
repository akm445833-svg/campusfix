require("dotenv").config({
    path: require("node:path").join(__dirname, ".env")
});

const bcrypt = require("bcryptjs");
const { sql } = require("drizzle-orm");

const { loadConfig } = require("./config");
const {
    createDatabase,
    checkDatabase,
    closeDatabase
} = require("./db/client");
const { users } = require("./db/schema");
const { emailSchema } = require("./lib/validation");

async function createAdmin() {
    const config = loadConfig();
    const name = (process.env.ADMIN_NAME || "CampusFix Admin").trim();
    const email = emailSchema.parse(process.env.ADMIN_EMAIL || "");
    const password = process.env.ADMIN_PASSWORD || "";

    if (password.length < 12) {
        throw new Error(
            "ADMIN_PASSWORD must be at least 12 characters"
        );
    }

    if (name.length < 1 || name.length > 120) {
        throw new Error(
            "ADMIN_NAME must be between 1 and 120 characters"
        );
    }

    const database = createDatabase({
        connectionString: config.databaseUrl
    });

    try {
        await checkDatabase(database);

        const existing = await database.db
            .select({
                id: users.id,
                role: users.role
            })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);

        if (existing.length > 0) {
            if (existing[0].role === "admin") {
                console.log(
                    "An administrator with ADMIN_EMAIL already exists; no changes made."
                );
                return;
            }

            throw new Error(
                "A student account already uses ADMIN_EMAIL. Use a different email; existing accounts are never modified."
            );
        }

        const passwordHash = await bcrypt.hash(
            password,
            config.bcryptRounds
        );

        const rows = await database.db
            .insert(users)
            .values({
                name,
                email,
                passwordHash,
                role: "admin"
            })
            .returning({
                id: users.id,
                email: users.email
            });

        console.log("Administrator created.");
        console.log(`Email: ${rows[0].email}`);
        console.log(`User ID: ${rows[0].id}`);
        console.log(
            "The password was read from ADMIN_PASSWORD and was not printed or stored in plaintext."
        );
    } finally {
        await closeDatabase(database);
    }
}

createAdmin().catch((error) => {
    console.error(
        `Admin creation failed: ${error.message || "unknown error"}`
    );
    process.exitCode = 1;
});
