ALTER TABLE resources ADD COLUMN youtube_video_id TEXT;
ALTER TABLE resources ADD COLUMN youtube_channel_id TEXT;
ALTER TABLE resources ADD COLUMN youtube_channel_title TEXT;
ALTER TABLE resources ADD COLUMN youtube_playlist_id TEXT;
ALTER TABLE resources ADD COLUMN description TEXT;
ALTER TABLE resources ADD COLUMN thumbnail_url TEXT;
ALTER TABLE resources ADD COLUMN youtube_duration_iso TEXT;
ALTER TABLE resources ADD COLUMN captions_available INTEGER CHECK (captions_available IN (0, 1));
ALTER TABLE resources ADD COLUMN lecture_type TEXT;
ALTER TABLE resources ADD COLUMN attempt_relevance TEXT NOT NULL DEFAULT 'unverified';
CREATE UNIQUE INDEX resources_youtube_video_unique ON resources(youtube_video_id) WHERE youtube_video_id IS NOT NULL;

CREATE TABLE user_faculty_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  faculty_name TEXT NOT NULL,
  search_aliases TEXT NOT NULL DEFAULT '',
  preferred_channel_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, subject_id)
);

CREATE TABLE youtube_faculty_channels (
  channel_id TEXT PRIMARY KEY,
  channel_title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  custom_url TEXT,
  identity_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (identity_status IN ('pending_review', 'verified', 'rejected')),
  verification_evidence TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'youtube_search' CHECK (source IN ('youtube_search', 'manual')),
  matched_subject_id TEXT REFERENCES subjects(id),
  preferred_faculty_name TEXT,
  identity_checked_at TEXT,
  uploads_playlist_id TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE youtube_playlists (
  playlist_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  channel_id TEXT,
  channel_title TEXT,
  thumbnail_url TEXT,
  published_at TEXT,
  item_count INTEGER,
  subject_id TEXT REFERENCES subjects(id),
  attempt_relevance TEXT NOT NULL DEFAULT 'unverified',
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE youtube_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES youtube_playlists(playlist_id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT,
  PRIMARY KEY(playlist_id, video_id)
);
CREATE INDEX youtube_playlist_items_position_idx ON youtube_playlist_items(playlist_id, position);

CREATE TABLE youtube_discovery_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('search', 'channel_playlists', 'playlist_items')),
  subject_id TEXT REFERENCES subjects(id),
  lecture_type TEXT,
  query TEXT,
  target_channel_id TEXT,
  target_playlist_id TEXT,
  page_token TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  retry_after TEXT,
  error_summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX youtube_jobs_queue_idx ON youtube_discovery_jobs(status, retry_after, created_at);

CREATE TABLE youtube_quota_usage (
  quota_date TEXT PRIMARY KEY,
  search_calls INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lecture_library (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL UNIQUE REFERENCES resources(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id),
  chapter_id TEXT REFERENCES chapters(id),
  topic_id TEXT REFERENCES topics(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_seconds INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO resource_source_registry (id, name, base_url, robots_status, policy_status, collection_mode, access_notes, last_investigated_at)
VALUES ('source-youtube-api', 'YouTube Data API v3', 'https://www.youtube.com', 'allowed', 'reviewed', 'authorized_api', 'Use only the official Data API. Retain metadata and links; do not download or copy video content. API key is a Worker secret.', '2026-11-23');

INSERT INTO user_faculty_preferences (user_id, subject_id, faculty_name, search_aliases)
SELECT users.id, 'subject-idt', 'Ridhi Baghmar', 'Riddhi Baghmar'
FROM users WHERE NOT EXISTS (SELECT 1 FROM user_faculty_preferences p WHERE p.user_id=users.id AND p.subject_id='subject-idt');
INSERT INTO user_faculty_preferences (user_id, subject_id, faculty_name, search_aliases)
SELECT users.id, 'subject-afm', 'Prateek Jagathi', 'Pratik Jagati'
FROM users WHERE NOT EXISTS (SELECT 1 FROM user_faculty_preferences p WHERE p.user_id=users.id AND p.subject_id='subject-afm');

INSERT OR IGNORE INTO youtube_faculty_channels (channel_id, channel_title, description, identity_status, verification_evidence, source, matched_subject_id, preferred_faculty_name)
VALUES
('UCB2hXHtVFjAGvmd5pixQBaw', 'FAST IDT by Riddhi Baghmar', 'Public channel description identifies it as the official channel of FAST Education for Indirect Taxes by Riddhi Baghmar. Name spelling differs from the saved preference; verify in Settings before prioritizing or importing.', 'pending_review', 'Public YouTube channel description claims official status; preferred name differs by one letter. Subject: IDT. Attempt fit for May 2028 has not been confirmed.', 'manual', 'subject-idt', 'Ridhi Baghmar'),
('UC17QwmgHRFsB9H-2CGAPIAw', 'CA Pratik Jagati', 'Public channel results show CA Final AFM lectures and a link to pratikjagati.com in channel video descriptions. Similar-name channels also exist; confirm identity before prioritizing or importing.', 'pending_review', 'Public video results link CA Pratik Jagati to pratikjagati.com; a second similarly named channel was found. Subject: AFM. Attempt fit for May 2028 has not been confirmed.', 'manual', 'subject-afm', 'Prateek Jagathi');
