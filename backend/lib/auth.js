const jwt = require("jsonwebtoken");
const { eq } = require("drizzle-orm");

const { departments, users } = require("../db/schema");

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "campusfix";
const JWT_AUDIENCE = "campusfix-web";
const OPERATIONS_ROLES = new Set([
    "staff",
    "department_manager",
    "admin"
]);

function publicUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        departmentId: row.departmentId || null,
        department: row.departmentId
            ? {
                  id: row.departmentId,
                  name: row.departmentName || null
              }
            : null,
        createdAt: row.createdAt
    };
}

function createAuthService({ config, db }) {
    function cookieOptions() {
        return {
            httpOnly: true,
            secure: config.cookieSecure,
            sameSite: "lax",
            path: "/",
            maxAge: config.sessionDurationMs
        };
    }

    function signToken(user) {
        return jwt.sign(
            { sub: user.id },
            config.jwtSecret,
            {
                algorithm: JWT_ALGORITHM,
                issuer: JWT_ISSUER,
                audience: JWT_AUDIENCE,
                expiresIn: Math.floor(
                    config.sessionDurationMs / 1000
                )
            }
        );
    }

    function setSessionCookie(res, user) {
        res.cookie(
            config.cookieName,
            signToken(user),
            cookieOptions()
        );
    }

    function clearSessionCookie(res) {
        res.clearCookie(config.cookieName, {
            httpOnly: true,
            secure: config.cookieSecure,
            sameSite: "lax",
            path: "/"
        });
    }

    function tokenFromRequest(req) {
        const cookieToken = req.cookies
            ? req.cookies[config.cookieName]
            : null;

        if (cookieToken) {
            return cookieToken;
        }

        const header = req.get("authorization");

        if (!header) {
            return null;
        }

        const parts = header.split(" ");

        if (
            parts.length !== 2 ||
            parts[0].toLowerCase() !== "bearer"
        ) {
            return null;
        }

        return parts[1];
    }

    async function userForToken(token) {
        let payload;

        try {
            payload = jwt.verify(token, config.jwtSecret, {
                algorithms: [JWT_ALGORITHM],
                issuer: JWT_ISSUER,
                audience: JWT_AUDIENCE
            });
        } catch (error) {
            return null;
        }

        if (
            !payload ||
            typeof payload.sub !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                payload.sub
            )
        ) {
            return null;
        }

        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                departmentId: users.departmentId,
                departmentName: departments.name,
                createdAt: users.createdAt
            })
            .from(users)
            .leftJoin(
                departments,
                eq(users.departmentId, departments.id)
            )
            .where(eq(users.id, payload.sub))
            .limit(1);

        return rows[0] || null;
    }

    async function authenticate(req, res, next) {
        try {
            const token = tokenFromRequest(req);

            if (!token) {
                return res.status(401).json({
                    message: "Access denied. Login required."
                });
            }

            const user = await userForToken(token);

            if (!user) {
                clearSessionCookie(res);

                return res.status(401).json({
                    message: "Invalid or expired session"
                });
            }

            req.user = user;
            next();
        } catch (error) {
            next(error);
        }
    }

    function requireAdmin(req, res, next) {
        if (!req.user || req.user.role !== "admin") {
            return res.status(403).json({
                message: "Admin access required"
            });
        }

        next();
    }

    function requireOperations(req, res, next) {
        if (!req.user || !OPERATIONS_ROLES.has(req.user.role)) {
            return res.status(403).json({
                message: "Operations access required"
            });
        }

        next();
    }

    function requireRoles(...roles) {
        const allowed = new Set(roles);

        return function checkRoles(req, res, next) {
            if (!req.user || !allowed.has(req.user.role)) {
                return res.status(403).json({
                    message: "You do not have permission for this action"
                });
            }

            next();
        };
    }

    return {
        signToken,
        setSessionCookie,
        clearSessionCookie,
        authenticate,
        requireAdmin,
        requireOperations,
        requireRoles,
        publicUser
    };
}

module.exports = {
    createAuthService,
    publicUser
};
