import test from 'node:test';
import assert from 'node:assert/strict';
import { YOUTUBE_LECTURE_CATEGORIES, YOUTUBE_SUBJECTS, classifyYoutubeVideo, makeSubjectSearchTasks, parseIsoDuration } from '../worker/youtube.ts';

test('discovery covers all six subjects and nine lecture categories with query variants', () => {
  assert.equal(YOUTUBE_SUBJECTS.length, 6);
  assert.equal(YOUTUBE_LECTURE_CATEGORIES.length, 9);
  for (const subject of YOUTUBE_SUBJECTS) {
    const tasks = makeSubjectSearchTasks(subject.id, subject.name, []);
    assert.equal(tasks.length, 18);
    assert.ok(tasks.every((task) => task.query.startsWith(`CA Final ${subject.name} `)));
  }
});

test('preferred faculty names are included in independent subject query variants', () => {
  const tasks = makeSubjectSearchTasks('subject-idt', 'Indirect Tax Laws', ['Ridhi Baghmar', 'Riddhi Baghmar']);
  assert.equal(tasks.length, 27);
  assert.ok(tasks.some((task) => task.query.includes('Ridhi Baghmar')));
  assert.ok(tasks.some((task) => task.query.includes('Riddhi Baghmar')));
  assert.ok(tasks.some((task) => task.query === 'CA Final Indirect Tax Laws full syllabus marathon'));
});

test('classification separates marathon, revision and detailed classes and leaves uncertain chapters unmapped', () => {
  const chapterTitles = ['Input Tax Credit', 'Customs Valuation'];
  const marathon = classifyYoutubeVideo({ title: 'CA Final IDT Input Tax Credit Marathon May 2028', description: '', subjectName: 'Indirect Tax Laws', categoryHint: 'detailed', chapterTitles });
  assert.equal(marathon.lectureType, 'marathon');
  assert.equal(marathon.chapterTitle, 'Input Tax Credit');
  assert.equal(marathon.attemptRelevance, 'mentions_may_2028_syllabus_unverified');
  assert.equal(classifyYoutubeVideo({ title: 'Quick Revision: CA Final IDT', description: '', subjectName: 'Indirect Tax Laws', categoryHint: 'detailed', chapterTitles }).lectureType, 'revision');
  assert.equal(classifyYoutubeVideo({ title: 'CA Final IDT', description: '', subjectName: 'Indirect Tax Laws', categoryHint: 'detailed', chapterTitles }).chapterTitle, null);
});

test('ISO 8601 video durations are converted to seconds', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45M'), 2700);
  assert.equal(parseIsoDuration(null), null);
});
