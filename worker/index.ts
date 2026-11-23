interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  OWNER_SETUP_TOKEN: string;
  APP_ENV?: string;
  SESSION_SECURE?: string;
}

interface UserRow { id: string; email: string; }

const SESSION_COOKIE = 'cafos_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 210_000;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const fail = (message: string, status: number) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const asBase64Url = (bytes: Uint8Array) => bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return asBase64Url(new Uint8Array(hash));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, expectedText] = stored.split('$');
  const iterations = Number(iterationText);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !expectedText) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltText), iterations }, key, 256));
  const expected = base64ToBytes(expectedText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

function cookie(value: string, env: Env, maxAge = SESSION_SECONDS): string {
  const secure = env.SESSION_SECURE === 'true' || env.APP_ENV === 'production';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function requestCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

async function currentUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = requestCookie(request);
  if (!token) return null;
  const tokenHash = await digest(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1`,
  ).bind(tokenHash, now).first<UserRow>();
  return row ?? null;
}

async function createSession(user: UserRow, env: Env): Promise<Response> {
  const rawToken = asBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id(), user.id, await digest(rawToken), expiresAt).run();
  return json({ user }, 200, { 'set-cookie': cookie(rawToken, env) });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

async function requireUser(request: Request, env: Env): Promise<UserRow | Response> {
  return (await currentUser(request, env)) ?? fail('Please sign in to continue.', 401);
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/health') {
    try {
      await env.DB.prepare('SELECT 1').first();
      return json({ status: 'ok', database: 'connected', environment: env.APP_ENV ?? 'development' });
    } catch { return json({ status: 'degraded', database: 'unavailable' }, 503); }
  }

  if (request.method === 'GET' && path === '/api/auth/setup-status') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
    return json({ setupRequired: Number(row?.count ?? 0) === 0 });
  }

  if (request.method === 'POST' && path === '/api/auth/register') {
    const body = await readJson(request);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || typeof body.setupToken !== 'string') return fail('Enter an email, password, and setup token.', 400);
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail('Enter a valid email address.', 400);
    if (body.password.length < 12 || body.password.length > 200) return fail('Use a password between 12 and 200 characters.', 400);
    if (!env.OWNER_SETUP_TOKEN || body.setupToken.length !== env.OWNER_SETUP_TOKEN.length || !constantTimeEqual(body.setupToken, env.OWNER_SETUP_TOKEN)) return fail('The setup token is invalid.', 403);
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
    if (Number(count?.count ?? 0) !== 0) return fail('Owner setup is already complete.', 409);
    const user = { id: id(), email };
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, email, password_hash) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)').bind(user.id, email, await hashPassword(body.password)),
        env.DB.prepare('INSERT INTO user_settings (user_id) VALUES (?)').bind(user.id),
      ]);
    } catch { return fail('Owner setup could not be completed. Check that the email is unused and the database migration has run.', 409); }
    return createSession(user, env);
  }

  if (request.method === 'POST' && path === '/api/auth/login') {
    const body = await readJson(request);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return fail('Enter your email and password.', 400);
    const row = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1')
      .bind(body.email.trim().toLowerCase()).first<UserRow & { password_hash: string }>();
    if (!row || !(await verifyPassword(body.password, row.password_hash))) return fail('Email or password is incorrect.', 401);
    return createSession({ id: row.id, email: row.email }, env);
  }

  if (request.method === 'POST' && path === '/api/auth/logout') {
    const token = requestCookie(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('', env, 0) });
  }

  if (request.method === 'GET' && path === '/api/auth/me') {
    const user = await currentUser(request, env);
    return user ? json({ user }) : fail('Please sign in to continue.', 401);
  }

  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  if (request.method === 'GET' && path === '/api/subjects') {
    const result = await env.DB.prepare(
      `SELECT subjects.id, subjects.code, subjects.name, subjects.position,
        (SELECT COUNT(*) FROM chapters WHERE chapters.subject_id = subjects.id AND chapters.is_archived = 0) AS chapter_count
       FROM subjects WHERE is_active = 1 ORDER BY position`,
    ).all();
    return json({ subjects: result.results });
  }

  if (request.method === 'GET' && path === '/api/chapters') {
    const subjectId = url.searchParams.get('subjectId');
    const query = `SELECT chapters.id, chapters.subject_id, chapters.parent_chapter_id, chapters.code, chapters.title,
      chapters.position, chapters.status, chapters.source_reference, subjects.code AS subject_code
      FROM chapters JOIN subjects ON subjects.id = chapters.subject_id WHERE chapters.is_archived = 0${subjectId ? ' AND chapters.subject_id = ?' : ''}
      ORDER BY subjects.position, chapters.position`;
    const result = subjectId ? await env.DB.prepare(query).bind(subjectId).all() : await env.DB.prepare(query).all();
    return json({ chapters: result.results });
  }

  if (request.method === 'POST' && path === '/api/chapters') {
    const body = await readJson(request);
    if (!body || typeof body.subjectId !== 'string' || typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.length > 200) return fail('Choose a subject and enter a chapter title (up to 200 characters).', 400);
    const syllabus = await env.DB.prepare('SELECT id FROM syllabus_versions WHERE id = ?').bind('syllabus-may-2028-draft').first<{ id: string }>();
    if (!syllabus) return fail('The syllabus version is not configured.', 409);
    const chapterId = id();
    try {
      await env.DB.prepare('INSERT INTO chapters (id, syllabus_version_id, subject_id, title, code, position, source_reference) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(chapterId, syllabus.id, body.subjectId, body.title.trim(), typeof body.code === 'string' ? body.code.trim().slice(0, 40) || null : null, Number.isInteger(body.position) ? body.position : 0, typeof body.sourceReference === 'string' ? body.sourceReference.trim().slice(0, 500) || null : null).run();
    } catch { return fail('The chapter could not be saved. Check that the subject exists.', 400); }
    return json({ chapter: { id: chapterId, subject_id: body.subjectId, title: body.title.trim(), status: 'not_started' } }, 201);
  }

  const chapterMatch = path.match(/^\/api\/chapters\/([a-f0-9-]{36})$/i);
  if (chapterMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body) return fail('Enter the chapter changes as JSON.', 400);
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return fail('Chapter title must be 1 to 200 characters.', 400);
      updates.push('title = ?'); values.push(body.title.trim());
    }
    if (body.code !== undefined) {
      if (typeof body.code !== 'string' && body.code !== null) return fail('Chapter code is invalid.', 400);
      updates.push('code = ?'); values.push(typeof body.code === 'string' ? body.code.trim().slice(0, 40) || null : null);
    }
    if (body.sourceReference !== undefined) {
      if (typeof body.sourceReference !== 'string' && body.sourceReference !== null) return fail('Source reference is invalid.', 400);
      updates.push('source_reference = ?'); values.push(typeof body.sourceReference === 'string' ? body.sourceReference.trim().slice(0, 500) || null : null);
    }
    if (body.position !== undefined) {
      if (!Number.isInteger(body.position) || Number(body.position) < 0 || Number(body.position) > 10_000) return fail('Chapter position is invalid.', 400);
      updates.push('position = ?'); values.push(Number(body.position));
    }
    if (body.status !== undefined) {
      const statuses = ['not_started', 'learning', 'notes_in_progress', 'first_revision', 'practised', 'exam_ready', 'needs_improvement'];
      if (typeof body.status !== 'string' || !statuses.includes(body.status)) return fail('Chapter status is invalid.', 400);
      updates.push('status = ?'); values.push(body.status);
    }
    if (!updates.length) return fail('No supported chapter changes were provided.', 400);
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(chapterMatch[1]);
    const result = await env.DB.prepare(`UPDATE chapters SET ${updates.join(', ')} WHERE id = ? AND is_archived = 0`).bind(...values).run();
    if (!result.meta.changes) return fail('Chapter not found.', 404);
    return json({ ok: true });
  }

  if (request.method === 'GET' && path === '/api/study-sessions') {
    const result = await env.DB.prepare(
      `SELECT study_sessions.id, study_sessions.subject_id, subjects.code AS subject_code,
        study_sessions.activity, study_sessions.started_at, study_sessions.ended_at,
        study_sessions.duration_seconds, study_sessions.notes
       FROM study_sessions LEFT JOIN subjects ON subjects.id = study_sessions.subject_id
       WHERE study_sessions.user_id = ? ORDER BY study_sessions.started_at DESC LIMIT 50`,
    ).bind(user.id).all();
    return json({ sessions: result.results });
  }

  if (request.method === 'POST' && path === '/api/study-sessions') {
    const body = await readJson(request);
    const activities = ['reading', 'note_making', 'practice', 'revision', 'mock_test', 'lecture', 'other'];
    const duration = body?.durationSeconds;
    const started = typeof body?.startedAt === 'string' ? new Date(body.startedAt) : null;
    const ended = typeof body?.endedAt === 'string' ? new Date(body.endedAt) : null;
    if (!body || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 24 * 60 * 60 || !started || !ended || Number.isNaN(started.valueOf()) || Number.isNaN(ended.valueOf()) || !activities.includes(String(body.activity))) return fail('Study session details are invalid.', 400);
    if (ended.valueOf() < started.valueOf() || started.valueOf() > Date.now() + 5 * 60 * 1000) return fail('Study session time range is invalid.', 400);
    const subjectId = typeof body.subjectId === 'string' && body.subjectId ? body.subjectId : null;
    const chapterId = typeof body.chapterId === 'string' && body.chapterId ? body.chapterId : null;
    if (chapterId) {
      const chapter = await env.DB.prepare('SELECT subject_id FROM chapters WHERE id = ? AND is_archived = 0').bind(chapterId).first<{ subject_id: string }>();
      if (!chapter || (subjectId && chapter.subject_id !== subjectId)) return fail('The selected chapter does not belong to that subject.', 400);
    }
    const sessionId = typeof body.id === 'string' && /^[a-f0-9-]{36}$/i.test(body.id) ? body.id : id();
    try {
      const inserted = await env.DB.prepare('INSERT OR IGNORE INTO study_sessions (id, user_id, subject_id, chapter_id, activity, started_at, ended_at, duration_seconds, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(sessionId, user.id, subjectId, chapterId, body.activity, started.toISOString(), ended.toISOString(), duration, typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null).run();
      if (!inserted.meta.changes) {
        const existing = await env.DB.prepare('SELECT user_id FROM study_sessions WHERE id = ?').bind(sessionId).first<{ user_id: string }>();
        if (!existing || existing.user_id !== user.id) return fail('Study session could not be saved.', 409);
      }
    } catch { return fail('The study session could not be saved. Check the selected subject and chapter.', 400); }
    return json({ session: { id: sessionId, duration_seconds: duration, activity: body.activity } }, 201);
  }

  if (request.method === 'GET' && path === '/api/dashboard') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    week.setDate(week.getDate() - 6);
    const [todayTotal, weekTotal, recent] = await Promise.all([
      env.DB.prepare('SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM study_sessions WHERE user_id = ? AND started_at >= ?').bind(user.id, today.toISOString()).first<{ total: number }>(),
      env.DB.prepare('SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM study_sessions WHERE user_id = ? AND started_at >= ?').bind(user.id, week.toISOString()).first<{ total: number }>(),
      env.DB.prepare('SELECT id, activity, started_at, duration_seconds FROM study_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 5').bind(user.id).all(),
    ]);
    return json({ todaySeconds: todayTotal?.total ?? 0, weekSeconds: weekTotal?.total ?? 0, recent: recent.results });
  }

  return fail('Not found.', 404);
}

export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    catch (error) {
      console.error('Request failed', error);
      return fail('The request could not be completed.', 500);
    }
  },
};
