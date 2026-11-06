-- CampusFix PostgreSQL schema, migrated from the original MongoDB models.
-- Existing MongoDB data is preserved through the legacy_mongo_id columns.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('student', 'admin');
CREATE TYPE complaint_priority AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE complaint_status AS ENUM ('Pending', 'In Progress', 'Resolved');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_mongo_id text,
    name varchar(120) NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    email varchar(320) NOT NULL
        CHECK (
            email = lower(email)
            AND char_length(email) BETWEEN 3 AND 320
        ),
    password_hash text NOT NULL
        CHECK (char_length(password_hash) BETWEEN 20 AND 255),
    role user_role NOT NULL DEFAULT 'student',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));
CREATE UNIQUE INDEX users_legacy_mongo_id_unique ON users (legacy_mongo_id);
CREATE INDEX users_role_idx ON users (role);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE complaints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_mongo_id text,
    title varchar(200) NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    category varchar(100) NOT NULL
        CHECK (char_length(btrim(category)) BETWEEN 1 AND 100),
    description text NOT NULL
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 20000),
    location varchar(500) NOT NULL
        CHECK (char_length(btrim(location)) BETWEEN 1 AND 500),
    priority complaint_priority NOT NULL DEFAULT 'Medium',
    status complaint_status NOT NULL DEFAULT 'Pending',
    created_by uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX complaints_legacy_mongo_id_unique
    ON complaints (legacy_mongo_id);
CREATE INDEX complaints_created_by_idx ON complaints (created_by);
CREATE INDEX complaints_status_idx ON complaints (status);
CREATE INDEX complaints_priority_idx ON complaints (priority);
CREATE INDEX complaints_created_at_idx ON complaints (created_at DESC);

CREATE TRIGGER complaints_set_updated_at
BEFORE UPDATE ON complaints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_mongo_id text,
    sender_id uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    receiver_id uuid NOT NULL
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    message text NOT NULL
        CHECK (char_length(btrim(message)) BETWEEN 1 AND 10000),
    is_ai boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chats_legacy_mongo_id_unique
    ON chats (legacy_mongo_id);
CREATE INDEX chats_sender_idx ON chats (sender_id);
CREATE INDEX chats_receiver_idx ON chats (receiver_id);
CREATE INDEX chats_created_at_idx ON chats (created_at);
CREATE INDEX chats_thread_idx
    ON chats (sender_id, receiver_id, created_at);

CREATE TRIGGER chats_set_updated_at
BEFORE UPDATE ON chats
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
