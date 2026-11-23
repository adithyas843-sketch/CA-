import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('migrations create core tables, source registry, and six subject records', async () => {
  const sql = await readFile(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
  const resourceSources = await readFile(new URL('../migrations/0002_resource_sources.sql', import.meta.url), 'utf8');
  const youtubeDiscovery = await readFile(new URL('../migrations/0003_youtube_discovery_and_faculty.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  db.exec(resourceSources);
  db.prepare('INSERT INTO users (id,email,password_hash) VALUES (?,?,?)').run('test-user','study@example.test','hash');
  db.prepare('INSERT INTO resources (id,canonical_url,title,resource_type) VALUES (?,?,?,?)').run('existing-resource','https://example.test/old','Existing resource','article');
  db.exec(youtubeDiscovery);
  const subjects = db.prepare('SELECT code, name FROM subjects ORDER BY position').all();
  assert.deepEqual(subjects.map((subject) => subject.code), ['FR', 'AFM', 'AUDIT', 'DT', 'IDT', 'IBS']);
  assert.equal(db.prepare("SELECT source_status FROM syllabus_versions WHERE applicable_attempt = 'May 2028'").get().source_status, 'pending');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='study_sessions'").get().name, 'study_sessions');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM resource_source_registry").get().count, 5);
  assert.equal(db.prepare("SELECT policy_status FROM resource_source_registry WHERE id='source-castudypartner'").get().policy_status, 'prohibits_automated_extraction');
  assert.equal(db.prepare("SELECT collection_mode FROM resource_source_registry WHERE id='source-icai'").get().collection_mode, 'official_link_metadata_only');
  assert.equal(db.prepare("SELECT title FROM resources WHERE id='existing-resource'").get().title, 'Existing resource');
  assert.equal(db.prepare("SELECT faculty_name FROM user_faculty_preferences WHERE user_id='test-user' AND subject_id='subject-idt'").get().faculty_name, 'Ridhi Baghmar');
  assert.equal(db.prepare("SELECT faculty_name FROM user_faculty_preferences WHERE user_id='test-user' AND subject_id='subject-afm'").get().faculty_name, 'Prateek Jagathi');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM youtube_faculty_channels WHERE identity_status='pending_review'").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM youtube_quota_usage").get().count, 0);
  db.close();
});
