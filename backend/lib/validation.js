const { z } = require("zod");

const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = [
    "Pending",
    "Assigned",
    "In Progress",
    "Resolved",
    "Reopened",
    "Rejected"
];
const ROLES = [
    "student",
    "staff",
    "department_manager",
    "admin"
];
const OPERATIONS_ROLES = [
    "staff",
    "department_manager",
    "admin"
];

const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(320));

const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long");

const optionalText = (max) =>
    z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().trim().max(max).optional()
    );

const optionalUuid = z.preprocess(
    (value) =>
        value === "" || value === null || value === undefined
            ? undefined
            : value,
    z.uuid("Invalid identifier").optional()
);

const optionalQueryEnum = (values) =>
    z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? undefined
                : value,
        z.enum(values).optional()
    );

const booleanQuery = z.preprocess((value) => {
    if (value === undefined || value === "") {
        return undefined;
    }

    if (value === true || value === "true" || value === "1") {
        return true;
    }

    if (value === false || value === "false" || value === "0") {
        return false;
    }

    return value;
}, z.boolean().optional());

const dateInput = z
    .string()
    .trim()
    .refine(
        (value) => !Number.isNaN(new Date(value).getTime()),
        "Invalid date and time"
    )
    .transform((value) => new Date(value));

const optionalDateInput = z.preprocess(
    (value) =>
        value === "" || value === null || value === undefined
            ? undefined
            : value,
    dateInput.optional()
);

const nullableDateInput = z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([dateInput, z.null()]).optional()
);

const nullableEmailInput = z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.union([emailSchema, z.null()]).optional()
);

const registerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Name is required")
        .max(120, "Name is too long"),
    email: emailSchema,
    password: passwordSchema
});

const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required").max(200)
});

const complaintCreateSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "Title is required")
            .max(200, "Title is too long"),
        category: z
            .string()
            .trim()
            .min(1, "Category is required")
            .max(100, "Category is too long"),
        description: z
            .string()
            .trim()
            .min(1, "Description is required")
            .max(20000, "Description is too long"),
        location: z
            .string()
            .trim()
            .min(1, "Location is required")
            .max(500, "Location is too long"),
        priority: z.enum(PRIORITIES).default("Medium"),
        anonymous: z.boolean().optional().default(false),
        latitude: z
            .number()
            .min(-90, "Latitude is out of range")
            .max(90, "Latitude is out of range")
            .nullable()
            .optional(),
        longitude: z
            .number()
            .min(-180, "Longitude is out of range")
            .max(180, "Longitude is out of range")
            .nullable()
            .optional()
    })
    .superRefine((value, context) => {
        const hasLatitude =
            value.latitude !== null &&
            value.latitude !== undefined;
        const hasLongitude =
            value.longitude !== null &&
            value.longitude !== undefined;

        if (hasLatitude !== hasLongitude) {
            context.addIssue({
                code: "custom",
                path: ["latitude"],
                message:
                    "Latitude and longitude must be supplied together"
            });
        }
    });

const statusUpdateSchema = z
    .object({
        status: z.enum(STATUSES),
        resolution: optionalText(5000),
        rejectionReason: optionalText(2000),
        note: optionalText(2000)
    })
    .superRefine((value, context) => {
        if (
            value.status === "Resolved" &&
            (!value.resolution || value.resolution.length < 3)
        ) {
            context.addIssue({
                code: "custom",
                path: ["resolution"],
                message:
                    "Describe the resolution before marking a complaint resolved"
            });
        }

        if (
            value.status === "Rejected" &&
            (!value.rejectionReason ||
                value.rejectionReason.length < 3)
        ) {
            context.addIssue({
                code: "custom",
                path: ["rejectionReason"],
                message:
                    "Give a reason before rejecting a complaint"
            });
        }
    });

const priorityUpdateSchema = z.object({
    priority: z.enum(PRIORITIES)
});

const assignmentSchema = z.object({
    departmentId: z.uuid("Select a valid department"),
    assignedToId: optionalUuid
});

const feedbackSchema = z.object({
    rating: z.coerce
        .number()
        .int("Rating must be a whole number")
        .min(1, "Rating must be between 1 and 5")
        .max(5, "Rating must be between 1 and 5"),
    comment: optionalText(2000)
});

const reopenSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(5, "Explain why the complaint should be reopened")
        .max(2000, "Reason is too long")
});

const commentSchema = z.object({
    message: z
        .string()
        .trim()
        .min(1, "Message is required")
        .max(5000, "Message is too long"),
    visibility: z
        .enum(["internal", "public"])
        .default("public")
});

const listQuerySchema = z.object({
    page: z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(1),
    pageSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20),
    search: optionalText(200),
    status: optionalQueryEnum(STATUSES),
    priority: optionalQueryEnum(PRIORITIES),
    category: optionalText(100),
    departmentId: optionalUuid,
    assignedToId: optionalUuid,
    sort: z.preprocess(
        (value) =>
            value === "" || value === undefined
                ? "newest"
                : value,
        z.enum(["newest", "oldest", "priority", "due"])
    ),
    overdue: booleanQuery,
    unassigned: booleanQuery
});

const notificationsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: booleanQuery
});

const noticesQuerySchema = z.object({
    search: optionalText(200),
    audience: optionalQueryEnum(["all", "students", "staff"]),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

function validateNoticeDates(value, context) {
    const published = value.publishedAt || new Date();

    if (
        value.expiresAt &&
        value.expiresAt.getTime() <= published.getTime()
    ) {
        context.addIssue({
            code: "custom",
            path: ["expiresAt"],
            message: "Expiry must be after the publish time"
        });
    }
}

const noticeCreateSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "Title is required")
            .max(200, "Title is too long"),
        body: z
            .string()
            .trim()
            .min(1, "Notice content is required")
            .max(10000, "Notice content is too long"),
        audience: z
            .enum(["all", "students", "staff"])
            .default("all"),
        priority: z
            .enum(["Normal", "High"])
            .default("Normal"),
        publishedAt: optionalDateInput,
        expiresAt: optionalDateInput
    })
    .superRefine(validateNoticeDates);

const noticeUpdateSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "Title is required")
            .max(200, "Title is too long")
            .optional(),
        body: z
            .string()
            .trim()
            .min(1, "Notice content is required")
            .max(10000, "Notice content is too long")
            .optional(),
        audience: z
            .enum(["all", "students", "staff"])
            .optional(),
        priority: z.enum(["Normal", "High"]).optional(),
        publishedAt: optionalDateInput,
        expiresAt: nullableDateInput
    })
    .superRefine(validateNoticeDates);

const profileUpdateSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Name is required")
        .max(120, "Name is too long")
});

const passwordChangeSchema = z.object({
    currentPassword: z
        .string()
        .min(1, "Current password is required")
        .max(200),
    newPassword: passwordSchema
});

const userUpdateSchema = z
    .object({
        role: z.enum(ROLES),
        departmentId: optionalUuid
    })
    .superRefine((value, context) => {
        if (
            ["staff", "department_manager"].includes(value.role) &&
            !value.departmentId
        ) {
            context.addIssue({
                code: "custom",
                path: ["departmentId"],
                message:
                    "Staff and department managers must belong to a department"
            });
        }
    });

const departmentCreateSchema = z.object({
    code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(
            /^[A-Z0-9_]{2,30}$/,
            "Code must use 2-30 uppercase letters, numbers or underscores"
        ),
    name: z
        .string()
        .trim()
        .min(2, "Name is required")
        .max(120, "Name is too long"),
    description: z
        .string()
        .trim()
        .max(500, "Description is too long")
        .default(""),
    contactEmail: z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? undefined
                : value,
        emailSchema.optional()
    ),
    isActive: z.boolean().default(true)
});

const departmentUpdateSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Name is required")
        .max(120, "Name is too long")
        .optional(),
    description: z
        .string()
        .trim()
        .max(500, "Description is too long")
        .optional(),
    contactEmail: nullableEmailInput,
    isActive: z.boolean().optional()
});

const categoryCreateSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Category name is required")
        .max(100, "Category name is too long"),
    departmentId: z.uuid("Select a valid department"),
    isActive: z.boolean().default(true),
    sortOrder: z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .default(100)
});

const categoryUpdateSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Category name is required")
        .max(100, "Category name is too long")
        .optional(),
    departmentId: z.uuid("Select a valid department").optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
});

const slaUpdateSchema = z.object({
    responseHours: z.coerce
        .number()
        .int()
        .min(1, "SLA must be at least one hour")
        .max(8760, "SLA cannot exceed one year")
});

const chatSendSchema = z.object({
    receiverId: z.uuid("Invalid receiver"),
    message: z
        .string()
        .trim()
        .min(1, "Message is required")
        .max(10000, "Message is too long")
});

const aiChatSchema = z.object({
    message: z
        .string()
        .trim()
        .min(1, "Message is required")
        .max(10000, "Message is too long")
});

const nullableUuid = z.preprocess(
    (value) =>
        value === "" || value === null || value === undefined
            ? null
            : value,
    z.union([z.uuid("Invalid identifier"), z.null()]).optional()
);

const attachmentSchema = z.object({
    fileName: z
        .string()
        .trim()
        .min(1, "File name is required")
        .max(200, "File name is too long"),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    dataBase64: z
        .string()
        .min(4, "Image data is required")
        .max(1200000, "Image is too large")
        .regex(
            /^[A-Za-z0-9+/=\r\n]+$/,
            "Image data is not valid base64"
        )
});

const bookingCreateSchema = z
    .object({
        facilityId: z.uuid("Select a valid facility"),
        title: z
            .string()
            .trim()
            .min(3, "Event title must be at least 3 characters")
            .max(200, "Event title is too long"),
        purpose: optionalText(2000),
        startsAt: dateInput,
        endsAt: dateInput,
        attendees: z.coerce
            .number()
            .int("Attendees must be a whole number")
            .min(1, "Attendees must be at least 1")
            .max(100000)
            .default(1)
    })
    .superRefine((value, context) => {
        const start = value.startsAt.getTime();
        const end = value.endsAt.getTime();
        const now = Date.now();

        if (end <= start) {
            context.addIssue({
                code: "custom",
                path: ["endsAt"],
                message: "End time must be after the start time"
            });
        }

        if (end - start > 24 * 60 * 60 * 1000) {
            context.addIssue({
                code: "custom",
                path: ["endsAt"],
                message: "A booking cannot last longer than 24 hours"
            });
        }

        if (start < now - 5 * 60 * 1000) {
            context.addIssue({
                code: "custom",
                path: ["startsAt"],
                message: "Choose a start time in the future"
            });
        }

        if (start > now + 365 * 24 * 60 * 60 * 1000) {
            context.addIssue({
                code: "custom",
                path: ["startsAt"],
                message: "Bookings are limited to one year ahead"
            });
        }
    });

const bookingReviewSchema = z
    .object({
        status: z.enum(["Approved", "Rejected"]),
        note: optionalText(1000)
    })
    .superRefine((value, context) => {
        if (
            value.status === "Rejected" &&
            (!value.note || value.note.length < 3)
        ) {
            context.addIssue({
                code: "custom",
                path: ["note"],
                message: "Give a reason before rejecting a booking"
            });
        }
    });

const facilityCreateSchema = z
    .object({
        code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(
                /^[A-Z0-9_]{2,30}$/,
                "Code must use 2-30 uppercase letters, numbers or underscores"
            ),
        name: z
            .string()
            .trim()
            .min(2, "Facility name is required")
            .max(120, "Facility name is too long"),
        description: z
            .string()
            .trim()
            .max(500, "Description is too long")
            .default(""),
        location: z
            .string()
            .trim()
            .min(1, "Location is required")
            .max(200, "Location is too long"),
        capacity: z.coerce
            .number()
            .int("Capacity must be a whole number")
            .min(1, "Capacity must be at least 1")
            .max(100000)
            .default(1),
        departmentId: optionalUuid,
        opensAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM time")
            .default("08:00"),
        closesAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM time")
            .default("22:00"),
        isActive: z.boolean().default(true)
    })
    .superRefine((value, context) => {
        if (value.opensAt >= value.closesAt) {
            context.addIssue({
                code: "custom",
                path: ["closesAt"],
                message: "Closing time must be after opening time"
            });
        }
    });

const facilityUpdateSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Facility name is required")
            .max(120, "Facility name is too long")
            .optional(),
        description: z
            .string()
            .trim()
            .max(500, "Description is too long")
            .optional(),
        location: z
            .string()
            .trim()
            .min(1, "Location is required")
            .max(200, "Location is too long")
            .optional(),
        capacity: z.coerce
            .number()
            .int("Capacity must be a whole number")
            .min(1)
            .max(100000)
            .optional(),
        departmentId: optionalUuid,
        opensAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM time")
            .optional(),
        closesAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM time")
            .optional(),
        isActive: z.boolean().optional()
    })
    .superRefine((value, context) => {
        if (
            value.opensAt &&
            value.closesAt &&
            value.opensAt >= value.closesAt
        ) {
            context.addIssue({
                code: "custom",
                path: ["closesAt"],
                message: "Closing time must be after opening time"
            });
        }
    });

const bookingsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: optionalQueryEnum([
        "Pending",
        "Approved",
        "Rejected",
        "Cancelled",
        "Completed"
    ]),
    facilityId: optionalUuid,
    search: optionalText(200)
});

const lostFoundQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: optionalText(200),
    type: optionalQueryEnum(["lost", "found"]),
    status: optionalQueryEnum(["open", "claimed", "closed"])
});

const lostFoundCreateSchema = z.object({
    type: z.enum(["lost", "found"]),
    title: z
        .string()
        .trim()
        .min(3, "Title must be at least 3 characters")
        .max(200, "Title is too long"),
    description: z
        .string()
        .trim()
        .min(1, "Description is required")
        .max(2000, "Description is too long"),
    category: z
        .string()
        .trim()
        .min(1, "Category is required")
        .max(80, "Category is too long")
        .default("Other"),
    location: z
        .string()
        .trim()
        .min(1, "Location is required")
        .max(200, "Location is too long"),
    occurredAt: optionalDateInput,
    contact: optionalText(320)
});

const lostFoundStatusSchema = z.object({
    status: z.enum(["open", "claimed", "closed"])
});

const inventoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: optionalText(200),
    departmentId: optionalUuid,
    lowOnly: booleanQuery,
    includeInactive: booleanQuery
});

const inventoryCreateSchema = z.object({
    sku: optionalText(50),
    name: z
        .string()
        .trim()
        .min(2, "Item name is required")
        .max(160, "Item name is too long"),
    category: z
        .string()
        .trim()
        .min(1, "Category is required")
        .max(80, "Category is too long")
        .default("General"),
    departmentId: optionalUuid,
    location: z
        .string()
        .trim()
        .max(160, "Location is too long")
        .default(""),
    quantity: z.coerce
        .number()
        .int("Quantity must be a whole number")
        .min(0)
        .max(1000000)
        .default(0),
    unit: z
        .string()
        .trim()
        .min(1, "Unit is required")
        .max(30, "Unit is too long")
        .default("units"),
    reorderLevel: z.coerce
        .number()
        .int("Reorder level must be a whole number")
        .min(0)
        .max(1000000)
        .default(0),
    unitCost: z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? undefined
                : value,
        z.coerce
            .number()
            .min(0, "Unit cost cannot be negative")
            .max(100000000)
            .optional()
    ),
    notes: z
        .string()
        .trim()
        .max(500, "Notes are too long")
        .default(""),
    isActive: z.boolean().default(true)
});

const inventoryUpdateSchema = z.object({
    sku: z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? null
                : value,
        z.union([z.string().trim().max(50), z.null()]).optional()
    ),
    name: z
        .string()
        .trim()
        .min(2, "Item name is required")
        .max(160, "Item name is too long")
        .optional(),
    category: z
        .string()
        .trim()
        .min(1, "Category is required")
        .max(80)
        .optional(),
    departmentId: nullableUuid,
    location: z.string().trim().max(160).optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    reorderLevel: z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .optional(),
    unitCost: z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? null
                : value,
        z.coerce
            .number()
            .min(0)
            .max(100000000)
            .nullable()
            .optional()
    ),
    notes: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional()
});

const inventoryAdjustSchema = z.object({
    delta: z.coerce
        .number()
        .int("Adjustment must be a whole number")
        .refine((value) => value !== 0, "Adjustment cannot be zero")
        .refine(
            (value) => value >= -1000000 && value <= 1000000,
            "Adjustment is out of range"
        ),
    reason: z.enum([
        "restock",
        "issue",
        "return",
        "adjustment",
        "write_off"
    ]),
    note: optionalText(500)
});

const maintenanceQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: optionalText(200),
    status: optionalQueryEnum([
        "Scheduled",
        "In Progress",
        "Completed",
        "Cancelled"
    ]),
    overdue: booleanQuery,
    dueSoon: booleanQuery
});

const maintenanceCreateSchema = z.object({
    title: z
        .string()
        .trim()
        .min(3, "Task title must be at least 3 characters")
        .max(200, "Task title is too long"),
    description: z
        .string()
        .trim()
        .max(3000, "Description is too long")
        .default(""),
    assetName: z
        .string()
        .trim()
        .max(200, "Asset name is too long")
        .default(""),
    location: z
        .string()
        .trim()
        .max(200, "Location is too long")
        .default(""),
    departmentId: optionalUuid,
    assignedTo: optionalUuid,
    frequency: z
        .enum([
            "once",
            "daily",
            "weekly",
            "monthly",
            "quarterly",
            "yearly"
        ])
        .default("monthly"),
    nextDueAt: dateInput,
    priority: z.enum(PRIORITIES).default("Medium")
});

const maintenanceUpdateSchema = z.object({
    title: z
        .string()
        .trim()
        .min(3, "Task title must be at least 3 characters")
        .max(200)
        .optional(),
    description: z.string().trim().max(3000).optional(),
    assetName: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    departmentId: nullableUuid,
    assignedTo: nullableUuid,
    frequency: z
        .enum([
            "once",
            "daily",
            "weekly",
            "monthly",
            "quarterly",
            "yearly"
        ])
        .optional(),
    nextDueAt: optionalDateInput,
    priority: z.enum(PRIORITIES).optional(),
    status: z
        .enum(["Scheduled", "In Progress", "Cancelled"])
        .optional()
});

const maintenanceCompleteSchema = z.object({
    note: optionalText(1000)
});

const idParamSchema = z.object({
    id: z.uuid("Invalid identifier")
});

module.exports = {
    PRIORITIES,
    STATUSES,
    ROLES,
    OPERATIONS_ROLES,
    registerSchema,
    loginSchema,
    complaintCreateSchema,
    statusUpdateSchema,
    priorityUpdateSchema,
    assignmentSchema,
    feedbackSchema,
    reopenSchema,
    commentSchema,
    listQuerySchema,
    notificationsQuerySchema,
    noticesQuerySchema,
    noticeCreateSchema,
    noticeUpdateSchema,
    profileUpdateSchema,
    passwordChangeSchema,
    userUpdateSchema,
    departmentCreateSchema,
    departmentUpdateSchema,
    categoryCreateSchema,
    categoryUpdateSchema,
    slaUpdateSchema,
    chatSendSchema,
    aiChatSchema,
    attachmentSchema,
    bookingCreateSchema,
    bookingReviewSchema,
    facilityCreateSchema,
    facilityUpdateSchema,
    bookingsQuerySchema,
    lostFoundQuerySchema,
    lostFoundCreateSchema,
    lostFoundStatusSchema,
    inventoryQuerySchema,
    inventoryCreateSchema,
    inventoryUpdateSchema,
    inventoryAdjustSchema,
    maintenanceQuerySchema,
    maintenanceCreateSchema,
    maintenanceUpdateSchema,
    maintenanceCompleteSchema,
    idParamSchema,
    emailSchema
};
