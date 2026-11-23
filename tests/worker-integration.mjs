import test from 'node:test';
import assert from 'node:assert/strict';

const origin = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787';
const email = 'foundation-test@cafinalos.local';
const password = 'Integration test password 2026!';

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { response, payload };
}

test('local Worker auth, subject, chapter, and session routes persist data', async () => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.database, 'connected');

  const setup = await request('/api/auth/setup-status');
  assert.equal(setup.response.status, 200);
  let cookie;
  if (setup.payload.setupRequired) {
    assert.ok(process.env.TEST_SETUP_TOKEN, 'TEST_SETUP_TOKEN is needed for the first local owner setup');
    const result = await request('/api/auth/register', { method: 'POST', body: { email, password, setupToken: process.env.TEST_SETUP_TOKEN } });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  } else {
    const result = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  }
  assert.ok(cookie);

  const me = await request('/api/auth/me', { cookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.payload.user.email, email);

  const subjects = await request('/api/subjects', { cookie });
  assert.equal(subjects.response.status, 200);
  assert.deepEqual(subjects.payload.subjects.map((subject) => subject.code), ['FR', 'AFM', 'AUDIT', 'DT', 'IDT', 'IBS']);

  const chapter = await request('/api/chapters', { method: 'POST', cookie, body: { subjectId: 'subject-fr', title: 'Integration chapter', code: 'TEST', position: 999, sourceReference: 'Integration test only' } });
  assert.equal(chapter.response.status, 201, JSON.stringify(chapter.payload));
  const chapterId = chapter.payload.chapter.id;
  const update = await request(`/api/chapters/${chapterId}`, { method: 'PATCH', cookie, body: { title: 'Updated integration chapter', status: 'learning' } });
  assert.equal(update.response.status, 200, JSON.stringify(update.payload));
  const chapters = await request('/api/chapters?subjectId=subject-fr', { cookie });
  assert.ok(chapters.payload.chapters.some((item) => item.id === chapterId && item.title === 'Updated integration chapter' && item.status === 'learning'));

  const sourceRegistry = await request('/api/resource-sources', { cookie });
  assert.equal(sourceRegistry.response.status, 200);
  assert.equal(sourceRegistry.payload.sources.length, 4);
  assert.equal(sourceRegistry.payload.sources.find((source) => source.name === 'CA Study Partner').policy_status, 'prohibits_automated_extraction');
  const imported = await request('/api/resources', { method: 'POST', cookie, body: {
    url: 'https://youtu.be/dedup42?t=20', title: 'Integration lecture link', resourceType: 'class',
    sourceName: 'Integration test', sourceUrl: 'https://example.org/lessons', subjectId: 'subject-fr', chapterId,
  } });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.payload));
  assert.equal(imported.payload.duplicate, false);
  const duplicate = await request('/api/resources', { method: 'POST', cookie, body: {
    url: 'https://www.youtube.com/watch?v=dedup42&utm_source=test', title: 'Same lecture', resourceType: 'class',
  } });
  assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.payload));
  assert.equal(duplicate.payload.duplicate, true);
  const resourceList = await request('/api/resources', { cookie });
  const matchingResources = resourceList.payload.resources.filter((item) => item.canonical_url === 'https://www.youtube.com/watch?v=dedup42');
  assert.equal(matchingResources.length, 1);
  assert.equal(matchingResources[0].review_status, 'pending');
  assert.equal(matchingResources[0].chapter_id, chapterId);

  const endedAt = new Date();
  const startedAt = new Date(endedAt.valueOf() - 60_000);
  const sessionBody = { id: crypto.randomUUID(), subjectId: 'subject-fr', activity: 'reading', startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSeconds: 60 };
  const saved = await request('/api/study-sessions', { method: 'POST', cookie, body: sessionBody });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.payload));
  const retry = await request('/api/study-sessions', { method: 'POST', cookie, body: sessionBody });
  assert.equal(retry.response.status, 201, JSON.stringify(retry.payload));
  assert.equal(retry.payload.session.id, saved.payload.session.id);
  const sessions = await request('/api/study-sessions', { cookie });
  assert.equal(sessions.payload.sessions.filter((item) => item.id === saved.payload.session.id).length, 1);
  const dashboard = await request('/api/dashboard', { cookie });
  assert.ok(dashboard.payload.todaySeconds >= 60);
  assert.ok(dashboard.payload.weekSeconds >= 60);

  const secondOwner = await request('/api/auth/register', { method: 'POST', body: { email: 'second@cafinalos.local', password, setupToken: process.env.TEST_SETUP_TOKEN ?? 'unused' } });
  assert.equal(secondOwner.response.status, 409);
  const logout = await request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.response.status, 200);
  const protectedResponse = await request('/api/subjects');
  assert.equal(protectedResponse.response.status, 401);
});
