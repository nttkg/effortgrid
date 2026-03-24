-- 1. Master Entities (マスターエンティティ)
-- These tables define the core, globally unique entities within the system.

CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT
);

-- "wbs_elements" and "milestones" act as anchors.
-- They only hold a global ID and project association, not stateful details like name or hierarchy.
-- This separates "what it is" from "what it was in a specific plan".

CREATE TABLE wbs_elements (
    id INTEGER PRIMARY KEY, -- Global ID
    project_id INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE milestones (
    id INTEGER PRIMARY KEY, -- Global ID
    project_id INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 2. Plan Versioning (計画バージョニング)
-- This table manages different versions or snapshots of a project plan.

CREATE TABLE plan_versions (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL, -- e.g., "Working Draft", "V1 Baseline"
    is_draft INTEGER NOT NULL CHECK(is_draft IN (0, 1)), -- SQLite boolean
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 3. Plan Snapshot Details (計画スナップショットの詳細)
-- These tables store the state of entities *within* a specific plan_version.
-- When a baseline is created, records here are full-copied with a new plan_version_id.

CREATE TABLE plan_milestones (
    id INTEGER PRIMARY KEY,
    plan_version_id INTEGER NOT NULL,
    milestone_id INTEGER NOT NULL, -- Global ID
    name TEXT NOT NULL,
    target_date TEXT NOT NULL, -- ISO8601 YYYY-MM-DD
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE
);

CREATE TABLE wbs_element_details (
    id INTEGER PRIMARY KEY,
    plan_version_id INTEGER NOT NULL,
    wbs_element_id INTEGER NOT NULL, -- Global ID
    parent_element_id INTEGER, -- Refers to wbs_elements.id (Global ID), nullable for root
    milestone_id INTEGER, -- Global ID, nullable
    title TEXT NOT NULL,
    description TEXT, -- Markdown content
    element_type TEXT NOT NULL CHECK(element_type IN ('Project', 'WorkPackage', 'Activity')),
    estimated_pv REAL, -- Estimated Planned Value (e.g., man-hours, points)
    tags TEXT, -- JSON array of strings
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (wbs_element_id) REFERENCES wbs_elements(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_element_id) REFERENCES wbs_elements(id) ON DELETE SET NULL,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
);

-- Time-phased allocation of Planned Value (PV)
CREATE TABLE pv_allocations (
    id INTEGER PRIMARY KEY,
    plan_version_id INTEGER NOT NULL,
    wbs_element_id INTEGER NOT NULL, -- Global ID
    user_id INTEGER, -- Nullable for unassigned tasks
    start_date TEXT NOT NULL, -- ISO8601 YYYY-MM-DD
    end_date TEXT NOT NULL, -- ISO8601 YYYY-MM-DD
    planned_value REAL NOT NULL,
    FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (wbs_element_id) REFERENCES wbs_elements(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 4. Reality Data (実績データ)
-- These tables are independent of plan_versions and are linked directly to global IDs.
-- They represent the immutable truth of what actually happened.

-- Actual Cost (AC) incurred
CREATE TABLE actual_costs (
    id INTEGER PRIMARY KEY,
    wbs_element_id INTEGER NOT NULL, -- Global ID
    user_id INTEGER NOT NULL,
    work_date TEXT NOT NULL, -- ISO8601 YYYY-MM-DD
    actual_cost REAL NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    FOREIGN KEY (wbs_element_id) REFERENCES wbs_elements(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Progress updates, the source for Earned Value (EV)
CREATE TABLE progress_updates (
    id INTEGER PRIMARY KEY,
    wbs_element_id INTEGER NOT NULL, -- Global ID
    reported_by_user_id INTEGER NOT NULL,
    report_date TEXT NOT NULL, -- ISO8601 YYYY-MM-DD
    progress_percent REAL NOT NULL CHECK(progress_percent >= 0 AND progress_percent <= 100),
    notes TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    FOREIGN KEY (wbs_element_id) REFERENCES wbs_elements(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);
