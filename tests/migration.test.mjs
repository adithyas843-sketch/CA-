import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('initial migration creates persistent core tables and six subject records', async () => {
  const sql = await readFile(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const subjects = db.prepare('SELECT code, name FROM subjects ORDER BY position').all();
  assert.deepEqual(subjects.map((subject) => subject.code), ['FR', 'AFM', 'AUDIT', 'DT', 'IDT', 'IBS']);
  assert.equal(db.prepare("SELECT source_status FROM syllabus_versions WHERE applicable_attempt = 'May 2028'").get().source_status, 'pending');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='study_sessions'").get().name, 'study_sessions');
  db.close();
});
