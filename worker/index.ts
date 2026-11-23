interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  OWNER_SETUP_TOKEN: string;
  YOUTUBE_API_KEY?: string;
  APP_ENV?: string;
  SESSION_SECURE?: string;
}

import { YOUTUBE_SUBJECTS, YouTubeApiError, classifyYoutubeVideo, makeSubjectSearchTasks, parseIsoDuration, youtubeGet } from './youtube.ts';

interface UserRow { id: string; email: string; }

const SESSION_COOKIE = 'cafos_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 210_000;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const fail = (message: string, status: number) => json({ error: message }, status);
const id = () => crypto.randomUUID();
export const canonicalResourceUrl = (raw: string): string | null => {
  try {
    const value = new URL(raw.trim());
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) return null;
    value.hash = '';
    for (const key of [...value.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) value.searchParams.delete(key);
    const video = value.hostname.toLowerCase().replace(/^www\./, '') === 'youtube.com' ? value.searchParams.get('v') : null;
    const shortVideo = value.hostname.toLowerCase() === 'youtu.be' ? value.pathname.split('/').filter(Boolean)[0] : null;
    const playlist = value.searchParams.get('list');
    if (video) return `https://www.youtube.com/watch?v=${encodeURIComponent(video)}${playlist ? `&list=${encodeURIComponent(playlist)}` : ''}`;
    if (shortVideo) return `https://www.youtube.com/watch?v=${encodeURIComponent(shortVideo)}`;
    value.hostname = value.hostname.toLowerCase();
    if ((value.protocol === 'https:' && value.port === '443') || (value.protocol === 'http:' && value.port === '80')) value.port = '';
    return value.toString().replace(/\/$/, '');
  } catch { return null; }
};

type QuotaMethod = 'search' | 'standard';
const PT_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
function youtubeQuotaDate(): string { return PT_DATE.format(new Date()); }

async function reserveYouTubeQuota(env: Env, method: QuotaMethod): Promise<void> {
  const date = youtubeQuotaDate();
  await env.DB.prepare('INSERT OR IGNORE INTO youtube_quota_usage (quota_date) VALUES (?)').bind(date).run();
  const sql = method === 'search'
    ? 'UPDATE youtube_quota_usage SET search_calls=search_calls+1,total_units=total_units+100,updated_at=CURRENT_TIMESTAMP WHERE quota_date=? AND search_calls<70 AND total_units<=7000'
    : 'UPDATE youtube_quota_usage SET total_units=total_units+1,updated_at=CURRENT_TIMESTAMP WHERE quota_date=? AND total_units<9800';
  const result = await env.DB.prepare(sql).bind(date).run();
  if (!result.meta.changes) throw new YouTubeApiError('The local YouTube daily safety quota is reached. Discovery can resume after the Pacific Time quota reset.', 429, 'localQuotaExceeded');
}

function thumbnailOf(snippet: Record<string, unknown> | undefined): string | null {
  const thumbnails = snippet?.thumbnails as Record<string, { url?: string }> | undefined;
  return thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null;
}

function attemptStatus(text: string): string {
  const match = text.match(/\b(may|september|sept|november|nov|january|jan)\s*['’]?(20\d{2})\b/i);
  if (!match) return 'unverified';
  const attempt = `${match[1]}_${match[2]}`.toLowerCase();
  return attempt === 'may_2028' ? 'mentions_may_2028_syllabus_unverified' : `mentions_${attempt}`;
}

async function saveYoutubeVideo(
  env: Env, userId: string, video: Record<string, unknown>, subjectId: string | null,
  lectureTypeHint: string | null, playlistId: string | null = null, position: number | null = null, addedAt: string | null = null,
): Promise<string | null> {
  const videoId = typeof video.id === 'string' ? video.id : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const snippet = video.snippet as Record<string, unknown> | undefined;
  if (!snippet || typeof snippet.title !== 'string') return null;
  const title = snippet.title;
  const description = typeof snippet.description === 'string' ? snippet.description : '';
  const channelId = typeof snippet.channelId === 'string' ? snippet.channelId : '';
  const channelTitle = typeof snippet.channelTitle === 'string' ? snippet.channelTitle : 'YouTube channel';
  const details = video.contentDetails as Record<string, unknown> | undefined;
  const durationIso = typeof details?.duration === 'string' ? details.duration : null;
  const duration = parseIsoDuration(durationIso);
  const captions = typeof details?.caption === 'string' ? (details.caption === 'true' ? 1 : 0) : null;
  const publishedAt = typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null;
  const thumb = thumbnailOf(snippet);
  const subject = YOUTUBE_SUBJECTS.find((item) => item.id === subjectId);
  const chapterResult = subjectId ? await env.DB.prepare('SELECT id,title FROM chapters WHERE subject_id=? AND is_archived=0').bind(subjectId).all<{ id: string; title: string }>() : { results: [] as { id: string; title: string }[] };
  const topicResult = subjectId ? await env.DB.prepare('SELECT topics.id,topics.title,topics.chapter_id FROM topics JOIN chapters ON chapters.id=topics.chapter_id WHERE chapters.subject_id=?').bind(subjectId).all<{ id: string; title: string; chapter_id: string }>() : { results: [] as { id: string; title: string; chapter_id: string }[] };
  const classified = classifyYoutubeVideo({ title, description, subjectName: subject?.name ?? '', categoryHint: lectureTypeHint ?? 'other', chapterTitles: chapterResult.results.map((row) => row.title), topicTitles: topicResult.results.map((row) => row.title) });
  const privacyStatus = typeof (video.status as Record<string, unknown> | undefined)?.privacyStatus === 'string' ? String((video.status as Record<string, unknown>).privacyStatus) : 'public';
  const resourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const newId = crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO resources
    (id,canonical_url,title,resource_type,access_type,verification_status,provider,published_at,last_verified_at,
     youtube_video_id,youtube_channel_id,youtube_channel_title,youtube_playlist_id,description,thumbnail_url,
     youtube_duration_iso,duration_seconds,captions_available,lecture_type,attempt_relevance)
    VALUES (?,?,?,'class',?,'working',?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(newId, resourceUrl, title, privacyStatus === 'public' ? 'public' : 'unknown', channelTitle, publishedAt,
      videoId, channelId || null, channelTitle, playlistId, description, thumb, durationIso, duration, captions,
      classified.lectureType, attemptStatus(`${title} ${description}`)).run();
  const resource = await env.DB.prepare('SELECT id FROM resources WHERE youtube_video_id=? OR canonical_url=? LIMIT 1').bind(videoId, resourceUrl).first<{ id: string }>();
  if (!resource) return null;
  await env.DB.prepare(`UPDATE resources SET title=?,resource_type='class',access_type=?,verification_status='working',provider=?,published_at=?,
    last_verified_at=CURRENT_TIMESTAMP,youtube_video_id=?,youtube_channel_id=?,youtube_channel_title=?,youtube_playlist_id=COALESCE(?,youtube_playlist_id),
    description=?,thumbnail_url=?,youtube_duration_iso=?,duration_seconds=?,captions_available=?,lecture_type=?,attempt_relevance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(title, privacyStatus === 'public' ? 'public' : 'unknown', channelTitle, publishedAt, videoId, channelId || null, channelTitle,
      playlistId, description, thumb, durationIso, duration, captions, classified.lectureType, attemptStatus(`${title} ${description}`), resource.id).run();
  const provenance = channelId ? `https://www.youtube.com/channel/${channelId}` : resourceUrl;
  await env.DB.prepare('INSERT OR IGNORE INTO resource_sources (id,resource_id,source_url,source_name,collection_method) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), resource.id, provenance, 'YouTube Data API v3', 'youtube_data_api').run();
  if (subjectId) {
    const matchedChapter = classified.chapterTitle ? chapterResult.results.find((row) => row.title === classified.chapterTitle) : null;
    const matchedTopic = classified.topicTitle && matchedChapter ? topicResult.results.find((row) => row.title === classified.topicTitle && row.chapter_id === matchedChapter.id) : null;
    await env.DB.prepare(`INSERT INTO resource_mappings (id,resource_id,subject_id,chapter_id,confidence,review_status,topic_id)
      SELECT ?,?,?,?,?, 'pending',? WHERE NOT EXISTS (SELECT 1 FROM resource_mappings WHERE resource_id=? AND subject_id=?)`)
      .bind(crypto.randomUUID(), resource.id, subjectId, matchedChapter?.id ?? null,
        Math.min(classified.subjectConfidence, classified.chapterConfidence || classified.subjectConfidence), matchedTopic?.id ?? null, resource.id, subjectId).run();
  }
  if (playlistId && position !== null) {
    await env.DB.prepare('INSERT OR REPLACE INTO youtube_playlist_items (playlist_id,video_id,resource_id,position,added_at) VALUES (?,?,?,?,?)')
      .bind(playlistId, videoId, resource.id, position, addedAt).run();
  }
  if (channelId) {
    const pref = subjectId ? await env.DB.prepare('SELECT faculty_name FROM user_faculty_preferences WHERE user_id=? AND subject_id=?').bind(userId, subjectId).first<{ faculty_name: string }>() : null;
    await env.DB.prepare(`INSERT INTO youtube_faculty_channels (channel_id,channel_title,description,identity_status,source,matched_subject_id,preferred_faculty_name)
      VALUES (?,?,?,'pending_review','youtube_search',?,?)
      ON CONFLICT(channel_id) DO UPDATE SET channel_title=excluded.channel_title,updated_at=CURRENT_TIMESTAMP`)
      .bind(channelId, channelTitle, '', subjectId, pref?.faculty_name ?? null).run();
  }
  return resource.id;
}

interface YouTubeJobRow {
  id: string; job_type: string; subject_id: string | null; lecture_type: string | null; query: string | null;
  target_channel_id: string | null; target_playlist_id: string | null; page_token: string | null;
}

async function saveYoutubePlaylist(env: Env, item: Record<string, unknown>, subjectId: string | null): Promise<string | null> {
  const playlistId = typeof (item.id as Record<string, unknown> | undefined)?.playlistId === 'string' ? String((item.id as Record<string, unknown>).playlistId) : (typeof item.id === 'string' ? item.id : '');
  const snippet = item.snippet as Record<string, unknown> | undefined;
  if (!playlistId || !snippet || typeof snippet.title !== 'string') return null;
  const details = item.contentDetails as Record<string, unknown> | undefined;
  await env.DB.prepare(`INSERT INTO youtube_playlists (playlist_id,title,description,channel_id,channel_title,thumbnail_url,published_at,item_count,subject_id)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET title=excluded.title,description=excluded.description,
    channel_id=excluded.channel_id,channel_title=excluded.channel_title,thumbnail_url=excluded.thumbnail_url,published_at=excluded.published_at,
    item_count=excluded.item_count,subject_id=COALESCE(excluded.subject_id,youtube_playlists.subject_id),updated_at=CURRENT_TIMESTAMP`)
    .bind(playlistId, snippet.title, typeof snippet.description === 'string' ? snippet.description : '',
      typeof snippet.channelId === 'string' ? snippet.channelId : null, typeof snippet.channelTitle === 'string' ? snippet.channelTitle : null,
      thumbnailOf(snippet), typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null,
      Number.isInteger(details?.itemCount) ? details?.itemCount : null, subjectId).run();
  const channelId = typeof snippet.channelId === 'string' ? snippet.channelId : '';
  if (channelId) {
    await env.DB.prepare(`INSERT OR IGNORE INTO youtube_faculty_channels (channel_id,channel_title,description,identity_status,source,matched_subject_id)
      VALUES (?,?,?,'pending_review','youtube_search',?)`).bind(channelId,
        typeof snippet.channelTitle === 'string' ? snippet.channelTitle : 'YouTube channel',
        typeof snippet.description === 'string' ? snippet.description : '', subjectId).run();
  }
  await env.DB.prepare(`INSERT INTO youtube_discovery_jobs (id,job_type,subject_id,target_playlist_id,status)
    SELECT ?, 'playlist_items', ?, ?, 'queued' WHERE NOT EXISTS
      (SELECT 1 FROM youtube_discovery_jobs WHERE job_type='playlist_items' AND target_playlist_id=? AND status IN ('queued','running'))`)
    .bind(crypto.randomUUID(), subjectId, playlistId, playlistId).run();
  return playlistId;
}

async function runYouTubeJob(env: Env, userId: string, job: YouTubeJobRow): Promise<{ discovered: number; nextPageToken: string | null }> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeApiError('YOUTUBE_API_KEY is not configured as a Worker secret.', 503, 'missingApiKey');
  const reserve = (method: QuotaMethod) => reserveYouTubeQuota(env, method);
  let discovered = 0;
  let nextPageToken: string | null = null;
  if (job.job_type === 'search') {
    const result = await youtubeGet<{ items?: Record<string, unknown>[]; nextPageToken?: string }>(key, 'search', {
      part: 'snippet', q: job.query ?? '', type: 'video,playlist,channel', maxResults: '25', order: 'relevance',
      ...(job.page_token ? { pageToken: job.page_token } : {}),
    }, reserve);
    const videoIds: string[] = [];
    for (const item of result.items ?? []) {
      const resourceId = item.id as Record<string, unknown> | undefined;
      const snippet = item.snippet as Record<string, unknown> | undefined;
      if (typeof resourceId?.videoId === 'string') videoIds.push(resourceId.videoId);
      else if (typeof resourceId?.playlistId === 'string') {
        await saveYoutubePlaylist(env, item, job.subject_id);
        discovered += 1;
      } else if (typeof resourceId?.channelId === 'string' && snippet) {
        const channelId = String(resourceId.channelId);
        const title = typeof snippet.title === 'string' ? snippet.title : 'YouTube channel';
        const description = typeof snippet.description === 'string' ? snippet.description : '';
        const pref = job.subject_id ? await env.DB.prepare('SELECT faculty_name,search_aliases FROM user_faculty_preferences WHERE user_id=? AND subject_id=?').bind(userId, job.subject_id).first<{ faculty_name: string; search_aliases: string }>() : null;
        const candidateText = `${title} ${description}`.toLowerCase();
        const preferredName = pref && [pref.faculty_name, ...pref.search_aliases.split(',')].find((name) => name.trim() && candidateText.includes(name.trim().toLowerCase())) || null;
        await env.DB.prepare(`INSERT INTO youtube_faculty_channels (channel_id,channel_title,description,identity_status,source,matched_subject_id,preferred_faculty_name)
          VALUES (?,?,?,'pending_review','youtube_search',?,?)
          ON CONFLICT(channel_id) DO UPDATE SET channel_title=excluded.channel_title,description=excluded.description,updated_at=CURRENT_TIMESTAMP`)
          .bind(channelId, title, description, job.subject_id, preferredName).run();
        discovered += 1;
      }
    }
    if (videoIds.length) {
      const videos = await youtubeGet<{ items?: Record<string, unknown>[] }>(key, 'videos', { part: 'snippet,contentDetails,status', id: videoIds.join(',') }, reserve);
      for (const video of videos.items ?? []) if (await saveYoutubeVideo(env, userId, video, job.subject_id, job.lecture_type)) discovered += 1;
    }
    nextPageToken = result.nextPageToken ?? null;
  } else if (job.job_type === 'playlist_items' && job.target_playlist_id) {
    const page = await youtubeGet<{ items?: Record<string, unknown>[]; nextPageToken?: string }>(key, 'playlistItems', {
      part: 'snippet,contentDetails,status', playlistId: job.target_playlist_id, maxResults: '50',
      ...(job.page_token ? { pageToken: job.page_token } : {}),
    }, reserve);
    const videoIds: string[] = [];
    for (const item of page.items ?? []) {
      const snippet = item.snippet as Record<string, unknown> | undefined;
      const id = (snippet?.resourceId as Record<string, unknown> | undefined)?.videoId;
      if (typeof id === 'string') videoIds.push(id);
    }
    if (videoIds.length) {
      const videos = await youtubeGet<{ items?: Record<string, unknown>[] }>(key, 'videos', { part: 'snippet,contentDetails,status', id: videoIds.join(',') }, reserve);
      const byId = new Map((videos.items ?? []).map((video) => [String(video.id), video]));
      for (const item of page.items ?? []) {
        const snippet = item.snippet as Record<string, unknown> | undefined;
        const videoId = (snippet?.resourceId as Record<string, unknown> | undefined)?.videoId;
        if (typeof videoId !== 'string') continue;
        const video = byId.get(videoId);
        const position = Number.isInteger(snippet?.position) ? Number(snippet?.position) : 0;
        const resource = video ? await saveYoutubeVideo(env, userId, video, job.subject_id, null, job.target_playlist_id, position, typeof snippet?.publishedAt === 'string' ? snippet.publishedAt : null) : null;
        if (resource) discovered += 1;
      }
    }
    nextPageToken = page.nextPageToken ?? null;
    if (!nextPageToken) await env.DB.prepare('UPDATE youtube_playlists SET last_scanned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE playlist_id=?').bind(job.target_playlist_id).run();
  } else if (job.job_type === 'channel_playlists' && job.target_channel_id) {
    const page = await youtubeGet<{ items?: Record<string, unknown>[]; nextPageToken?: string }>(key, 'playlists', {
      part: 'snippet,contentDetails,status', channelId: job.target_channel_id, maxResults: '50',
      ...(job.page_token ? { pageToken: job.page_token } : {}),
    }, reserve);
    for (const item of page.items ?? []) { await saveYoutubePlaylist(env, item, job.subject_id); discovered += 1; }
    nextPageToken = page.nextPageToken ?? null;
    if (!nextPageToken) await env.DB.prepare('UPDATE youtube_faculty_channels SET last_scanned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?').bind(job.target_channel_id).run();
  }
  return { discovered, nextPageToken };
}

async function refreshYoutubeMetadata(env: Env): Promise<void> {
  if (!env.YOUTUBE_API_KEY) return;
  const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const reserve = (method: QuotaMethod) => reserveYouTubeQuota(env, method);
  try {
    const videos = await env.DB.prepare('SELECT id,youtube_video_id FROM resources WHERE youtube_video_id IS NOT NULL AND last_verified_at<? ORDER BY last_verified_at LIMIT 2500').bind(cutoff).all<{ id: string; youtube_video_id: string }>();
    for (let offset = 0; offset < videos.results.length; offset += 50) {
      const batch = videos.results.slice(offset, offset + 50);
      const found = await youtubeGet<{ items?: Record<string, unknown>[] }>(env.YOUTUBE_API_KEY, 'videos', { part: 'snippet,contentDetails,status', id: batch.map((item) => item.youtube_video_id).join(',') }, reserve);
      const byId = new Map((found.items ?? []).map((item) => [String(item.id), item]));
      for (const row of batch) {
        const current = byId.get(row.youtube_video_id);
        if (current) await saveYoutubeVideo(env, 'system-refresh', current, null, null);
        else await env.DB.batch([
          env.DB.prepare(`UPDATE resources SET title='Unavailable YouTube video',youtube_video_id=NULL,youtube_channel_id=NULL,
            youtube_channel_title=NULL,youtube_playlist_id=NULL,description='',thumbnail_url=NULL,youtube_duration_iso=NULL,
            duration_seconds=NULL,captions_available=NULL,lecture_type=NULL,attempt_relevance='unverified',provider=NULL,
            verification_status='broken',last_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id),
          env.DB.prepare("DELETE FROM resource_sources WHERE resource_id=? AND collection_method='youtube_data_api'").bind(row.id),
        ]);
      }
    }

    const playlists = await env.DB.prepare('SELECT playlist_id FROM youtube_playlists WHERE updated_at<? ORDER BY updated_at LIMIT 2500').bind(cutoff).all<{ playlist_id: string }>();
    for (let offset = 0; offset < playlists.results.length; offset += 50) {
      const batch = playlists.results.slice(offset, offset + 50);
      const found = await youtubeGet<{ items?: Record<string, unknown>[] }>(env.YOUTUBE_API_KEY, 'playlists', { part: 'snippet,contentDetails,status', id: batch.map((item) => item.playlist_id).join(',') }, reserve);
      const byId = new Map((found.items ?? []).map((item) => [String(item.id), item]));
      for (const row of batch) {
        const item = byId.get(row.playlist_id);
        if (item) await saveYoutubePlaylist(env, item, null);
        else await env.DB.batch([
          env.DB.prepare('UPDATE resources SET youtube_playlist_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE youtube_playlist_id=?').bind(row.playlist_id),
          env.DB.prepare('DELETE FROM youtube_playlists WHERE playlist_id=?').bind(row.playlist_id),
        ]);
      }
    }

    const channels = await env.DB.prepare('SELECT channel_id,channel_title FROM youtube_faculty_channels WHERE updated_at<? ORDER BY updated_at LIMIT 2500').bind(cutoff).all<{ channel_id: string; channel_title: string }>();
    for (let offset = 0; offset < channels.results.length; offset += 50) {
      const batch = channels.results.slice(offset, offset + 50);
      const found = await youtubeGet<{ items?: Record<string, unknown>[] }>(env.YOUTUBE_API_KEY, 'channels', { part: 'snippet,contentDetails', id: batch.map((item) => item.channel_id).join(',') }, reserve);
      const byId = new Map((found.items ?? []).map((item) => [String(item.id), item]));
      for (const row of batch) {
        const item = byId.get(row.channel_id);
        const snippet = item?.snippet as Record<string, unknown> | undefined;
        if (snippet) {
          const title = String(snippet.title ?? row.channel_title);
          const changed = title !== row.channel_title;
          await env.DB.prepare(`UPDATE youtube_faculty_channels SET channel_title=?,description=?,custom_url=?,identity_status=CASE WHEN ?=1 THEN 'pending_review' ELSE identity_status END,
            identity_checked_at=CASE WHEN ?=1 THEN NULL ELSE identity_checked_at END,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?`)
            .bind(title, String(snippet.description ?? ''), typeof snippet.customUrl === 'string' ? snippet.customUrl : null, changed ? 1 : 0, changed ? 1 : 0, row.channel_id).run();
        } else {
          await env.DB.prepare("UPDATE youtube_faculty_channels SET channel_title='Unavailable YouTube channel',description='',custom_url=NULL,identity_status='rejected',identity_checked_at=CURRENT_TIMESTAMP,verification_evidence='YouTube no longer returns this public channel.',updated_at=CURRENT_TIMESTAMP WHERE channel_id=?").bind(row.channel_id).run();
        }
      }
    }

    await env.DB.prepare(`INSERT INTO youtube_discovery_jobs (id,job_type,target_playlist_id,status)
      SELECT lower(hex(randomblob(16))),'playlist_items',p.playlist_id,'queued' FROM youtube_playlists p
      WHERE (p.last_scanned_at IS NULL OR p.last_scanned_at<?) AND NOT EXISTS
      (SELECT 1 FROM youtube_discovery_jobs j WHERE j.job_type='playlist_items' AND j.target_playlist_id=p.playlist_id AND j.status IN ('queued','running'))`).bind(cutoff).run();
    for (let count = 0; count < 100; count += 1) {
      const job = await env.DB.prepare(`SELECT id,job_type,subject_id,lecture_type,query,target_channel_id,target_playlist_id,page_token FROM youtube_discovery_jobs
        WHERE job_type='playlist_items' AND status='queued' AND (retry_after IS NULL OR retry_after<=?) ORDER BY created_at LIMIT 1`).bind(new Date().toISOString()).first<YouTubeJobRow>();
      if (!job) break;
      const lock = await env.DB.prepare("UPDATE youtube_discovery_jobs SET status='running',attempt_count=attempt_count+1 WHERE id=? AND status='queued'").bind(job.id).run();
      if (!lock.meta.changes) continue;
      try {
        const result = await runYouTubeJob(env, 'system-refresh', job);
        const status = result.nextPageToken ? 'queued' : 'completed';
        await env.DB.prepare(`UPDATE youtube_discovery_jobs SET status=?,page_token=?,retry_after=NULL,error_summary=NULL,
          discovered_count=discovered_count+?,finished_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?`)
          .bind(status, result.nextPageToken, result.discovered, status, job.id).run();
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0,350) : 'Metadata refresh failed.';
        await env.DB.prepare("UPDATE youtube_discovery_jobs SET status='queued',retry_after=?,error_summary=?,finished_at=NULL WHERE id=?")
          .bind(new Date(Date.now()+24*60*60*1000).toISOString(), message, job.id).run();
        break;
      }
    }
  } catch (error) {
    console.error('YouTube API metadata refresh paused; it will resume on the next scheduled run.', error);
  }
}
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
        env.DB.prepare("INSERT INTO user_faculty_preferences (user_id,subject_id,faculty_name,search_aliases) VALUES (?,'subject-idt','Ridhi Baghmar','Riddhi Baghmar')").bind(user.id),
        env.DB.prepare("INSERT INTO user_faculty_preferences (user_id,subject_id,faculty_name,search_aliases) VALUES (?,'subject-afm','Prateek Jagathi','Pratik Jagati')").bind(user.id),
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

  if (request.method === 'GET' && path === '/api/settings/faculty') {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO user_faculty_preferences (user_id,subject_id,faculty_name,search_aliases) VALUES (?,'subject-idt','Ridhi Baghmar','Riddhi Baghmar')").bind(user.id),
      env.DB.prepare("INSERT OR IGNORE INTO user_faculty_preferences (user_id,subject_id,faculty_name,search_aliases) VALUES (?,'subject-afm','Prateek Jagathi','Pratik Jagati')").bind(user.id),
    ]);
    const result = await env.DB.prepare(`SELECT p.subject_id,s.code AS subject_code,s.name AS subject_name,p.faculty_name,p.search_aliases,
      p.preferred_channel_id,c.channel_title,c.identity_status
      FROM user_faculty_preferences p JOIN subjects s ON s.id=p.subject_id
      LEFT JOIN youtube_faculty_channels c ON c.channel_id=p.preferred_channel_id
      WHERE p.user_id=? ORDER BY s.position`).bind(user.id).all();
    return json({ preferences: result.results });
  }

  if (request.method === 'PATCH' && path === '/api/settings/faculty') {
    const body = await readJson(request);
    if (!body || typeof body.subjectId !== 'string') return fail('Choose the subject whose faculty preference you want to update.', 400);
    const subject = YOUTUBE_SUBJECTS.find((item) => item.id === body.subjectId);
    if (!subject) return fail('That subject is not available.', 400);
    if (body.facultyName !== undefined && (typeof body.facultyName !== 'string' || !body.facultyName.trim() || body.facultyName.trim().length > 120)) return fail('Faculty name must be between 1 and 120 characters.', 400);
    if (body.searchAliases !== undefined && (typeof body.searchAliases !== 'string' || body.searchAliases.length > 300)) return fail('Faculty search aliases are invalid.', 400);
    if (body.preferredChannelId !== undefined && body.preferredChannelId !== null && typeof body.preferredChannelId !== 'string') return fail('Preferred channel ID is invalid.', 400);
    const name = typeof body.facultyName === 'string' ? body.facultyName.trim() : null;
    const aliases = typeof body.searchAliases === 'string' ? body.searchAliases.trim() : null;
    const channelId = typeof body.preferredChannelId === 'string' && body.preferredChannelId.trim() ? body.preferredChannelId.trim() : null;
    if (channelId) {
      const verified = await env.DB.prepare("SELECT channel_id FROM youtube_faculty_channels WHERE channel_id=? AND identity_status='verified' AND (matched_subject_id=? OR matched_subject_id IS NULL)").bind(channelId, subject.id).first();
      if (!verified) return fail('Only a channel reviewed and marked verified for this faculty can be selected as preferred.', 409);
    }
    await env.DB.prepare(`INSERT INTO user_faculty_preferences (user_id,subject_id,faculty_name,search_aliases,preferred_channel_id)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id,subject_id) DO UPDATE SET faculty_name=COALESCE(excluded.faculty_name,user_faculty_preferences.faculty_name),
      search_aliases=COALESCE(excluded.search_aliases,user_faculty_preferences.search_aliases),
      preferred_channel_id=CASE WHEN ?=1 THEN excluded.preferred_channel_id ELSE user_faculty_preferences.preferred_channel_id END,updated_at=CURRENT_TIMESTAMP`)
      .bind(user.id, subject.id, name ?? subject.name, aliases ?? '', channelId, body.preferredChannelId !== undefined ? 1 : 0).run();
    return json({ ok: true });
  }

  if (request.method === 'GET' && path === '/api/youtube/discovery/status') {
    const date = youtubeQuotaDate();
    const [quota, queue, counts, playlists, channels] = await Promise.all([
      env.DB.prepare('SELECT quota_date,search_calls,total_units FROM youtube_quota_usage WHERE quota_date=?').bind(date).first(),
      env.DB.prepare("SELECT COUNT(*) AS queued FROM youtube_discovery_jobs WHERE status='queued' AND (retry_after IS NULL OR retry_after<=?)").bind(new Date().toISOString()).first<{ queued: number }>(),
      env.DB.prepare("SELECT status,COUNT(*) AS count FROM youtube_discovery_jobs GROUP BY status").all(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM youtube_playlists').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM youtube_faculty_channels').first<{ count: number }>(),
    ]);
    return json({ apiConfigured: Boolean(env.YOUTUBE_API_KEY), quotaDate: date, quota: quota ?? { quota_date: date, search_calls: 0, total_units: 0 },
      queued: queue?.queued ?? 0, jobs: counts.results, playlistCount: playlists?.count ?? 0, channelCount: channels?.count ?? 0 });
  }

  if (request.method === 'POST' && path === '/api/youtube/discovery/start') {
    if (!env.YOUTUBE_API_KEY) return fail('Configure YOUTUBE_API_KEY as a Cloudflare Worker secret before starting discovery.', 503);
    const body = await readJson(request);
    const subjectId = typeof body?.subjectId === 'string' && body.subjectId ? body.subjectId : null;
    if (subjectId && !YOUTUBE_SUBJECTS.some((subject) => subject.id === subjectId)) return fail('Choose one of the six CA Final subjects.', 400);
    const subjects = subjectId ? YOUTUBE_SUBJECTS.filter((subject) => subject.id === subjectId) : YOUTUBE_SUBJECTS;
    const statements = [];
    for (const subject of subjects) {
      const pref = await env.DB.prepare('SELECT faculty_name,search_aliases FROM user_faculty_preferences WHERE user_id=? AND subject_id=?').bind(user.id, subject.id).first<{ faculty_name: string; search_aliases: string }>();
      const facultyNames = pref ? [pref.faculty_name, ...pref.search_aliases.split(',').map((part) => part.trim())] : [];
      const tasks = makeSubjectSearchTasks(subject.id, subject.name, facultyNames);
      for (const task of tasks) statements.push(env.DB.prepare(`INSERT INTO youtube_discovery_jobs (id,job_type,subject_id,lecture_type,query,status)
        SELECT ?,'search',?,?,?,'queued' WHERE NOT EXISTS
        (SELECT 1 FROM youtube_discovery_jobs WHERE job_type='search' AND subject_id=? AND query=? AND status IN ('queued','running'))`)
        .bind(crypto.randomUUID(), task.subjectId, task.lectureType, task.query, task.subjectId, task.query));
    }
    for (let offset = 0; offset < statements.length; offset += 100) await env.DB.batch(statements.slice(offset, offset + 100));
    const queued = await env.DB.prepare("SELECT COUNT(*) AS count FROM youtube_discovery_jobs WHERE status='queued'").first<{ count: number }>();
    return json({ queued: queued?.count ?? 0, message: 'Subject-specific and faculty-specific YouTube queries are queued. Run them in small batches to stay within the daily quota.' }, 202);
  }

  if (request.method === 'POST' && path === '/api/youtube/discovery/run') {
    if (!env.YOUTUBE_API_KEY) return fail('Configure YOUTUBE_API_KEY as a Cloudflare Worker secret before discovery can run.', 503);
    const body = await readJson(request);
    const limit = Number.isInteger(body?.limit) ? Math.max(1, Math.min(5, Number(body?.limit))) : 3;
    const pending = await env.DB.prepare(`SELECT id,job_type,subject_id,lecture_type,query,target_channel_id,target_playlist_id,page_token
      FROM youtube_discovery_jobs WHERE status='queued' AND (retry_after IS NULL OR retry_after<=?) ORDER BY created_at,id LIMIT ?`)
      .bind(new Date().toISOString(), limit).all<YouTubeJobRow>();
    let completed = 0; let discovered = 0; const errors: string[] = [];
    for (const job of pending.results) {
      const lock = await env.DB.prepare("UPDATE youtube_discovery_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),attempt_count=attempt_count+1 WHERE id=? AND status='queued'").bind(job.id).run();
      if (!lock.meta.changes) continue;
      try {
        const result = await runYouTubeJob(env, user.id, job);
        const status = result.nextPageToken ? 'queued' : 'completed';
        await env.DB.prepare(`UPDATE youtube_discovery_jobs SET status=?,page_token=?,retry_after=NULL,error_summary=NULL,
          discovered_count=discovered_count+?,finished_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?`)
          .bind(status, result.nextPageToken, result.discovered, status, job.id).run();
        completed += 1; discovered += result.discovered;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 350) : 'YouTube discovery failed.';
        const apiError = error instanceof YouTubeApiError ? error : null;
        const count = await env.DB.prepare('SELECT attempt_count FROM youtube_discovery_jobs WHERE id=?').bind(job.id).first<{ attempt_count: number }>();
        const quotaWait = apiError?.reason === 'quotaExceeded' || apiError?.reason === 'localQuotaExceeded';
        const retry = quotaWait ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : new Date(Date.now() + 15_000 * 2 ** Math.max(0, (count?.attempt_count ?? 1) - 1)).toISOString();
        const retryable = !apiError || apiError.status >= 500 || apiError.status === 429 || apiError.status === 503 || quotaWait;
        const nextStatus = retryable && ((count?.attempt_count ?? 1) < 3 || quotaWait || apiError?.reason === 'missingApiKey') ? 'queued' : 'failed';
        await env.DB.prepare('UPDATE youtube_discovery_jobs SET status=?,retry_after=?,error_summary=?,finished_at=CASE WHEN ?=\'failed\' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?')
          .bind(nextStatus, nextStatus === 'queued' ? (quotaWait ? retry : null) : null, message, nextStatus, job.id).run();
        errors.push(message);
        if (quotaWait) break;
      }
    }
    const status = await env.DB.prepare("SELECT COUNT(*) AS queued FROM youtube_discovery_jobs WHERE status='queued'").first<{ queued: number }>();
    return json({ processed: completed, discovered, queued: status?.queued ?? 0, errors });
  }

  if (request.method === 'GET' && path === '/api/youtube/channels') {
    const result = await env.DB.prepare(`SELECT c.channel_id,c.channel_title,c.description,c.custom_url,c.identity_status,c.verification_evidence,
      c.source,c.matched_subject_id,c.preferred_faculty_name,c.last_scanned_at,p.faculty_name AS preferred_name
      FROM youtube_faculty_channels c LEFT JOIN user_faculty_preferences p ON p.user_id=? AND p.subject_id=c.matched_subject_id
      ORDER BY CASE WHEN c.identity_status='verified' THEN 0 ELSE 1 END,c.channel_title`).bind(user.id).all();
    return json({ channels: result.results });
  }

  if (request.method === 'POST' && path === '/api/youtube/channels') {
    const body = await readJson(request);
    if (!body || typeof body.channelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(body.channelId)) return fail('Enter a valid YouTube channel ID (starts with UC).', 400);
    const subjectId = typeof body.subjectId === 'string' && YOUTUBE_SUBJECTS.some((item) => item.id === body.subjectId) ? body.subjectId : null;
    await env.DB.prepare(`INSERT OR IGNORE INTO youtube_faculty_channels (channel_id,channel_title,identity_status,source,matched_subject_id)
      VALUES (?,'Channel identity not checked','pending_review','manual',?)`).bind(body.channelId, subjectId).run();
    return json({ ok: true, channelId: body.channelId, status: 'pending_review' }, 201);
  }

  const channelAction = path.match(/^\/api\/youtube\/channels\/([A-Za-z0-9_-]{24})\/(verify|scan)$/);
  if (channelAction && request.method === 'POST') {
    if (!env.YOUTUBE_API_KEY) return fail('Configure YOUTUBE_API_KEY as a Worker secret before channel verification or scanning.', 503);
    const channelId = channelAction[1];
    const channel = await env.DB.prepare('SELECT * FROM youtube_faculty_channels WHERE channel_id=?').bind(channelId).first<Record<string, unknown>>();
    if (!channel) return fail('Add this channel before verifying it.', 404);
    if (channelAction[2] === 'verify') {
      const data = await youtubeGet<{ items?: Record<string, unknown>[] }>(env.YOUTUBE_API_KEY, 'channels', { part: 'snippet,contentDetails', id: channelId }, (method) => reserveYouTubeQuota(env, method));
      const item = data.items?.[0];
      if (!item) return fail('YouTube did not return this channel. It may be unavailable or the ID may be wrong.', 404);
      const snippet = item.snippet as Record<string, unknown>;
      const content = item.contentDetails as Record<string, unknown> | undefined;
      const uploads = (content?.relatedPlaylists as Record<string, unknown> | undefined)?.uploads;
      await env.DB.prepare(`UPDATE youtube_faculty_channels SET channel_title=?,description=?,custom_url=?,uploads_playlist_id=?,identity_checked_at=CURRENT_TIMESTAMP,
        identity_status='pending_review',verification_evidence='Fetched directly from YouTube Data API. Review the channel name, description, and linked identity before confirming.',updated_at=CURRENT_TIMESTAMP WHERE channel_id=?`)
        .bind(String(snippet.title ?? 'YouTube channel'), String(snippet.description ?? ''), typeof snippet.customUrl === 'string' ? snippet.customUrl : null,
          typeof uploads === 'string' ? uploads : null, channelId).run();
      return json({ channelId, channel_title: snippet.title, description: snippet.description, custom_url: snippet.customUrl, identity_status: 'pending_review' });
    }
    if (channel.identity_status !== 'verified') return fail('Review and verify this channel identity before scanning its playlists.', 409);
    const result = await env.DB.prepare(`INSERT INTO youtube_discovery_jobs (id,job_type,subject_id,target_channel_id,status)
      VALUES (?,'channel_playlists',?,?,'queued')`).bind(crypto.randomUUID(), channel.matched_subject_id ?? null, channelId).run();
    return json({ ok: true, queued: result.meta.changes }, 202);
  }

  const channelReview = path.match(/^\/api\/youtube\/channels\/([A-Za-z0-9_-]{24})$/);
  if (channelReview && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body || !['verified','rejected'].includes(String(body.status))) return fail('Choose verified or rejected after reviewing the channel identity.', 400);
    if (body.status === 'verified') {
      const checked = await env.DB.prepare('SELECT identity_checked_at FROM youtube_faculty_channels WHERE channel_id=?').bind(channelReview[1]).first<{ identity_checked_at: string | null }>();
      if (!checked?.identity_checked_at) return fail('Fetch the channel directly from YouTube first, then review its identity before marking it verified.', 409);
    }
    const result = await env.DB.prepare('UPDATE youtube_faculty_channels SET identity_status=?,verification_evidence=?,updated_at=CURRENT_TIMESTAMP WHERE channel_id=?')
      .bind(body.status, `Owner reviewed channel identity on ${new Date().toISOString()}.`, channelReview[1]).run();
    if (!result.meta.changes) return fail('Channel was not found.', 404);
    return json({ ok: true, identity_status: body.status });
  }

  if (request.method === 'GET' && path === '/api/youtube/playlists') {
    const subjectId = url.searchParams.get('subjectId');
    const result = subjectId
      ? await env.DB.prepare('SELECT * FROM youtube_playlists WHERE subject_id=? ORDER BY title').bind(subjectId).all()
      : await env.DB.prepare('SELECT * FROM youtube_playlists ORDER BY title').all();
    return json({ playlists: result.results });
  }

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

  if (request.method === 'GET' && path === '/api/topics') {
    const result = await env.DB.prepare(`SELECT topics.id,topics.chapter_id,topics.title,chapters.subject_id
      FROM topics JOIN chapters ON chapters.id=topics.chapter_id WHERE chapters.is_archived=0 ORDER BY topics.position,topics.title`).all();
    return json({ topics: result.results });
  }

  if (request.method === 'GET' && path === '/api/resource-sources') {
    const result = await env.DB.prepare('SELECT id, name, base_url, terms_url, robots_status, policy_status, collection_mode, access_notes, last_investigated_at FROM resource_source_registry ORDER BY name').all();
    return json({ sources: result.results });
  }

  if (request.method === 'GET' && path === '/api/resources') {
    const result = await env.DB.prepare(`SELECT r.id, r.canonical_url, r.title, r.resource_type, r.access_type, r.verification_status,
      r.provider, r.attempt, r.scheme, r.language, r.duration_seconds, r.published_at, r.last_verified_at,
      r.youtube_video_id,r.youtube_channel_id,r.youtube_channel_title,r.youtube_playlist_id,r.description,r.thumbnail_url,
      r.youtube_duration_iso,r.captions_available,r.lecture_type,r.attempt_relevance,
      m.subject_id, m.chapter_id, ch.title AS chapter_title, m.topic_id, t.title AS topic_title, m.review_status, m.confidence, s.code AS subject_code, ll.status AS lecture_status,
      (SELECT source_url FROM resource_sources WHERE resource_id = r.id ORDER BY discovered_at LIMIT 1) AS source_url,
      (SELECT source_name FROM resource_sources WHERE resource_id = r.id ORDER BY discovered_at LIMIT 1) AS source_name,
      (SELECT collection_method FROM resource_sources WHERE resource_id = r.id ORDER BY discovered_at LIMIT 1) AS collection_method
      FROM resources r LEFT JOIN resource_mappings m ON m.resource_id = r.id
      LEFT JOIN subjects s ON s.id = m.subject_id LEFT JOIN chapters ch ON ch.id=m.chapter_id LEFT JOIN topics t ON t.id=m.topic_id
      LEFT JOIN lecture_library ll ON ll.resource_id = r.id
      ORDER BY r.created_at DESC LIMIT 250`).all();
    return json({ resources: result.results });
  }

  const resourceMappingMatch = path.match(/^\/api\/resources\/([a-f0-9-]{36})\/mapping$/i);
  if (resourceMappingMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body || typeof body.subjectId !== 'string' || !['approved','rejected'].includes(String(body.reviewStatus))) return fail('Choose a subject and approve or reject its mapping.', 400);
    let chapterId: string | null = null;
    const topicId = typeof body.topicId === 'string' && body.topicId ? body.topicId : null;
    if (typeof body.chapterId === 'string' && body.chapterId) {
      const chapter = await env.DB.prepare('SELECT id FROM chapters WHERE id=? AND subject_id=? AND is_archived=0').bind(body.chapterId, body.subjectId).first<{ id: string }>();
      if (!chapter) return fail('The selected chapter does not belong to that subject.', 400);
      chapterId = chapter.id;
    }
    if (topicId && (!chapterId || !await env.DB.prepare('SELECT id FROM topics WHERE id=? AND chapter_id=?').bind(topicId, chapterId).first())) return fail('The selected topic does not belong to that chapter.', 400);
    const result = await env.DB.prepare('UPDATE resource_mappings SET review_status=?,chapter_id=COALESCE(?,chapter_id),topic_id=COALESCE(?,topic_id),updated_at=CURRENT_TIMESTAMP WHERE resource_id=? AND subject_id=?')
      .bind(body.reviewStatus, chapterId, topicId, resourceMappingMatch[1], body.subjectId).run();
    if (!result.meta.changes) return fail('This resource has no mapping for that subject.', 404);
    return json({ ok: true });
  }

  const importLectureMatch = path.match(/^\/api\/resources\/([a-f0-9-]{36})\/lecture$/i);
  if (importLectureMatch && request.method === 'POST') {
    const body = await readJson(request);
    const resource = await env.DB.prepare('SELECT id,youtube_video_id,youtube_channel_id FROM resources WHERE id=?').bind(importLectureMatch[1]).first<{ id: string; youtube_video_id: string | null; youtube_channel_id: string | null }>();
    if (!resource) return fail('Resource was not found.', 404);
    const subjectId = typeof body?.subjectId === 'string' ? body.subjectId : null;
    const chapterId = typeof body?.chapterId === 'string' ? body.chapterId : null;
    const topicId = typeof body?.topicId === 'string' ? body.topicId : null;
    if (chapterId && (!subjectId || !await env.DB.prepare('SELECT id FROM chapters WHERE id=? AND subject_id=? AND is_archived=0').bind(chapterId, subjectId).first())) return fail('The chapter must belong to the selected subject.', 400);
    if (topicId && (!chapterId || !await env.DB.prepare('SELECT id FROM topics WHERE id=? AND chapter_id=?').bind(topicId, chapterId).first())) return fail('The topic must belong to the selected chapter.', 400);
    if (resource.youtube_video_id && resource.youtube_channel_id) {
      const channel = await env.DB.prepare("SELECT identity_status FROM youtube_faculty_channels WHERE channel_id=? AND identity_status='verified'").bind(resource.youtube_channel_id).first();
      if (!channel) return fail('Review and verify this channel identity before importing its video.', 409);
    }
    await env.DB.prepare(`INSERT INTO lecture_library (id,resource_id,subject_id,chapter_id,topic_id)
      VALUES (?,?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET subject_id=COALESCE(excluded.subject_id,lecture_library.subject_id),
      chapter_id=COALESCE(excluded.chapter_id,lecture_library.chapter_id),topic_id=COALESCE(excluded.topic_id,lecture_library.topic_id),updated_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), resource.id, subjectId, chapterId, topicId).run();
    return json({ ok: true, resourceId: resource.id });
  }

  if (request.method === 'GET' && path === '/api/lecture-library') {
    const result = await env.DB.prepare(`SELECT l.*,r.title,r.canonical_url,r.youtube_video_id,r.youtube_channel_title,r.duration_seconds,
      r.lecture_type,r.thumbnail_url,s.code AS subject_code,ch.title AS chapter_title,t.title AS topic_title
      FROM lecture_library l JOIN resources r ON r.id=l.resource_id LEFT JOIN subjects s ON s.id=l.subject_id
      LEFT JOIN chapters ch ON ch.id=l.chapter_id LEFT JOIN topics t ON t.id=l.topic_id ORDER BY l.imported_at DESC`).all();
    return json({ lectures: result.results });
  }

  if (request.method === 'POST' && path === '/api/resources') {
    const body = await readJson(request);
    const allowedTypes = ['class', 'study_material', 'question_paper', 'suggested_answer', 'rtp', 'mtp', 'mcq', 'practice', 'other'];
    const canonical = typeof body?.url === 'string' ? canonicalResourceUrl(body.url) : null;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const resourceType = typeof body?.resourceType === 'string' ? body.resourceType : '';
    if (!body || !canonical || !title || title.length > 240 || !allowedTypes.includes(resourceType)) return fail('Enter a valid HTTP(S) link, a title up to 240 characters, and a supported resource type.', 400);
    const provenance = typeof body.sourceUrl === 'string' && body.sourceUrl.trim() ? canonicalResourceUrl(body.sourceUrl) : canonical;
    if (!provenance) return fail('The source page must be a valid HTTP(S) link.', 400);
    const sourceName = typeof body.sourceName === 'string' && body.sourceName.trim() ? body.sourceName.trim().slice(0, 100) : new URL(provenance).hostname;
    let subjectId: string | null = null;
    let chapterId: string | null = null;
    if (typeof body.subjectId === 'string' && body.subjectId) {
      const subject = await env.DB.prepare('SELECT id FROM subjects WHERE id = ? AND is_active = 1').bind(body.subjectId).first<{ id: string }>();
      if (!subject) return fail('The selected subject does not exist.', 400);
      subjectId = subject.id;
    }
    if (typeof body.chapterId === 'string' && body.chapterId) {
      if (!subjectId) return fail('Choose a subject before mapping a chapter.', 400);
      const chapter = await env.DB.prepare('SELECT id FROM chapters WHERE id = ? AND subject_id = ? AND is_archived = 0').bind(body.chapterId, subjectId).first<{ id: string }>();
      if (!chapter) return fail('The chapter must belong to the selected subject.', 400);
      chapterId = chapter.id;
    }
    const resourceId = id();
    await env.DB.prepare('INSERT OR IGNORE INTO resources (id, canonical_url, title, resource_type, provider, attempt, scheme, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(resourceId, canonical, title, resourceType,
        typeof body.provider === 'string' ? body.provider.trim().slice(0, 120) || null : null,
        typeof body.attempt === 'string' ? body.attempt.trim().slice(0, 40) || null : null,
        typeof body.scheme === 'string' ? body.scheme.trim().slice(0, 80) || null : null,
        typeof body.language === 'string' ? body.language.trim().slice(0, 60) || null : null).run();
    const saved = await env.DB.prepare('SELECT id FROM resources WHERE canonical_url = ?').bind(canonical).first<{ id: string }>();
    if (!saved) return fail('The resource could not be saved.', 500);
    await env.DB.prepare('INSERT OR IGNORE INTO resource_sources (id, resource_id, source_url, source_name, collection_method) VALUES (?, ?, ?, ?, ?)')
      .bind(id(), saved.id, provenance, sourceName, 'manual_link_import').run();
    if (subjectId) {
      await env.DB.prepare(`INSERT INTO resource_mappings (id, resource_id, subject_id, confidence, review_status)
        SELECT ?, ?, ?, 0, 'pending' WHERE NOT EXISTS (SELECT 1 FROM resource_mappings WHERE resource_id = ? AND subject_id = ?)`)
        .bind(id(), saved.id, subjectId, saved.id, subjectId).run();
      if (chapterId) await env.DB.prepare("UPDATE resource_mappings SET chapter_id = ? WHERE resource_id = ? AND subject_id = ? AND review_status = 'pending'").bind(chapterId, saved.id, subjectId).run();
    }
    return json({ resource: { id: saved.id, canonical_url: canonical, title, resource_type: resourceType }, duplicate: saved.id !== resourceId }, 201);
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
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(refreshYoutubeMetadata(env));
  },
};
