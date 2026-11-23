import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, ExternalLink, Link2, Play, RefreshCw, Search, Youtube, X } from 'lucide-react';
import { api, type Subject } from './lib/api';

interface Source { id: string; name: string; base_url: string; terms_url: string | null; robots_status: string; policy_status: string; collection_mode: string; access_notes: string; }
interface FacultyPreference { subject_id: string; faculty_name: string; search_aliases: string; preferred_channel_id: string | null; identity_status: string | null; }
interface DiscoveryStatus { apiConfigured: boolean; quotaDate: string; quota: { search_calls: number; total_units: number }; queued: number; jobs: { status: string; count: number }[]; playlistCount: number; channelCount: number; }
interface Playlist { playlist_id: string; title: string; description: string; channel_id: string | null; channel_title: string | null; thumbnail_url: string | null; published_at: string | null; item_count: number | null; subject_id: string | null; attempt_relevance: string; }
interface Topic { id: string; chapter_id: string; subject_id: string; title: string; }
interface Resource { id: string; canonical_url: string; title: string; resource_type: string; provider: string | null; duration_seconds: number | null; subject_id: string | null; subject_code: string | null; chapter_id: string | null; chapter_title: string | null; topic_id: string | null; topic_title: string | null; review_status: string | null; confidence: number | null; youtube_video_id: string | null; youtube_channel_id: string | null; youtube_channel_title: string | null; youtube_playlist_id: string | null; description: string | null; thumbnail_url: string | null; youtube_duration_iso: string | null; captions_available: number | null; lecture_type: string | null; attempt_relevance: string; lecture_status: string | null; source_name: string; }

const TYPE_LABELS: Record<string, string> = { detailed: 'Detailed', full_course: 'Full course', chapter_wise: 'Chapter-wise', marathon: 'Marathon', revision: 'Revision', fast_track: 'Fast-track', mcq: 'MCQ', case_study: 'Case study', exam_prep: 'Exam prep', other: 'Other' };
function durationLabel(seconds: number | null) { if (!seconds) return 'Duration unavailable'; const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; }

export function ResourceCollector({ subjects, chapters, onSettings }: { subjects: Subject[]; chapters: { id: string; subject_id: string; title: string }[]; onSettings: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [preferences, setPreferences] = useState<FacultyPreference[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [preview, setPreview] = useState<Resource | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [chapterChoice, setChapterChoice] = useState<Record<string, string>>({});
  const [topicChoice, setTopicChoice] = useState<Record<string, string>>({});

  async function refresh() {
    const [sourceData, resourceData, statusData, playlistData, preferenceData, topicData] = await Promise.all([
      api<{ sources: Source[] }>('/api/resource-sources'), api<{ resources: Resource[] }>('/api/resources'),
      api<DiscoveryStatus>('/api/youtube/discovery/status'), api<{ playlists: Playlist[] }>('/api/youtube/playlists'),
      api<{ preferences: FacultyPreference[] }>('/api/settings/faculty'),
      api<{ topics: Topic[] }>('/api/topics'),
    ]);
    setSources(sourceData.sources); setResources(resourceData.resources); setStatus(statusData);
    setPlaylists(playlistData.playlists); setPreferences(preferenceData.preferences);
    setTopics(topicData.topics);
  }
  useEffect(() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load discovery data.')); }, []);

  const subjectChapters = useMemo(() => chapters.filter((chapter) => !subjectFilter || chapter.subject_id === subjectFilter), [chapters, subjectFilter]);
  const facultyOptions = [...new Set(resources.map((resource) => resource.youtube_channel_title).filter((name): name is string => Boolean(name)))].sort();
  const filtered = resources.filter((resource) => {
    if (!resource.youtube_video_id) return false;
    if (subjectFilter && resource.subject_id !== subjectFilter) return false;
    if (facultyFilter && resource.youtube_channel_title !== facultyFilter) return false;
    if (chapterFilter && resource.chapter_id !== chapterFilter) return false;
    if (typeFilter && resource.lecture_type !== typeFilter) return false;
    if (textFilter && !`${resource.title} ${resource.description ?? ''}`.toLowerCase().includes(textFilter.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    const aPreferred = preferences.some((p) => p.preferred_channel_id && p.preferred_channel_id === a.youtube_channel_id);
    const bPreferred = preferences.some((p) => p.preferred_channel_id && p.preferred_channel_id === b.youtube_channel_id);
    return Number(bPreferred) - Number(aPreferred) || (b.title.localeCompare(a.title));
  });

  async function startDiscovery() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ queued: number }>('/api/youtube/discovery/start', { method: 'POST', body: JSON.stringify({ subjectId: subjectFilter || null }) });
      setMessage(`${result.queued} YouTube search queries queued. Each query uses a preferred-faculty name variant and a broader subject query.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not queue YouTube searches.'); }
    finally { setBusy(false); }
  }

  async function runDiscovery() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ processed: number; discovered: number; queued: number; errors: string[] }>('/api/youtube/discovery/run', { method: 'POST', body: JSON.stringify({ limit: 3 }) });
      setMessage(`${result.processed} job pages processed · ${result.discovered} video/playlist/channel records discovered · ${result.queued} jobs remain queued.`);
      if (result.errors.length) setError(result.errors.join(' '));
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'YouTube discovery could not run.'); }
    finally { setBusy(false); }
  }

  async function mapping(resource: Resource, reviewStatus: 'approved' | 'rejected') {
    if (!resource.subject_id) return;
    setBusy(true); setError('');
    try {
      await api(`/api/resources/${resource.id}/mapping`, { method: 'PATCH', body: JSON.stringify({ subjectId: resource.subject_id, chapterId: chapterChoice[resource.id] || resource.chapter_id, topicId: topicChoice[resource.id] || resource.topic_id, reviewStatus }) });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Mapping could not be updated.'); }
    finally { setBusy(false); }
  }

  async function importLecture(resource: Resource) {
    setBusy(true); setError('');
    try {
      await api(`/api/resources/${resource.id}/lecture`, { method: 'POST', body: JSON.stringify({ subjectId: resource.subject_id, chapterId: chapterChoice[resource.id] || resource.chapter_id, topicId: topicChoice[resource.id] || resource.topic_id }) });
      setMessage(`Added “${resource.title}” to Lecture Manager.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'This resource could not be imported.'); }
    finally { setBusy(false); }
  }

  async function manualImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ duplicate: boolean }>('/api/resources', { method: 'POST', body: JSON.stringify({
        url: form.get('url'), title: form.get('title'), resourceType: form.get('resourceType'), provider: form.get('provider'),
        attempt: form.get('attempt'), scheme: form.get('scheme'), language: form.get('language'), subjectId: form.get('subjectId') || null,
        sourceName: form.get('sourceName'), sourceUrl: form.get('sourceUrl'),
      }) });
      setMessage(result.duplicate ? 'The link already exists; its source reference was saved.' : 'Resource link saved.'); formElement.reset(); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Resource link could not be saved.'); }
    finally { setBusy(false); }
  }

  return <div className="page-content resource-page youtube-page">
    <div className="page-heading"><div><div className="eyebrow muted">YOUTUBE IS THE PRIMARY VIDEO SOURCE</div><h1>YouTube discovery<span className="heading-period">.</span></h1><p>Search all six subjects, inspect playlists, and review mappings before adding videos to Lecture Manager.</p><p className="settings-explainer">May 2028 syllabus relevance stays unverified until the official ICAI syllabus source is checked and mapped.</p></div><button className="icon-button" aria-label="Refresh discovery data" onClick={() => void refresh()}><RefreshCw size={16}/></button></div>
    <section className="youtube-control-panel"><div className="youtube-api-state"><div className="youtube-api-brand"><Youtube size={19}/><span>Search results and videos are from YouTube</span></div><span className={`source-policy ${status?.apiConfigured ? 'source-verified' : 'source-pending_review'}`}>{status?.apiConfigured ? 'API configured' : 'API key required'}</span></div>
      {!status?.apiConfigured && <div className="resource-policy-note"><strong>Set the API key as a Cloudflare secret</strong><code>npx wrangler secret put YOUTUBE_API_KEY</code><span>The app never sends the key to the browser. Configure the secret in the Worker environment, then refresh this page.</span></div>}
      <div className="youtube-run-row"><label>Search subject<select value={subjectFilter} onChange={(event) => { setSubjectFilter(event.target.value); setChapterFilter(''); }}><option value="">All six subjects</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select></label><div className="youtube-run-actions"><button className="button button-outline" disabled={busy || !status?.apiConfigured} onClick={() => void startDiscovery()}>Queue searches</button><button className="button button-primary" disabled={busy || !status?.apiConfigured || !status?.queued} onClick={() => void runDiscovery()}><Play size={15} fill="currentColor"/>{busy ? 'Working…' : 'Run next pages'}</button></div></div>
      <div className="youtube-quota"><span>Search calls today <strong>{status?.quota.search_calls ?? 0}/90</strong></span><span>API units <strong>{status?.quota.total_units ?? 0}/9,000</strong></span><span>Queued pages <strong>{status?.queued ?? 0}</strong></span><span>Playlists <strong>{status?.playlistCount ?? 0}</strong></span><span>Channels to review <strong>{status?.channelCount ?? 0}</strong></span></div>
      <p className="youtube-quota-note">Daily safety caps are kept below YouTube’s default quotas. Search tasks and next-page tokens are stored in D1 and can continue later.</p>
    </section>

    <section className="youtube-preferences-strip"><strong>Preferred faculty first</strong>{preferences.map((pref) => <span key={pref.subject_id}>{pref.subject_id === 'subject-idt' ? 'IDT' : pref.subject_id === 'subject-afm' ? 'AFM' : pref.subject_id}: {pref.faculty_name}{pref.preferred_channel_id ? ' · verified channel' : ' · channel review pending'}</span>)}<button className="link-button" onClick={onSettings}>Edit in Settings <ArrowRight size={13}/></button></section>

    <section className="youtube-browser panel-like"><div className="resource-panel-heading"><div><span className="panel-kicker">SAVED YOUTUBE API RESULTS</span><h2>Videos <span className="nav-count">{filtered.length}</span></h2></div><span className="youtube-attribution">YouTube</span></div>
      <div className="youtube-filters"><label><Search size={14}/><input value={textFilter} onChange={(event) => setTextFilter(event.target.value)} placeholder="Search video titles and descriptions"/></label><select value={facultyFilter} onChange={(event) => setFacultyFilter(event.target.value)}><option value="">All faculty / channels</option>{facultyOptions.map((name) => <option key={name}>{name}</option>)}</select><select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="">All chapters</option>{subjectChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All lecture types</option>{Object.entries(TYPE_LABELS).filter(([key]) => key !== 'other').map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {preview && <div className="youtube-preview"><div className="youtube-preview-head"><strong>{preview.title}</strong><button className="icon-button" aria-label="Close video preview" onClick={() => setPreview(null)}><X size={16}/></button></div><iframe src={`https://www.youtube.com/embed/${encodeURIComponent(preview.youtube_video_id ?? '')}`} title={preview.title} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/><a href={preview.canonical_url} target="_blank" rel="noreferrer">Open in YouTube <ExternalLink size={13}/></a></div>}
      {filtered.length ? <div className="youtube-video-list">{filtered.map((resource) => {
        const pref = preferences.find((p) => p.preferred_channel_id && p.preferred_channel_id === resource.youtube_channel_id);
        const pending = resource.review_status === 'pending';
        return <article className={`youtube-video-card ${pref ? 'preferred-video' : ''}`} key={resource.id}>
          <button className="youtube-thumb-button" onClick={() => setPreview(resource)} aria-label={`Preview ${resource.title}`}>
            {resource.thumbnail_url ? <img className="youtube-thumb" src={resource.thumbnail_url} alt={resource.title}/> : <span className="youtube-thumb-placeholder"><Youtube size={26}/></span>}
            <span className="youtube-play-overlay"><Play size={18} fill="currentColor"/></span>
          </button>
          <div className="youtube-video-copy"><div className="youtube-video-tags"><span>{TYPE_LABELS[resource.lecture_type ?? 'other'] ?? 'Other'}</span>{pref && <strong>Preferred faculty</strong>}{resource.attempt_relevance !== 'unverified' && <span>{resource.attempt_relevance.replaceAll('_',' ')}</span>}</div>
            <h3>{resource.title}</h3><p className="youtube-channel-line">{resource.youtube_channel_title ?? resource.provider ?? 'Channel unavailable'} · {durationLabel(resource.duration_seconds)}{resource.captions_available === 1 ? ' · captions available' : resource.captions_available === 0 ? ' · no captions reported' : ''}</p>
            <p className="youtube-mapping-line">{resource.subject_code ?? 'Subject unmapped'}{resource.chapter_title ? ` · ${resource.chapter_title}` : ' · Chapter pending'}{resource.topic_title ? ` · ${resource.topic_title}` : ''}{pending ? ` · ${(resource.confidence ?? 0).toFixed(2)} confidence · review pending` : ''}</p>
            <div className="youtube-video-actions"><button className="button button-quiet" onClick={() => setPreview(resource)}><Play size={13}/>Preview</button><a className="button button-quiet" href={resource.canonical_url} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a>
              {resource.youtube_playlist_id && <a className="button button-quiet" href={`https://www.youtube.com/playlist?list=${encodeURIComponent(resource.youtube_playlist_id)}`} target="_blank" rel="noreferrer">Playlist <ExternalLink size={13}/></a>}
              {resource.subject_id && pending && <><select aria-label={`Chapter mapping for ${resource.title}`} value={chapterChoice[resource.id] ?? resource.chapter_id ?? ''} onChange={(event) => { setChapterChoice((all) => ({ ...all, [resource.id]: event.target.value })); setTopicChoice((all) => ({ ...all, [resource.id]: '' })); }}><option value="">Keep chapter unmapped</option>{chapters.filter((chapter) => chapter.subject_id === resource.subject_id).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select><select aria-label={`Topic mapping for ${resource.title}`} value={topicChoice[resource.id] ?? resource.topic_id ?? ''} onChange={(event) => setTopicChoice((all) => ({ ...all, [resource.id]: event.target.value }))}><option value="">Keep topic unmapped</option>{topics.filter((topic) => topic.chapter_id === (chapterChoice[resource.id] ?? resource.chapter_id)).map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select><button className="button button-quiet" disabled={busy} onClick={() => void mapping(resource,'approved')}>Approve mapping</button><button className="button button-quiet" disabled={busy} onClick={() => void mapping(resource,'rejected')}>Reject</button></>}
              <button className="button button-primary compact-button" disabled={busy || Boolean(resource.lecture_status)} onClick={() => void importLecture(resource)}>{resource.lecture_status ? 'In Lecture Manager' : 'Add to Lecture Manager'}<ArrowRight size={13}/></button>
            </div>
          </div>
        </article>;
      })}</div> : <div className="empty-chapters">{resources.some((item) => item.youtube_video_id) ? 'No videos match these filters.' : status?.apiConfigured ? 'No YouTube results have been collected yet. Queue searches, then run the next pages.' : 'Configure the Worker secret to search YouTube. No discovery results are fabricated.'}</div>}
    </section>

    <section className="resource-catalogue youtube-playlists"><div className="resource-panel-heading"><div><span className="panel-kicker">PLAYLIST BROWSER</span><h2>Public playlists <span className="nav-count">{playlists.length}</span></h2></div></div>
      {playlists.length ? playlists.map((playlist) => <article className="resource-row playlist-row" key={playlist.playlist_id}>{playlist.thumbnail_url ? <img className="playlist-thumb" src={playlist.thumbnail_url} alt=""/> : <div className="resource-icon"><Link2 size={16}/></div>}<div className="resource-row-copy"><strong>{playlist.title}</strong><span>{playlist.channel_title ?? 'Channel unavailable'} · {playlist.item_count ?? '—'} items · {subjects.find((s) => s.id === playlist.subject_id)?.code ?? 'Subject pending'} · May 2028 fit {playlist.attempt_relevance}</span></div><a href={`https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.playlist_id)}`} target="_blank" rel="noreferrer" aria-label={`Open playlist ${playlist.title}`}><ExternalLink size={16}/></a></article>) : <div className="empty-chapters">No public playlists discovered yet.</div>}
    </section>

    <details className="resource-import-panel secondary-sources"><summary>Optional secondary sources and manual link import</summary><p className="settings-explainer">YouTube remains the primary video source. The other websites are optional secondary references; automatic crawling remains disabled under the access rules recorded in the source report.</p>
      <div className="resource-source-grid">{sources.filter((source) => source.id !== 'source-youtube-api').map((source) => <article className="resource-source-card" key={source.id}><div className="resource-source-top"><strong>{source.name}</strong><span className={`source-policy source-${source.policy_status}`}>{source.policy_status.replaceAll('_',' ')}</span></div><p>{source.access_notes}</p><div className="resource-source-foot"><span>robots: {source.robots_status}</span><a href={source.base_url} target="_blank" rel="noreferrer">Open source <ExternalLink size={13}/></a></div></article>)}</div>
      <form onSubmit={(event) => void manualImport(event)} className="resource-import-form"><label>Resource title<input name="title" required maxLength={240}/></label><label>Resource URL<input name="url" type="url" required placeholder="https://…"/></label><div className="form-row"><label>Type<select name="resourceType" defaultValue="study_material"><option value="class">Class / lecture</option><option value="study_material">Study material</option><option value="question_paper">Question paper</option><option value="suggested_answer">Suggested answer</option><option value="rtp">RTP</option><option value="mtp">MTP</option><option value="mcq">MCQ / case study</option><option value="practice">Practice resource</option><option value="other">Other</option></select></label><label>Subject<select name="subjectId" defaultValue=""><option value="">Unmapped</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select></label></div><div className="form-row"><label>Source name<input name="sourceName" maxLength={100}/></label><label>Source page<input name="sourceUrl" type="url"/></label></div><button className="button button-primary" disabled={busy}>Save secondary link</button></form>
    </details>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="resource-saved" role="status">{message}</div>}
  </div>;
}
