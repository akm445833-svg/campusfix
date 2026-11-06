const {
    boolean,
    check,
    doublePrecision,
    index,
    integer,
    jsonb,
    numeric,
    pgEnum,
    pgTable,
    smallint,
    text,
    time,
    timestamp,
    uniqueIndex,
    uuid,
    varchar
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");

const userRole = pgEnum("user_role", [
    "student",
    "staff",
    "department_manager",
    "admin"
]);
const complaintPriority = pgEnum("complaint_priority", [
    "Low",
    "Medium",
    "High",
    "Critical"
]);
const complaintStatus = pgEnum("complaint_status", [
    "Pending",
    "Assigned",
    "In Progress",
    "Resolved",
    "Reopened",
    "Rejected"
]);
const noteVisibility = pgEnum("note_visibility", [
    "internal",
    "public"
]);
const noticeAudience = pgEnum("notice_audience", [
    "all",
    "students",
    "staff"
]);
const noticePriority = pgEnum("notice_priority", [
    "Normal",
    "High"
]);
const bookingStatus = pgEnum("booking_status", [
    "Pending",
    "Approved",
    "Rejected",
    "Cancelled",
    "Completed"
]);
const lostFoundType = pgEnum("lost_found_type", ["lost", "found"]);
const lostFoundStatus = pgEnum("lost_found_status", [
    "open",
    "claimed",
    "closed"
]);
const inventoryReason = pgEnum("inventory_reason", [
    "restock",
    "issue",
    "return",
    "adjustment",
    "write_off"
]);
const maintenanceFrequency = pgEnum("maintenance_frequency", [
    "once",
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "yearly"
]);
const maintenanceStatus = pgEnum("maintenance_status", [
    "Scheduled",
    "In Progress",
    "Completed",
    "Cancelled"
]);

const departments = pgTable(
    "departments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        code: varchar("code", { length: 30 }).notNull(),
        name: varchar("name", { length: 120 }).notNull(),
        description: varchar("description", {
            length: 500
        })
            .notNull()
            .default(""),
        contactEmail: varchar("contact_email", { length: 320 }),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("departments_code_unique").on(table.code),
        uniqueIndex("departments_name_unique").on(table.name),
        index("departments_active_idx").on(table.isActive)
    ]
);

const complaintCategories = pgTable(
    "complaint_categories",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: varchar("name", { length: 100 }).notNull(),
        departmentId: uuid("department_id")
            .notNull()
            .references(() => departments.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        isActive: boolean("is_active").notNull().default(true),
        sortOrder: integer("sort_order").notNull().default(0),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("complaint_categories_name_unique").on(
            table.name
        ),
        index("complaint_categories_department_idx").on(
            table.departmentId
        ),
        index("complaint_categories_active_idx").on(
            table.isActive,
            table.sortOrder
        )
    ]
);

const slaPolicies = pgTable("sla_policies", {
    priority: complaintPriority("priority").primaryKey(),
    responseHours: integer("response_hours").notNull(),
    updatedAt: timestamp("updated_at", {
        withTimezone: true
    })
        .notNull()
        .defaultNow()
});

const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        legacyMongoId: text("legacy_mongo_id"),
        name: varchar("name", { length: 120 }).notNull(),
        email: varchar("email", { length: 320 }).notNull(),
        passwordHash: text("password_hash").notNull(),
        role: userRole("role").notNull().default("student"),
        departmentId: uuid("department_id").references(
            () => departments.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("users_email_lower_unique").on(
            sql`lower(${table.email})`
        ),
        uniqueIndex("users_legacy_mongo_id_unique").on(
            table.legacyMongoId
        ),
        index("users_role_idx").on(table.role),
        index("users_department_idx").on(table.departmentId)
    ]
);

const complaints = pgTable(
    "complaints",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        legacyMongoId: text("legacy_mongo_id"),
        referenceNumber: text("reference_number").notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        category: varchar("category", { length: 100 }).notNull(),
        description: text("description").notNull(),
        location: varchar("location", { length: 500 }).notNull(),
        isAnonymous: boolean("is_anonymous").notNull().default(false),
        priority: complaintPriority("priority")
            .notNull()
            .default("Medium"),
        status: complaintStatus("status")
            .notNull()
            .default("Pending"),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        departmentId: uuid("department_id")
            .notNull()
            .references(() => departments.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        assignedTo: uuid("assigned_to").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        assignedBy: uuid("assigned_by").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        assignedAt: timestamp("assigned_at", {
            withTimezone: true
        }),
        dueAt: timestamp("due_at", {
            withTimezone: true
        }).notNull(),
        resolution: text("resolution"),
        resolvedAt: timestamp("resolved_at", {
            withTimezone: true
        }),
        reopenedAt: timestamp("reopened_at", {
            withTimezone: true
        }),
        rejectionReason: varchar("rejection_reason", {
            length: 2000
        }),
        feedbackRating: smallint("feedback_rating"),
        feedbackComment: text("feedback_comment"),
        feedbackAt: timestamp("feedback_at", {
            withTimezone: true
        }),
        latitude: doublePrecision("latitude"),
        longitude: doublePrecision("longitude"),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("complaints_legacy_mongo_id_unique").on(
            table.legacyMongoId
        ),
        uniqueIndex("complaints_reference_number_unique").on(
            table.referenceNumber
        ),
        index("complaints_created_by_idx").on(table.createdBy),
        index("complaints_department_idx").on(table.departmentId),
        index("complaints_assigned_to_idx").on(table.assignedTo),
        index("complaints_status_idx").on(table.status),
        index("complaints_priority_idx").on(table.priority),
        index("complaints_due_at_idx").on(table.dueAt),
        index("complaints_department_status_idx").on(
            table.departmentId,
            table.status
        ),
        index("complaints_created_at_idx").on(table.createdAt),
        check(
            "complaints_coordinates_pair_check",
            sql`(${table.latitude} IS NULL AND ${table.longitude} IS NULL) OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL)`
        )
    ]
);

const complaintHistory = pgTable(
    "complaint_history",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        complaintId: uuid("complaint_id")
            .notNull()
            .references(() => complaints.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        eventType: varchar("event_type", {
            length: 40
        }).notNull(),
        fromStatus: complaintStatus("from_status"),
        toStatus: complaintStatus("to_status"),
        message: varchar("message", { length: 2000 }),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("complaint_history_complaint_idx").on(
            table.complaintId,
            table.createdAt
        )
    ]
);

const complaintNotes = pgTable(
    "complaint_notes",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        complaintId: uuid("complaint_id")
            .notNull()
            .references(() => complaints.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        authorId: uuid("author_id").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        visibility: noteVisibility("visibility")
            .notNull()
            .default("public"),
        message: text("message").notNull(),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("complaint_notes_complaint_idx").on(
            table.complaintId,
            table.createdAt
        )
    ]
);

const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        complaintId: uuid("complaint_id").references(
            () => complaints.id,
            {
                onDelete: "cascade",
                onUpdate: "cascade"
            }
        ),
        type: varchar("type", { length: 50 }).notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        message: varchar("message", { length: 1000 }).notNull(),
        readAt: timestamp("read_at", { withTimezone: true }),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("notifications_user_idx").on(
            table.userId,
            table.readAt,
            table.createdAt
        )
    ]
);

const notices = pgTable(
    "notices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        title: varchar("title", { length: 200 }).notNull(),
        body: text("body").notNull(),
        audience: noticeAudience("audience")
            .notNull()
            .default("all"),
        priority: noticePriority("priority")
            .notNull()
            .default("Normal"),
        publishedAt: timestamp("published_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        expiresAt: timestamp("expires_at", {
            withTimezone: true
        }),
        createdBy: uuid("created_by").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("notices_publication_idx").on(
            table.publishedAt,
            table.expiresAt
        )
    ]
);

const auditLogs = pgTable(
    "audit_logs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        action: varchar("action", { length: 80 }).notNull(),
        entityType: varchar("entity_type", {
            length: 50
        }).notNull(),
        entityId: text("entity_id"),
        metadata: jsonb("metadata")
            .notNull()
            .default(sql`'{}'::jsonb`),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("audit_logs_created_idx").on(table.createdAt),
        index("audit_logs_actor_idx").on(
            table.actorId,
            table.createdAt
        )
    ]
);

const chats = pgTable(
    "chats",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        legacyMongoId: text("legacy_mongo_id"),
        senderId: uuid("sender_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        receiverId: uuid("receiver_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        message: text("message").notNull(),
        isAI: boolean("is_ai").notNull().default(false),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("chats_legacy_mongo_id_unique").on(
            table.legacyMongoId
        ),
        index("chats_sender_idx").on(table.senderId),
        index("chats_receiver_idx").on(table.receiverId),
        index("chats_created_at_idx").on(table.createdAt),
        index("chats_thread_idx").on(
            table.senderId,
            table.receiverId,
            table.createdAt
        )
    ]
);

const complaintAttachments = pgTable(
    "complaint_attachments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        complaintId: uuid("complaint_id")
            .notNull()
            .references(() => complaints.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        uploadedBy: uuid("uploaded_by").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        fileName: varchar("file_name", {
            length: 200
        }).notNull(),
        contentType: varchar("content_type", {
            length: 50
        }).notNull(),
        byteSize: integer("byte_size").notNull(),
        dataBase64: text("data_base64").notNull(),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("complaint_attachments_complaint_idx").on(
            table.complaintId,
            table.createdAt
        )
    ]
);

const complaintUpvotes = pgTable(
    "complaint_upvotes",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        complaintId: uuid("complaint_id")
            .notNull()
            .references(() => complaints.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("complaint_upvotes_unique").on(
            table.complaintId,
            table.userId
        ),
        index("complaint_upvotes_user_idx").on(
            table.userId,
            table.createdAt
        )
    ]
);

const facilities = pgTable(
    "facilities",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        code: varchar("code", { length: 30 }).notNull(),
        name: varchar("name", { length: 120 }).notNull(),
        description: varchar("description", {
            length: 500
        })
            .notNull()
            .default(""),
        location: varchar("location", { length: 200 }).notNull(),
        capacity: integer("capacity").notNull().default(1),
        departmentId: uuid("department_id").references(
            () => departments.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        opensAt: time("opens_at").notNull().default("08:00"),
        closesAt: time("closes_at").notNull().default("22:00"),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("facilities_code_unique").on(table.code),
        uniqueIndex("facilities_name_unique").on(table.name),
        index("facilities_active_idx").on(
            table.isActive,
            table.name
        ),
        index("facilities_department_idx").on(
            table.departmentId
        )
    ]
);

const facilityBookings = pgTable(
    "facility_bookings",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        facilityId: uuid("facility_id")
            .notNull()
            .references(() => facilities.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        bookedBy: uuid("booked_by")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade"
            }),
        departmentId: uuid("department_id").references(
            () => departments.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        title: varchar("title", { length: 200 }).notNull(),
        purpose: varchar("purpose", {
            length: 2000
        })
            .notNull()
            .default(""),
        startsAt: timestamp("starts_at", {
            withTimezone: true
        }).notNull(),
        endsAt: timestamp("ends_at", {
            withTimezone: true
        }).notNull(),
        attendees: integer("attendees").notNull().default(1),
        status: bookingStatus("status")
            .notNull()
            .default("Pending"),
        reviewedBy: uuid("reviewed_by").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        reviewedAt: timestamp("reviewed_at", {
            withTimezone: true
        }),
        decisionNote: varchar("decision_note", {
            length: 1000
        }),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("facility_bookings_facility_idx").on(
            table.facilityId,
            table.startsAt
        ),
        index("facility_bookings_booker_idx").on(
            table.bookedBy,
            table.createdAt
        ),
        index("facility_bookings_status_idx").on(
            table.status,
            table.startsAt
        ),
        index("facility_bookings_department_idx").on(
            table.departmentId,
            table.startsAt
        )
    ]
);

const lostFoundItems = pgTable(
    "lost_found_items",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        reporterId: uuid("reporter_id").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        type: lostFoundType("type").notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        description: text("description").notNull(),
        category: varchar("category", {
            length: 80
        })
            .notNull()
            .default("Other"),
        location: varchar("location", {
            length: 200
        }).notNull(),
        occurredAt: timestamp("occurred_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        status: lostFoundStatus("status")
            .notNull()
            .default("open"),
        claimedBy: uuid("claimed_by").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        contact: varchar("contact", {
            length: 320
        })
            .notNull()
            .default(""),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("lost_found_status_idx").on(
            table.status,
            table.occurredAt
        ),
        index("lost_found_type_idx").on(
            table.type,
            table.occurredAt
        ),
        index("lost_found_reporter_idx").on(
            table.reporterId,
            table.createdAt
        )
    ]
);

const inventoryItems = pgTable(
    "inventory_items",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sku: varchar("sku", { length: 50 }),
        name: varchar("name", { length: 160 }).notNull(),
        category: varchar("category", {
            length: 80
        })
            .notNull()
            .default("General"),
        departmentId: uuid("department_id").references(
            () => departments.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        location: varchar("location", {
            length: 160
        })
            .notNull()
            .default(""),
        quantity: integer("quantity").notNull().default(0),
        unit: varchar("unit", { length: 30 })
            .notNull()
            .default("units"),
        reorderLevel: integer("reorder_level")
            .notNull()
            .default(0),
        unitCost: numeric("unit_cost", {
            precision: 12,
            scale: 2
        }),
        notes: varchar("notes", {
            length: 500
        })
            .notNull()
            .default(""),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        uniqueIndex("inventory_items_sku_unique").on(table.sku),
        index("inventory_items_department_idx").on(
            table.departmentId,
            table.name
        ),
        index("inventory_items_active_idx").on(
            table.isActive,
            table.name
        )
    ]
);

const inventoryTransactions = pgTable(
    "inventory_transactions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        itemId: uuid("item_id")
            .notNull()
            .references(() => inventoryItems.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        delta: integer("delta").notNull(),
        reason: inventoryReason("reason").notNull(),
        note: varchar("note", {
            length: 500
        })
            .notNull()
            .default(""),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("inventory_transactions_item_idx").on(
            table.itemId,
            table.createdAt
        ),
        index("inventory_transactions_actor_idx").on(
            table.actorId,
            table.createdAt
        )
    ]
);

const maintenanceTasks = pgTable(
    "maintenance_tasks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        title: varchar("title", { length: 200 }).notNull(),
        description: text("description")
            .notNull()
            .default(""),
        assetName: varchar("asset_name", {
            length: 200
        })
            .notNull()
            .default(""),
        location: varchar("location", {
            length: 200
        })
            .notNull()
            .default(""),
        departmentId: uuid("department_id").references(
            () => departments.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        assignedTo: uuid("assigned_to").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        frequency: maintenanceFrequency("frequency")
            .notNull()
            .default("monthly"),
        nextDueAt: timestamp("next_due_at", {
            withTimezone: true
        }).notNull(),
        lastCompletedAt: timestamp("last_completed_at", {
            withTimezone: true
        }),
        status: maintenanceStatus("status")
            .notNull()
            .default("Scheduled"),
        priority: complaintPriority("priority")
            .notNull()
            .default("Medium"),
        createdBy: uuid("created_by").references(
            () => users.id,
            {
                onDelete: "set null",
                onUpdate: "cascade"
            }
        ),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("maintenance_tasks_due_idx").on(
            table.status,
            table.nextDueAt
        ),
        index("maintenance_tasks_department_idx").on(
            table.departmentId,
            table.nextDueAt
        ),
        index("maintenance_tasks_assignee_idx").on(
            table.assignedTo,
            table.nextDueAt
        )
    ]
);

const maintenanceLogs = pgTable(
    "maintenance_logs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        taskId: uuid("task_id")
            .notNull()
            .references(() => maintenanceTasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
            onUpdate: "cascade"
        }),
        note: varchar("note", {
            length: 1000
        })
            .notNull()
            .default(""),
        completedAt: timestamp("completed_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow(),
        createdAt: timestamp("created_at", {
            withTimezone: true
        })
            .notNull()
            .defaultNow()
    },
    (table) => [
        index("maintenance_logs_task_idx").on(
            table.taskId,
            table.completedAt
        )
    ]
);

module.exports = {
    users,
    departments,
    complaintCategories,
    slaPolicies,
    complaints,
    complaintHistory,
    complaintNotes,
    complaintAttachments,
    complaintUpvotes,
    notifications,
    notices,
    auditLogs,
    chats,
    facilities,
    facilityBookings,
    lostFoundItems,
    inventoryItems,
    inventoryTransactions,
    maintenanceTasks,
    maintenanceLogs,
    userRole,
    complaintPriority,
    complaintStatus,
    noteVisibility,
    noticeAudience,
    noticePriority,
    bookingStatus,
    lostFoundType,
    lostFoundStatus,
    inventoryReason,
    maintenanceFrequency,
    maintenanceStatus
};
