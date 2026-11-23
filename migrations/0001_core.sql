PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Calcutta',
  target_attempt TEXT NOT NULL DEFAULT 'May 2028',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE syllabus_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applicable_attempt TEXT NOT NULL,
  scheme TEXT NOT NULL,
  source_url TEXT,
  source_status TEXT NOT NULL DEFAULT 'pending' CHECK (source_status IN ('pending', 'verified', 'superseded')),
  effective_from TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, applicable_attempt, scheme)
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  syllabus_version_id TEXT NOT NULL REFERENCES syllabus_versions(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  parent_chapter_id TEXT REFERENCES chapters(id),
  code TEXT,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'learning', 'notes_in_progress', 'first_revision', 'practised', 'exam_ready', 'needs_improvement')),
  source_reference TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX chapters_subject_version_idx ON chapters(subject_id, syllabus_version_id, position);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  parent_topic_id TEXT REFERENCES topics(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX topics_chapter_idx ON topics(chapter_id, position);

CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id),
  chapter_id TEXT REFERENCES chapters(id),
  activity TEXT NOT NULL CHECK (activity IN ('reading', 'note_making', 'practice', 'revision', 'mock_test', 'lecture', 'other')),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX study_sessions_user_start_idx ON study_sessions(user_id, started_at DESC);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  access_type TEXT NOT NULL DEFAULT 'unknown' CHECK (access_type IN ('public', 'login_required', 'subscription_required', 'unknown')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'working', 'broken', 'redirected', 'private', 'login_required')),
  provider TEXT,
  attempt TEXT,
  scheme TEXT,
  language TEXT,
  duration_seconds INTEGER,
  published_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resource_sources (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  collection_method TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_id, source_url)
);

CREATE TABLE resource_discovery_jobs (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  started_at TEXT,
  finished_at TEXT,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resource_mappings (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  chapter_id TEXT REFERENCES chapters(id),
  topic_id TEXT REFERENCES topics(id),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX resource_mappings_review_idx ON resource_mappings(review_status, subject_id);

CREATE TABLE resource_verification_logs (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  detail TEXT
);

CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('started', 'complete', 'failed', 'verified')),
  byte_length INTEGER,
  checksum TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  error_summary TEXT
);

INSERT INTO subjects (id, code, name, position) VALUES
  ('subject-fr', 'FR', 'Financial Reporting', 1),
  ('subject-afm', 'AFM', 'Advanced Financial Management', 2),
  ('subject-audit', 'AUDIT', 'Advanced Auditing, Assurance & Professional Ethics', 3),
  ('subject-dt', 'DT', 'Direct Tax Laws & International Taxation', 4),
  ('subject-idt', 'IDT', 'Indirect Tax Laws', 5),
  ('subject-ibs', 'IBS', 'Integrated Business Solutions', 6);

-- The attempt is recorded, but the ICAI syllabus mapping is intentionally pending verification.
INSERT INTO syllabus_versions (id, name, applicable_attempt, scheme, source_status)
VALUES ('syllabus-may-2028-draft', 'CA Final syllabus reference', 'May 2028', 'scheme-to-be-verified', 'pending');
