import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('migrations create core tables, source registry, and six subject records', async () => {
  const sql = await readFile(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
  const resourceSources = await readFile(new URL('../migrations/0002_resource_sources.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  db.exec(resourceSources);
  const subjects = db.prepare('SELECT code, name FROM subjects ORDER BY position').all();
  assert.deepEqual(subjects.map((subject) => subject.code), ['FR', 'AFM', 'AUDIT', 'DT', 'IDT', 'IBS']);
  assert.equal(db.prepare("SELECT source_status FROM syllabus_versions WHERE applicable_attempt = 'May 2028'").get().source_status, 'pending');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='study_sessions'").get().name, 'study_sessions');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM resource_source_registry").get().count, 4);
  assert.equal(db.prepare("SELECT policy_status FROM resource_source_registry WHERE id='source-castudypartner'").get().policy_status, 'prohibits_automated_extraction');
  assert.equal(db.prepare("SELECT collection_mode FROM resource_source_registry WHERE id='source-icai'").get().collection_mode, 'official_link_metadata_only');
  db.close();
});
