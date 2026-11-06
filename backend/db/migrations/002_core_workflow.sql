-- CampusFix core workflow v2.
-- Additive and backward-compatible: existing users, complaints and chats keep
-- their identifiers, timestamps, ownership and legacy MongoDB identifiers.

-- ---------------------------------------------------------------------------
-- Expanded roles and complaint enums
-- ---------------------------------------------------------------------------

ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TYPE user_role RENAME TO user_role_v1;
CREATE TYPE user_role AS ENUM (
    'student',
    'staff',
    'department_manager',
    'admin'
);
ALTER TABLE users
    ALTER COLUMN role TYPE user_role
    USING role::text::user_role;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'student';
DROP TYPE user_role_v1;

ALTER TABLE complaints ALTER COLUMN priority DROP DEFAULT;
ALTER TYPE complaint_priority RENAME TO complaint_priority_v1;
CREATE TYPE complaint_priority AS ENUM (
    'Low',
    'Medium',
    'High',
    'Critical'
);
ALTER TABLE complaints
    ALTER COLUMN priority TYPE complaint_priority
    USING priority::text::complaint_priority;
ALTER TABLE complaints ALTER COLUMN priority SET DEFAULT 'Medium';
DROP TYPE complaint_priority_v1;

ALTER TABLE complaints ALTER COLUMN status DROP DEFAULT;
ALTER TYPE complaint_status RENAME TO complaint_status_v1;
CREATE TYPE complaint_status AS ENUM (
    'Pending',
    'Assigned',
    'In Progress',
    'Resolved',
    'Reopened',
    'Rejected'
);
ALTER TABLE complaints
    ALTER COLUMN status TYPE complaint_status
    USING status::text::complaint_status;
ALTER TABLE complaints ALTER COLUMN status SET DEFAULT 'Pending';
DROP TYPE complaint_status_v1;

CREATE TYPE note_visibility AS ENUM ('internal', 'public');
CREATE TYPE notice_audience AS ENUM ('all', 'students', 'staff');
CREATE TYPE notice_priority AS ENUM ('Normal', 'High');

-- ---------------------------------------------------------------------------
-- Departments, complaint categories and service-level policies
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL UNIQUE
        CHECK (code = upper(code) AND code ~ '^[A-Z0-9_]{2,30}$'),
    name varchar(120) NOT NULL UNIQUE
        CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
    description varchar(500) NOT NULL DEFAULT ''
        CHECK (char_length(description) <= 500),
    contact_email varchar(320)
        CHECK (
            contact_email IS NULL
            OR (
                contact_email = lower(contact_email)
                AND char_length(contact_email) BETWEEN 3 AND 320
            )
        ),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER departments_set_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE complaint_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL UNIQUE
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    department_id uuid NOT NULL
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
        CHECK (sort_order BETWEEN 0 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complaint_categories_department_idx
    ON complaint_categories (department_id);
CREATE INDEX complaint_categories_active_idx
    ON complaint_categories (is_active, sort_order);

CREATE TRIGGER complaint_categories_set_updated_at
BEFORE UPDATE ON complaint_categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO departments (code, name, description) VALUES
    ('ELECTRICAL', 'Electrical Maintenance', 'Electrical faults, lighting, fans, power and related repairs.'),
    ('PLUMBING', 'Plumbing & Water', 'Water supply, taps, sanitary fittings and drainage.'),
    ('HOUSEKEEPING', 'Housekeeping', 'Cleaning, sanitation, waste collection and campus upkeep.'),
    ('IT', 'IT & Network', 'Wi-Fi, computers, software, projectors and network services.'),
    ('CIVIL', 'Civil & Works', 'Civil repairs, furniture, buildings, roads and structural issues.'),
    ('HOSTEL', 'Hostel Services', 'Hostel rooms, common areas and residential facilities.'),
    ('LIBRARY', 'Library', 'Library facilities, reading rooms, books and digital resources.'),
    ('SECURITY', 'Campus Security', 'Safety, access control and security concerns.'),
    ('ACADEMICS', 'Academic Services', 'Classrooms, laboratories and academic infrastructure.'),
    ('GENERAL', 'General Administration', 'Issues that need general campus administration.');

-- Active choices shown to students. Legacy labels remain available below for
-- existing records and imports, but are not offered for new complaints.
INSERT INTO complaint_categories (name, department_id, is_active, sort_order)
SELECT value_name, d.id, active, sort_order
FROM (VALUES
    ('Electrical', 'ELECTRICAL', true, 10),
    ('Plumbing', 'PLUMBING', true, 20),
    ('Cleaning', 'HOUSEKEEPING', true, 30),
    ('Wi-Fi/IT', 'IT', true, 40),
    ('Classroom', 'ACADEMICS', true, 50),
    ('Laboratory', 'ACADEMICS', true, 60),
    ('Hostel', 'HOSTEL', true, 70),
    ('Library', 'LIBRARY', true, 80),
    ('Security', 'SECURITY', true, 90),
    ('Other', 'GENERAL', true, 100),
    ('Electricity', 'ELECTRICAL', false, 110),
    ('Water', 'PLUMBING', false, 120),
    ('Cleanliness', 'HOUSEKEEPING', false, 130),
    ('Wi-Fi', 'IT', false, 140),
    ('Washroom', 'HOUSEKEEPING', false, 150),
    ('Canteen', 'HOUSEKEEPING', false, 160)
) AS seed(value_name, department_code, active, sort_order)
JOIN departments d ON d.code = seed.department_code;

CREATE TABLE sla_policies (
    priority complaint_priority PRIMARY KEY,
    response_hours integer NOT NULL
        CHECK (response_hours BETWEEN 1 AND 8760),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sla_policies (priority, response_hours) VALUES
    ('Low', 168),
    ('Medium', 72),
    ('High', 24),
    ('Critical', 4);

CREATE TRIGGER sla_policies_set_updated_at
BEFORE UPDATE ON sla_policies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Users: department membership for staff and department managers
-- ---------------------------------------------------------------------------

ALTER TABLE users
    ADD COLUMN department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;

ALTER TABLE users
    ADD CONSTRAINT users_operations_department_check
    CHECK (
        role NOT IN ('staff', 'department_manager')
        OR department_id IS NOT NULL
    );

CREATE INDEX users_department_idx ON users (department_id);

-- ---------------------------------------------------------------------------
-- Complaint workflow columns
-- ---------------------------------------------------------------------------

CREATE SEQUENCE complaint_reference_seq START WITH 1;

ALTER TABLE complaints
    ADD COLUMN reference_number text,
    ADD COLUMN department_id uuid
        REFERENCES departments (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    ADD COLUMN assigned_to uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    ADD COLUMN assigned_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    ADD COLUMN assigned_at timestamptz,
    ADD COLUMN due_at timestamptz,
    ADD COLUMN resolution text
        CHECK (
            resolution IS NULL
            OR char_length(btrim(resolution)) BETWEEN 1 AND 5000
        ),
    ADD COLUMN resolved_at timestamptz,
    ADD COLUMN reopened_at timestamptz,
    ADD COLUMN rejection_reason varchar(2000)
        CHECK (
            rejection_reason IS NULL
            OR char_length(btrim(rejection_reason)) BETWEEN 1 AND 2000
        ),
    ADD COLUMN feedback_rating smallint
        CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 1 AND 5),
    ADD COLUMN feedback_comment text
        CHECK (
            feedback_comment IS NULL
            OR char_length(btrim(feedback_comment)) BETWEEN 1 AND 2000
        ),
    ADD COLUMN feedback_at timestamptz,
    ADD COLUMN latitude double precision
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD COLUMN longitude double precision
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

UPDATE complaints c
SET department_id = cc.department_id
FROM complaint_categories cc
WHERE lower(cc.name) = lower(c.category);

UPDATE complaints
SET department_id = (
    SELECT id FROM departments WHERE code = 'GENERAL'
)
WHERE department_id IS NULL;

UPDATE complaints c
SET due_at = c.created_at + make_interval(hours => s.response_hours)
FROM sla_policies s
WHERE s.priority = c.priority;

UPDATE complaints
SET reference_number =
    'CF-' ||
    to_char(created_at, 'YYYY') ||
    '-' ||
    lpad(nextval('complaint_reference_seq')::text, 6, '0');

ALTER TABLE complaints
    ALTER COLUMN department_id SET NOT NULL,
    ALTER COLUMN due_at SET NOT NULL,
    ALTER COLUMN reference_number SET NOT NULL,
    ALTER COLUMN reference_number SET DEFAULT (
        'CF-' ||
        to_char(now(), 'YYYY') ||
        '-' ||
        lpad(nextval('complaint_reference_seq')::text, 6, '0')
    );

ALTER TABLE complaints
    ADD CONSTRAINT complaints_coordinates_pair_check
    CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL)
    );

CREATE UNIQUE INDEX complaints_reference_number_unique
    ON complaints (reference_number);
CREATE INDEX complaints_department_idx
    ON complaints (department_id);
CREATE INDEX complaints_assigned_to_idx
    ON complaints (assigned_to);
CREATE INDEX complaints_due_at_idx
    ON complaints (due_at);
CREATE INDEX complaints_department_status_idx
    ON complaints (department_id, status);

-- Resolve a department and SLA deadline for inserts that do not provide them
-- explicitly (for example the verified MongoDB importer and future scripts).
CREATE OR REPLACE FUNCTION prepare_complaint_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number :=
            'CF-' ||
            to_char(COALESCE(NEW.created_at, now()), 'YYYY') ||
            '-' ||
            lpad(nextval('complaint_reference_seq')::text, 6, '0');
    END IF;

    IF NEW.department_id IS NULL THEN
        SELECT cc.department_id
        INTO NEW.department_id
        FROM complaint_categories cc
        WHERE lower(cc.name) = lower(NEW.category)
        LIMIT 1;
    END IF;

    IF NEW.department_id IS NULL THEN
        SELECT d.id
        INTO NEW.department_id
        FROM departments d
        WHERE d.code = 'GENERAL';
    END IF;

    IF NEW.due_at IS NULL THEN
        SELECT COALESCE(NEW.created_at, now()) +
               make_interval(hours => s.response_hours)
        INTO NEW.due_at
        FROM sla_policies s
        WHERE s.priority = NEW.priority;

        IF NEW.due_at IS NULL THEN
            NEW.due_at := COALESCE(NEW.created_at, now()) +
                interval '72 hours';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER complaints_prepare_defaults
BEFORE INSERT ON complaints
FOR EACH ROW
EXECUTE FUNCTION prepare_complaint_defaults();

-- ---------------------------------------------------------------------------
-- Complaint timeline, notes, notifications and audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE complaint_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid NOT NULL
        REFERENCES complaints (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    actor_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    event_type varchar(40) NOT NULL
        CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 40),
    from_status complaint_status,
    to_status complaint_status,
    message varchar(2000)
        CHECK (
            message IS NULL
            OR char_length(message) BETWEEN 1 AND 2000
        ),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complaint_history_complaint_idx
    ON complaint_history (complaint_id, created_at);

CREATE TABLE complaint_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid NOT NULL
        REFERENCES complaints (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    author_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    visibility note_visibility NOT NULL DEFAULT 'public',
    message text NOT NULL
        CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complaint_notes_complaint_idx
    ON complaint_notes (complaint_id, created_at);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    complaint_id uuid
        REFERENCES complaints (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    type varchar(50) NOT NULL
        CHECK (char_length(btrim(type)) BETWEEN 1 AND 50),
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    message varchar(1000) NOT NULL
        CHECK (char_length(btrim(message)) BETWEEN 1 AND 1000),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx
    ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE notices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    body text NOT NULL
        CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
    audience notice_audience NOT NULL DEFAULT 'all',
    priority notice_priority NOT NULL DEFAULT 'Normal',
    published_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    created_by uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notices_expiry_check
        CHECK (expires_at IS NULL OR expires_at > published_at)
);

CREATE INDEX notices_publication_idx
    ON notices (published_at DESC, expires_at);

CREATE TRIGGER notices_set_updated_at
BEFORE UPDATE ON notices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    action varchar(80) NOT NULL
        CHECK (char_length(btrim(action)) BETWEEN 1 AND 80),
    entity_type varchar(50) NOT NULL
        CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 50),
    entity_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_created_idx
    ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx
    ON audit_logs (actor_id, created_at DESC);

INSERT INTO complaint_history (
    complaint_id,
    actor_id,
    event_type,
    message,
    created_at
)
SELECT
    id,
    created_by,
    'created',
    'Complaint record created.',
    created_at
FROM complaints;

INSERT INTO complaint_history (
    complaint_id,
    actor_id,
    event_type,
    to_status,
    message,
    created_at
)
SELECT
    id,
    created_by,
    'status_changed',
    status,
    'Current status preserved from the legacy record.',
    updated_at
FROM complaints
WHERE status <> 'Pending';
