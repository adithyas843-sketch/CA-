CREATE TABLE resource_source_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL UNIQUE,
  terms_url TEXT,
  robots_status TEXT NOT NULL DEFAULT 'unverified' CHECK (robots_status IN ('unverified', 'allowed', 'restricted', 'unavailable')),
  policy_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (policy_status IN ('unreviewed', 'reviewed', 'prohibits_automated_extraction', 'permission_required')),
  collection_mode TEXT NOT NULL DEFAULT 'manual_link_import' CHECK (collection_mode IN ('manual_link_import', 'public_link_metadata', 'official_link_metadata_only', 'authorized_api')),
  access_notes TEXT NOT NULL DEFAULT '',
  last_investigated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO resource_source_registry (id, name, base_url, terms_url, robots_status, policy_status, collection_mode, access_notes, last_investigated_at) VALUES
('source-shricasa', 'ShriCasa', 'https://shricasa.com', NULL, 'unavailable', 'unreviewed', 'manual_link_import', 'Public dashboard and past-papers index observed. robots.txt could not be retrieved by the research browser and terms were not located; automated collection remains disabled.', '2026-11-23'),
('source-nextgen', 'NextGen Career Circle', 'https://nextgencareercircle.co', 'https://nextgencareercircle.co/terms', 'unavailable', 'reviewed', 'manual_link_import', 'Terms permit personal study use and prohibit copying, reselling, or republishing material without permission. robots.txt could not be retrieved. No automated collection until robots/access rules are confirmed.', '2026-11-23'),
('source-castudypartner', 'CA Study Partner', 'https://www.castudypartner.com', 'https://www.castudypartner.com/Castudypartner_TermandConditon', 'unavailable', 'prohibits_automated_extraction', 'manual_link_import', 'Terms prohibit unauthorized automated/systematic extraction, scraping, downloading, and copying. Use only user-supplied links or authorized export/API.', '2026-11-23'),
('source-icai', 'ICAI', 'https://www.icai.org', 'https://www.icai.org/students.shtml?mod=1', 'unavailable', 'permission_required', 'official_link_metadata_only', 'Official student resources are publicly linked. ICAI reserves copyright and prohibits reproducing/transmitting/storing materials without written permission; retain links and minimal metadata only. robots.txt could not be retrieved.', '2026-11-23');
