-- CampusFix campus services v3.
-- Additive only: existing users, complaints, chats, notices and history keep
-- their identifiers, records and timestamps. No existing row is rewritten.

-- ---------------------------------------------------------------------------
-- Complaint photo attachments, anonymous reporting and upvotes
-- ---------------------------------------------------------------------------

ALTER TABLE complaints
    ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;

CREATE TABLE complaint_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid NOT NULL
        REFERENCES complaints (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    uploaded_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    file_name varchar(200) NOT NULL
        CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 200),
    content_type varchar(50) NOT NULL
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size integer NOT NULL
        CHECK (byte_size BETWEEN 1 AND 800000),
    data_base64 text NOT NULL
        CHECK (char_length(data_base64) BETWEEN 4 AND 1200000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complaint_attachments_complaint_idx
    ON complaint_attachments (complaint_id, created_at);

CREATE TABLE complaint_upvotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid NOT NULL
        REFERENCES complaints (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    user_id uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX complaint_upvotes_unique
    ON complaint_upvotes (complaint_id, user_id);
CREATE INDEX complaint_upvotes_user_idx
    ON complaint_upvotes (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Facility booking
-- ---------------------------------------------------------------------------

CREATE TYPE booking_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected',
    'Cancelled',
    'Completed'
);

CREATE TABLE facilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL UNIQUE
        CHECK (code = upper(code) AND code ~ '^[A-Z0-9_]{2,30}$'),
    name varchar(120) NOT NULL UNIQUE
        CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
    description varchar(500) NOT NULL DEFAULT ''
        CHECK (char_length(description) <= 500),
    location varchar(200) NOT NULL
        CHECK (char_length(btrim(location)) BETWEEN 1 AND 200),
    capacity integer NOT NULL DEFAULT 1
        CHECK (capacity BETWEEN 1 AND 100000),
    department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    opens_at time NOT NULL DEFAULT '08:00',
    closes_at time NOT NULL DEFAULT '22:00',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT facilities_hours_check CHECK (opens_at < closes_at)
);

CREATE INDEX facilities_active_idx ON facilities (is_active, name);
CREATE INDEX facilities_department_idx ON facilities (department_id);

CREATE TRIGGER facilities_set_updated_at
BEFORE UPDATE ON facilities
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE facility_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id uuid NOT NULL
        REFERENCES facilities (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    booked_by uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
    purpose varchar(2000) NOT NULL DEFAULT ''
        CHECK (char_length(purpose) <= 2000),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    attendees integer NOT NULL DEFAULT 1
        CHECK (attendees BETWEEN 1 AND 100000),
    status booking_status NOT NULL DEFAULT 'Pending',
    reviewed_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    reviewed_at timestamptz,
    decision_note varchar(1000)
        CHECK (
            decision_note IS NULL
            OR char_length(btrim(decision_note)) BETWEEN 1 AND 1000
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT facility_bookings_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX facility_bookings_facility_idx
    ON facility_bookings (facility_id, starts_at);
CREATE INDEX facility_bookings_booker_idx
    ON facility_bookings (booked_by, created_at DESC);
CREATE INDEX facility_bookings_status_idx
    ON facility_bookings (status, starts_at);
CREATE INDEX facility_bookings_department_idx
    ON facility_bookings (department_id, starts_at);

CREATE TRIGGER facility_bookings_set_updated_at
BEFORE UPDATE ON facility_bookings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO facilities (
    code,
    name,
    description,
    location,
    capacity,
    department_id
)
SELECT
    seed.code,
    seed.name,
    seed.description,
    seed.location,
    seed.capacity,
    d.id
FROM (VALUES
    (
        'SEMINAR',
        'Seminar Hall',
        'Projector, podium, air conditioning and seating for seminars.',
        'Academic Block A, First Floor',
        120,
        'ACADEMICS'
    ),
    (
        'AUDITORIUM',
        'Main Auditorium',
        'Large auditorium for campus events and guest lectures.',
        'Administration Block',
        400,
        'GENERAL'
    ),
    (
        'SPORTS_GROUND',
        'Sports Ground',
        'Open ground for sports, drills and outdoor events.',
        'Sports Complex',
        200,
        'GENERAL'
    ),
    (
        'LIBRARY_ROOM',
        'Library Discussion Room',
        'Quiet group room with whiteboard and display.',
        'Central Library, Second Floor',
        12,
        'LIBRARY'
    ),
    (
        'COMPUTER_LAB',
        'Computer Lab 1',
        'Networked computers for workshops and practical sessions.',
        'IT Block, Ground Floor',
        40,
        'IT'
    ),
    (
        'CONFERENCE',
        'Conference Room',
        'Meeting room for department and committee meetings.',
        'Administration Block, Second Floor',
        20,
        'GENERAL'
    )
) AS seed(code, name, description, location, capacity, department_code)
JOIN departments d ON d.code = seed.department_code;

-- ---------------------------------------------------------------------------
-- Lost & Found
-- ---------------------------------------------------------------------------

CREATE TYPE lost_found_type AS ENUM ('lost', 'found');
CREATE TYPE lost_found_status AS ENUM ('open', 'claimed', 'closed');

CREATE TABLE lost_found_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    type lost_found_type NOT NULL,
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
    description text NOT NULL
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
    category varchar(80) NOT NULL DEFAULT 'Other'
        CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
    location varchar(200) NOT NULL
        CHECK (char_length(btrim(location)) BETWEEN 1 AND 200),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    status lost_found_status NOT NULL DEFAULT 'open',
    claimed_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    contact varchar(320) NOT NULL DEFAULT ''
        CHECK (char_length(contact) <= 320),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lost_found_status_idx
    ON lost_found_items (status, occurred_at DESC);
CREATE INDEX lost_found_type_idx
    ON lost_found_items (type, occurred_at DESC);
CREATE INDEX lost_found_reporter_idx
    ON lost_found_items (reporter_id, created_at DESC);

CREATE TRIGGER lost_found_items_set_updated_at
BEFORE UPDATE ON lost_found_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TYPE inventory_reason AS ENUM (
    'restock',
    'issue',
    'return',
    'adjustment',
    'write_off'
);

CREATE TABLE inventory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku varchar(50) UNIQUE
        CHECK (
            sku IS NULL
            OR (sku = upper(sku) AND char_length(sku) BETWEEN 2 AND 50)
        ),
    name varchar(160) NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
    category varchar(80) NOT NULL DEFAULT 'General'
        CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
    department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    location varchar(160) NOT NULL DEFAULT ''
        CHECK (char_length(location) <= 160),
    quantity integer NOT NULL DEFAULT 0
        CHECK (quantity >= 0),
    unit varchar(30) NOT NULL DEFAULT 'units'
        CHECK (char_length(btrim(unit)) BETWEEN 1 AND 30),
    reorder_level integer NOT NULL DEFAULT 0
        CHECK (reorder_level >= 0),
    unit_cost numeric(12, 2)
        CHECK (unit_cost IS NULL OR unit_cost >= 0),
    notes varchar(500) NOT NULL DEFAULT ''
        CHECK (char_length(notes) <= 500),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_items_department_idx
    ON inventory_items (department_id, name);
CREATE INDEX inventory_items_active_idx
    ON inventory_items (is_active, name);

CREATE TRIGGER inventory_items_set_updated_at
BEFORE UPDATE ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventory_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL
        REFERENCES inventory_items (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    actor_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    delta integer NOT NULL CHECK (delta <> 0),
    reason inventory_reason NOT NULL,
    note varchar(500) NOT NULL DEFAULT ''
        CHECK (char_length(note) <= 500),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_transactions_item_idx
    ON inventory_transactions (item_id, created_at DESC);
CREATE INDEX inventory_transactions_actor_idx
    ON inventory_transactions (actor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Preventive maintenance
-- ---------------------------------------------------------------------------

CREATE TYPE maintenance_frequency AS ENUM (
    'once',
    'daily',
    'weekly',
    'monthly',
    'quarterly',
    'yearly'
);

CREATE TYPE maintenance_status AS ENUM (
    'Scheduled',
    'In Progress',
    'Completed',
    'Cancelled'
);

CREATE TABLE maintenance_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
    description text NOT NULL DEFAULT ''
        CHECK (char_length(description) <= 3000),
    asset_name varchar(200) NOT NULL DEFAULT ''
        CHECK (char_length(asset_name) <= 200),
    location varchar(200) NOT NULL DEFAULT ''
        CHECK (char_length(location) <= 200),
    department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    assigned_to uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    frequency maintenance_frequency NOT NULL DEFAULT 'monthly',
    next_due_at timestamptz NOT NULL,
    last_completed_at timestamptz,
    status maintenance_status NOT NULL DEFAULT 'Scheduled',
    priority complaint_priority NOT NULL DEFAULT 'Medium',
    created_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_tasks_due_idx
    ON maintenance_tasks (status, next_due_at);
CREATE INDEX maintenance_tasks_department_idx
    ON maintenance_tasks (department_id, next_due_at);
CREATE INDEX maintenance_tasks_assignee_idx
    ON maintenance_tasks (assigned_to, next_due_at);

CREATE TRIGGER maintenance_tasks_set_updated_at
BEFORE UPDATE ON maintenance_tasks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE maintenance_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL
        REFERENCES maintenance_tasks (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    actor_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    note varchar(1000) NOT NULL DEFAULT ''
        CHECK (char_length(note) <= 1000),
    completed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_logs_task_idx
    ON maintenance_logs (task_id, completed_at DESC);
