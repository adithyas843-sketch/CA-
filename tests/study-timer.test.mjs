import test from 'node:test';
import assert from 'node:assert/strict';
import { durationFor, elapsedSeconds } from '../src/lib/studyTimer.ts';

test('running timer includes elapsed active seconds', () => {
  const timer = { startedAt: '2026-11-23T10:00:00.000Z', accumulatedSeconds: 25, runningSince: 100_000, activity: 'reading', subjectId: null };
  assert.equal(elapsedSeconds(timer, 160_999), 85);
});

test('paused timer does not count wall-clock time after pausing', () => {
  const timer = { startedAt: '2026-11-23T10:00:00.000Z', accumulatedSeconds: 125, runningSince: null, activity: 'practice', subjectId: null };
  assert.equal(elapsedSeconds(timer, 999_000), 125);
});

test('session duration uses completed time boundaries', () => {
  assert.equal(durationFor('2026-11-23T10:00:00.000Z', '2026-11-23T11:01:00.000Z'), 3_660);
  assert.equal(durationFor('2026-11-23T10:01:00.000Z', '2026-11-23T10:00:00.000Z'), 0);
});
