import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, AlarmClock, ArrowDownRight, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, FileText, LayoutDashboard, LogOut, Menu, Play, Plus, RefreshCw, ShieldCheck, Square, TimerReset, X } from 'lucide-react';
import { api, ApiError, formatDuration, type Chapter, type DashboardData, type Subject } from './lib/api';
import { elapsedSeconds, type Activity as StudyActivity, type TimerState } from './lib/studyTimer';

type AuthUser = { id: string; email: string };
type Page = 'dashboard' | 'subjects';
const TIMER_KEY = 'ca-final-os.active-study-timer.v1';
const OUTBOX_KEY = 'ca-final-os.study-session-outbox.v1';
interface PendingSession { id: string; subjectId: string | null; activity: StudyActivity; startedAt: string; endedAt: string; durationSeconds: number; }

const ACTIVITY_OPTIONS: { value: StudyActivity; label: string }[] = [
  { value: 'reading', label: 'Reading' },
  { value: 'lecture', label: 'Lecture' },
  { value: 'note_making', label: 'Note-making' },
  { value: 'practice', label: 'Practice' },
  { value: 'revision', label: 'Revision' },
  { value: 'mock_test', label: 'Mock test' },
  { value: 'other', label: 'Other' },
];

function restoreTimer(): TimerState | null {
  try {
    const stored = localStorage.getItem(TIMER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as TimerState;
    if (!parsed.startedAt || !Number.isFinite(parsed.accumulatedSeconds)) return null;
    return parsed;
  } catch { return null; }
}

function readOutbox(): PendingSession[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as PendingSession[]; }
  catch { return []; }
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(() => restoreTimer());
  const [clock, setClock] = useState(Date.now());
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<StudyActivity>('reading');
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [menuOpen, setMenuOpen] = useState(false);
  const flushInProgress = useRef(false);

  const loadWorkspace = useCallback(async () => {
    const [subjectData, chapterData, dashboardData, healthData] = await Promise.all([
      api<{ subjects: Subject[] }>('/api/subjects'),
      api<{ chapters: Chapter[] }>('/api/chapters'),
      api<DashboardData>('/api/dashboard'),
      api<{ status: string }>('/api/health'),
    ]);
    setSubjects(subjectData.subjects);
    setChapters(chapterData.chapters);
    setDashboard(dashboardData);
    setHealth(healthData.status === 'ok' ? 'connected' : 'offline');
    setSelectedSubjectId((current) => current || subjectData.subjects[0]?.id || '');
  }, []);

  const flushOutbox = useCallback(async () => {
    if (flushInProgress.current) return;
    const queue = readOutbox();
    if (!queue.length) return;
    flushInProgress.current = true;
    const remaining: PendingSession[] = [];
    try {
      for (const item of queue) {
        try {
          await api('/api/study-sessions', { method: 'POST', body: JSON.stringify({
            id: item.id, subjectId: item.subjectId, activity: item.activity, startedAt: item.startedAt,
            endedAt: item.endedAt, durationSeconds: item.durationSeconds,
          }) });
        } catch { remaining.push(item); }
      }
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
      if (remaining.length < queue.length) await loadWorkspace();
    } finally {
      flushInProgress.current = false;
    }
  }, [loadWorkspace]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await api<{ setupRequired: boolean }>('/api/auth/setup-status');
        if (!active) return;
        setSetupRequired(status.setupRequired);
        try {
          const result = await api<{ user: AuthUser }>('/api/auth/me');
          if (active) setUser(result.user);
        } catch (authError) {
          if (!(authError instanceof ApiError && authError.status === 401)) throw authError;
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'The application could not connect to its API.');
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    loadWorkspace().catch((loadError: unknown) => {
      setHealth('offline');
      setError(loadError instanceof Error ? loadError.message : 'Could not load study data.');
    });
    void flushOutbox();
  }, [user, loadWorkspace, flushOutbox]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    else localStorage.removeItem(TIMER_KEY);
  }, [timer]);

  useEffect(() => {
    const online = () => { void flushOutbox(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flushOutbox]);

  const visibleChapters = useMemo(() => selectedSubject === 'all'
    ? chapters
    : chapters.filter((chapter) => chapter.subject_id === selectedSubject), [chapters, selectedSubject]);
  const runningSeconds = timer ? elapsedSeconds(timer, clock) : 0;

  async function handleAuth(values: { email: string; password: string; setupToken?: string }) {
    setBusy(true); setError('');
    try {
      const result = await api<{ user: AuthUser }>(setupRequired ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', body: JSON.stringify(values),
      });
      setUser(result.user); setSetupRequired(false);
    } catch (authError) { setError(authError instanceof Error ? authError.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null); setSubjects([]); setChapters([]); setDashboard(null); setPage('dashboard');
  }

  function startTimer(activity: StudyActivity = selectedActivity) {
    if (timer) return;
    setTimer({ sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(), accumulatedSeconds: 0, runningSince: Date.now(), activity, subjectId: selectedSubjectId || null });
  }

  function togglePause() {
    if (!timer) return;
    if (timer.runningSince !== null) {
      setTimer({ ...timer, accumulatedSeconds: elapsedSeconds(timer, Date.now()), runningSince: null });
    } else {
      setTimer({ ...timer, runningSince: Date.now() });
    }
  }

  async function stopTimer() {
    if (!timer) return;
    const endedAt = new Date().toISOString();
    const durationSeconds = elapsedSeconds(timer, Date.parse(endedAt));
    const saved = { ...timer, accumulatedSeconds: durationSeconds, runningSince: null };
    setTimer(null);
    if (durationSeconds < 1) return;
    try {
      await api('/api/study-sessions', { method: 'POST', body: JSON.stringify({
        id: saved.sessionId, subjectId: saved.subjectId, activity: saved.activity, startedAt: saved.startedAt,
        endedAt, durationSeconds,
      }) });
      await loadWorkspace();
      setError('');
    } catch {
      const queue = readOutbox();
      localStorage.setItem(OUTBOX_KEY, JSON.stringify([...queue, { id: saved.sessionId || crypto.randomUUID(), subjectId: saved.subjectId, activity: saved.activity, startedAt: saved.startedAt, endedAt, durationSeconds }]));
      setError('Session saved on this device. It will sync when the connection returns.');
    }
  }

  async function addChapter(input: { title: string; code: string; sourceReference: string; subjectId: string }) {
    await api('/api/chapters', { method: 'POST', body: JSON.stringify({ ...input, position: chapters.filter((c) => c.subject_id === input.subjectId).length + 1 }) });
    await loadWorkspace();
  }

  async function updateChapter(chapterId: string, changes: { title?: string; status?: string }) {
    await api(`/api/chapters/${chapterId}`, { method: 'PATCH', body: JSON.stringify(changes) });
    await loadWorkspace();
  }

  if (authLoading) return <div className="boot-screen"><div className="brand-mark">C</div><span>Opening your study space…</span></div>;
  if (!user) return <AuthScreen setupRequired={setupRequired} busy={busy} error={error} onSubmit={handleAuth} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><div className="brand-mark">C</div><div><strong>CA Final OS</strong><span>Study workspace</span></div><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => { setPage('dashboard'); setMenuOpen(false); }}><LayoutDashboard size={18} /><span>Dashboard</span></button>
          <button className={`nav-item ${page === 'subjects' ? 'active' : ''}`} onClick={() => { setPage('subjects'); setMenuOpen(false); }}><BookOpen size={18} /><span>Subjects & chapters</span><span className="nav-count">{subjects.length || 6}</span></button>
        </nav>
        <div className="sidebar-card"><div className="sidebar-card-icon"><ShieldCheck size={16} /></div><div><strong>Your data, persisted</strong><span>Study sessions save to your private database.</span></div></div>
        <div className="sidebar-bottom"><div className="connection"><span className={`status-dot ${health}`} />{health === 'connected' ? 'Database connected' : health === 'offline' ? 'Connection issue' : 'Checking database'}</div><button className="profile-button" onClick={() => void logout()}><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><strong>{user.email}</strong><small>Owner account</small></span><LogOut size={16} /></button></div>
      </aside>
      {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <main className="main-area">
        <header className="topbar"><button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={19} /></button><div className="breadcrumbs"><span>CA Final OS</span><span className="crumb-separator">/</span><strong>{page === 'dashboard' ? 'Dashboard' : 'Subjects'}</strong></div><div className="topbar-right"><span className="attempt-pill"><span className="attempt-dot" />MAY 2028 ATTEMPT</span><button className="icon-button help-button" aria-label="Study workspace information" title="Your dashboard shows saved study activity; syllabus coverage is added as it is verified."><CircleHelp size={18} /></button></div></header>
        {error && <div className="notice" role="status"><span>{error}</span><button aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}

        {page === 'dashboard' ? (
          <DashboardPage subjects={subjects} chapters={chapters} data={dashboard} timer={timer} timerSeconds={runningSeconds} selectedSubjectId={selectedSubjectId} selectedActivity={selectedActivity} onSubject={setSelectedSubjectId} onActivity={setSelectedActivity} onStart={startTimer} onPause={togglePause} onStop={stopTimer} onNavigate={setPage} onRefresh={() => void loadWorkspace()} />
        ) : (
          <SubjectsPage subjects={subjects} chapters={visibleChapters} selected={selectedSubject} onSelect={setSelectedSubject} onAdd={addChapter} onUpdate={updateChapter} onRefresh={() => void loadWorkspace()} />
        )}
        <footer className="footer-note"><span>Built for steady, deliberate preparation.</span><span>Study data syncs to your account</span></footer>
      </main>
    </div>
  );
}

function AuthScreen({ setupRequired, busy, error, onSubmit }: { setupRequired: boolean; busy: boolean; error: string; onSubmit: (values: { email: string; password: string; setupToken?: string }) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  return (
    <div className="auth-layout"><div className="auth-showcase"><div className="auth-brand"><div className="brand-mark">C</div><span>CA Final OS</span></div><div className="showcase-content"><div className="eyebrow"><span className="eyebrow-line" />PERSONAL STUDY OPERATING SYSTEM</div><h1>Make your preparation<br /><em>measurable.</em></h1><p>A calm, persistent workspace for classes, notes, practice and revision — built around your CA Final journey.</p><div className="showcase-foot"><span>FINANCIAL REPORTING</span><span>ADVANCED FINANCIAL MANAGEMENT</span><span>INTEGRATED BUSINESS SOLUTIONS</span></div></div><span className="showcase-number">01 — 06</span></div>
      <div className="auth-panel"><div className="auth-panel-inner"><div className="auth-kicker">{setupRequired ? 'FIRST-TIME SETUP' : 'WELCOME BACK'}</div><h2>{setupRequired ? 'Create your owner account' : 'Sign in to your workspace'}</h2><p className="auth-intro">{setupRequired ? 'This one-time setup creates the only owner account for this private study workspace.' : 'Pick up where your study plan left off.'}</p><form onSubmit={(event) => { event.preventDefault(); void onSubmit({ email, password, setupToken: setupRequired ? setupToken : undefined }); }}>
        <label className="field-label" htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} />
        <label className="field-label" htmlFor="password">Password</label><input id="password" type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setupRequired ? 'At least 12 characters' : 'Your password'} required minLength={setupRequired ? 12 : 1} maxLength={200} />
        {setupRequired && <><label className="field-label" htmlFor="setup-token">Owner setup token</label><input id="setup-token" type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} placeholder="From your local Worker secrets" required /><div className="field-help">Configure OWNER_SETUP_TOKEN in the Worker secret store before creating your account.</div></>}
        {error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : setupRequired ? 'Create secure account' : 'Sign in'}<ArrowRight size={16} /></button></form><div className="secure-note"><ShieldCheck size={16} /><span>Password protected. Sessions use secure, httpOnly cookies.</span></div></div><div className="auth-bottom">CA FINAL OS <span>·</span> PRIVATE STUDY SPACE</div></div></div>
  );
}

function DashboardPage({ subjects, chapters, data, timer, timerSeconds, selectedSubjectId, selectedActivity, onSubject, onActivity, onStart, onPause, onStop, onNavigate, onRefresh }: { subjects: Subject[]; chapters: Chapter[]; data: DashboardData | null; timer: TimerState | null; timerSeconds: number; selectedSubjectId: string; selectedActivity: StudyActivity; onSubject: (value: string) => void; onActivity: (value: StudyActivity) => void; onStart: () => void; onPause: () => void; onStop: () => void; onNavigate: (page: Page) => void; onRefresh: () => void }) {
  const seconds = timerSeconds % 60;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  const recent = data?.recent ?? [];
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow muted">YOUR STUDY OVERVIEW</div><h1>{greeting}<span className="heading-period">.</span></h1><p>Keep your next session focused and your progress grounded in real study time.</p></div><button className="button button-quiet refresh-button" onClick={onRefresh}><RefreshCw size={15} />Refresh</button></div>
    <section className="welcome-banner"><div className="welcome-text"><span className="banner-overline">{todayLabel} · MAY 2028 ATTEMPT</span><h2>Small, consistent sessions<br />build strong preparation.</h2><p>Your saved study activity and syllabus coverage will appear here.</p><button className="banner-link" onClick={() => onNavigate('subjects')}>Review your subjects <ArrowRight size={15} /></button></div><div className="banner-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-book"><FileText size={42} strokeWidth={1.1}/></div><div className="art-stamp">CA<br /><span>FINAL</span></div><div className="art-star star-one">✳</div><div className="art-star star-two">✦</div></div></section>
    <section className="metric-grid" aria-label="Study time summaries"><MetricCard label="STUDIED TODAY" value={formatDuration(data?.todaySeconds ?? 0)} sub="From saved sessions" icon={<Clock3 size={17}/>} accent="green"/><MetricCard label="THIS WEEK" value={formatDuration(data?.weekSeconds ?? 0)} sub="Rolling 7-day total" icon={<ArrowDownRight size={17}/>} accent="gold"/><MetricCard label="CHAPTERS ADDED" value={String(chapters.length)} sub="In the editable syllabus" icon={<BookOpen size={17}/>} accent="blue"/></section>
    <section className="content-grid">
      <div className="panel timer-panel"><div className="panel-head"><div><span className="panel-kicker">FOCUS SESSION</span><h3>Study timer</h3></div><div className={`timer-state ${timer ? 'state-live' : ''}`}><span />{timer ? timer.runningSince ? 'IN SESSION' : 'PAUSED' : 'READY'}</div></div><div className="timer-display"><div className="timer-digits">{String(Math.floor(timerSeconds / 3600)).padStart(2, '0')}<span>:</span>{String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0')}<span>:</span>{String(seconds).padStart(2, '0')}</div><p>{timer ? `${ACTIVITY_OPTIONS.find((item) => item.value === timer.activity)?.label ?? 'Study'}${timer.subjectId ? ` · ${subjects.find((subject) => subject.id === timer.subjectId)?.code ?? ''}` : ''}` : 'Time is counted only while your session is running.'}</p></div>{!timer ? <div className="timer-form"><label className="sr-only" htmlFor="timer-subject">Subject for this session</label><select id="timer-subject" value={selectedSubjectId} onChange={(event) => onSubject(event.target.value)}><option value="">Choose a subject</option>{subjects.map((subject) => <option value={subject.id} key={subject.id}>{subject.code} · {subject.name}</option>)}</select><label className="sr-only" htmlFor="timer-activity">Study activity</label><select id="timer-activity" value={selectedActivity} onChange={(event) => onActivity(event.target.value as StudyActivity)}>{ACTIVITY_OPTIONS.map((activity) => <option value={activity.value} key={activity.value}>{activity.label}</option>)}</select><button className="button button-primary" onClick={onStart}><Play size={15} fill="currentColor"/>Start session</button></div> : <div className="timer-controls"><button className="button button-quiet" onClick={onPause}>{timer.runningSince ? <><Square size={14} fill="currentColor"/>Pause</> : <><Play size={14} fill="currentColor"/>Resume</>}</button><button className="button button-outline" onClick={onStop}><Check size={15}/>Stop & save</button></div>}<div className="timer-foot"><TimerReset size={14}/><span>Timer state saves on this device; completed sessions sync to your account.</span></div></div>
      <div className="panel activity-panel"><div className="panel-head"><div><span className="panel-kicker">RECENTLY SAVED</span><h3>Study activity</h3></div><span className="panel-count">{recent.length} {recent.length === 1 ? 'SESSION' : 'SESSIONS'}</span></div>{recent.length ? <div className="activity-list">{recent.map((item) => <div className="activity-row" key={item.id}><div className="activity-icon"><Activity size={16}/></div><div className="activity-copy"><strong>{ACTIVITY_OPTIONS.find((option) => option.value === item.activity)?.label ?? item.activity}</strong><span>{new Date(item.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(item.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div><strong className="activity-duration">{formatDuration(item.duration_seconds)}</strong></div>)}</div> : <div className="empty-activity"><div className="empty-clock"><AlarmClock size={21}/></div><strong>No sessions saved yet</strong><span>Start a timer to begin your activity history.</span></div>}<div className="panel-footer"><span>Saved study time only</span><ArrowRight size={14}/></div></div>
    </section>
    <section className="section-heading"><div><span className="panel-kicker">YOUR SIX SUBJECTS</span><h2>Study areas</h2></div><button className="text-button" onClick={() => onNavigate('subjects')}>Manage chapters <ArrowRight size={15}/></button></section>
    <section className="subject-grid">{subjects.map((subject, index) => <button className="subject-card" key={subject.id} onClick={() => onNavigate('subjects')}><div className={`subject-monogram tone-${index + 1}`}>{subject.code.slice(0, 2)}</div><div className="subject-card-main"><span className="subject-code">{subject.code}</span><strong>{subject.name}</strong><span className="subject-meta">{subject.chapter_count} {subject.chapter_count === 1 ? 'chapter' : 'chapters'} added</span></div><ArrowRight className="subject-arrow" size={16}/></button>)}</section>
    <div className="syllabus-note"><div className="syllabus-note-icon"><CircleHelp size={16}/></div><span><strong>Syllabus mapping is awaiting official source verification.</strong> Chapter totals reflect only what has been entered and do not imply syllabus coverage.</span><button onClick={() => onNavigate('subjects')}>View details</button></div>
  </div>;
}

function MetricCard({ label, value, sub, icon, accent }: { label: string; value: string; sub: string; icon: ReactNode; accent: string }) {
  return <div className="metric-card"><div className={`metric-icon ${accent}`}>{icon}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-sub">{sub}</span></div>;
}

function SubjectsPage({ subjects, chapters, selected, onSelect, onAdd, onUpdate, onRefresh }: { subjects: Subject[]; chapters: Chapter[]; selected: string; onSelect: (value: string) => void; onAdd: (input: { title: string; code: string; sourceReference: string; subjectId: string }) => Promise<void>; onUpdate: (chapterId: string, changes: { title?: string; status?: string }) => Promise<void>; onRefresh: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [chapterError, setChapterError] = useState('');
  const selectedSubject = selected === 'all' ? null : subjects.find((subject) => subject.id === selected) ?? null;
  const grouped = selected === 'all' ? subjects : subjects.filter((subject) => subject.id === selected);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setFormError('');
    try {
      await onAdd({ title: String(form.get('title') ?? ''), code: String(form.get('code') ?? ''), sourceReference: String(form.get('sourceReference') ?? ''), subjectId: String(form.get('subjectId') ?? '') });
      setDialogOpen(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Chapter could not be saved.'); }
    finally { setSaving(false); }
  }
  return <div className="page-content subjects-page"><div className="page-heading"><div><div className="eyebrow muted">SYLLABUS & STRUCTURE</div><h1>Subjects<span className="heading-period">.</span></h1><p>Manage your subjects and add chapters with their source references.</p></div><button className="button button-primary" onClick={() => setDialogOpen(true)}><Plus size={16}/>Add chapter</button></div>
    <div className="syllabus-status"><div className="syllabus-status-icon"><CircleHelp size={18}/></div><div><strong>May 2028 syllabus version · pending verification</strong><span>The six subject records are available. Chapter structure is intentionally editable until official May 2028 mappings are confirmed.</span></div><span className="status-chip">DRAFT</span></div>
    <div className="subject-browser"><aside className="subject-list"><span className="list-label">SUBJECTS <span>{subjects.length}</span></span>{subjects.map((subject, index) => <button className={`subject-list-item ${selected === subject.id ? 'chosen' : ''}`} key={subject.id} onClick={() => onSelect(subject.id)}><span className={`list-monogram tone-${index + 1}`}>{subject.code.slice(0, 2)}</span><span><strong>{subject.code}</strong><small>{subject.name}</small></span><ChevronDown className="list-chevron" size={14}/></button>)}</aside>
      <section className="chapter-browser"><div className="chapter-head"><div><span className="panel-kicker">{selectedSubject ? selectedSubject.code : 'ALL SUBJECTS'}</span><h2>{selectedSubject?.name ?? 'Chapter structure'}</h2><p>{selectedSubject ? `${chapters.length} chapters entered for this subject.` : 'Browse the entered chapter records across all six subjects.'}</p></div><button className="icon-button" aria-label="Refresh chapters" onClick={onRefresh}><RefreshCw size={16}/></button></div>
        {grouped.map((subject, index) => {
          const subjectChapters = chapters.filter((chapter) => chapter.subject_id === subject.id);
          return <div className="chapter-subject-group" key={subject.id}><div className="chapter-group-title"><span className={`list-monogram small tone-${index + 1}`}>{subject.code.slice(0, 2)}</span><div><strong>{subject.code}</strong><span>{subject.name}</span></div><span className="chapter-total">{subjectChapters.length} CHAPTERS</span></div>{subjectChapters.length ? subjectChapters.map((chapter, chapterIndex) => <div className="chapter-row" key={chapter.id}><span className="chapter-number">{chapter.code || String(chapterIndex + 1).padStart(2, '0')}</span><div className="chapter-row-content">{editingId === chapter.id ? <form className="chapter-edit" onSubmit={(event) => { event.preventDefault(); setSaving(true); void onUpdate(chapter.id, { title: editTitle }).then(() => setEditingId('')).catch((error: unknown) => setChapterError(error instanceof Error ? error.message : 'Chapter could not be updated.')).finally(() => setSaving(false)); }}><input aria-label="Chapter title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={200} required/><button className="icon-button" aria-label="Save chapter title" disabled={saving}><Check size={15}/></button><button type="button" className="icon-button" aria-label="Cancel title edit" onClick={() => setEditingId('')}><X size={15}/></button></form> : <><strong>{chapter.title}</strong><span>{chapter.source_reference || 'Source reference not recorded'}</span></>}<select aria-label={`Status for ${chapter.title}`} className="chapter-status-select" value={chapter.status} onChange={(event) => { void onUpdate(chapter.id, { status: event.target.value }).catch((error: unknown) => setChapterError(error instanceof Error ? error.message : 'Status could not be saved.')); }}><option value="not_started">Not started</option><option value="learning">Learning</option><option value="notes_in_progress">Notes in progress</option><option value="first_revision">First revision</option><option value="practised">Practised</option><option value="exam_ready">Exam ready</option><option value="needs_improvement">Needs improvement</option></select></div>{editingId !== chapter.id && <button className="icon-button chapter-edit-button" aria-label={`Edit ${chapter.title}`} title="Edit chapter title" onClick={() => { setEditingId(chapter.id); setEditTitle(chapter.title); }}><FileText size={14}/></button>}</div>) : <div className="empty-chapters"><BookOpen size={18}/><span>No chapter mapping entered yet.</span></div>}</div>;
        })}
        {chapterError && <div className="form-error" role="alert">{chapterError}<button className="dismiss-error" onClick={() => setChapterError('')} aria-label="Dismiss error"><X size={13}/></button></div>}
        {!subjects.length && <div className="empty-chapters"><span>No subjects are available. Apply the D1 migrations and refresh.</span></div>}
      </section>
    </div>
    {dialogOpen && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="chapter-dialog-title"><div className="modal-head"><div><span className="panel-kicker">SYLLABUS EDITOR</span><h2 id="chapter-dialog-title">Add a chapter</h2></div><button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Close dialog"><X size={18}/></button></div><p className="modal-intro">Add verified syllabus information or your own study structure. Keep a source reference when you have one.</p><form onSubmit={(event) => void submit(event)}><label className="field-label" htmlFor="chapter-subject">Subject</label><select id="chapter-subject" name="subjectId" defaultValue={selected === 'all' ? subjects[0]?.id ?? '' : selected} required>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select><label className="field-label" htmlFor="chapter-title">Chapter title</label><input id="chapter-title" name="title" required maxLength={200} placeholder="Use the official chapter title"/><div className="form-row"><div><label className="field-label" htmlFor="chapter-code">Chapter number (optional)</label><input id="chapter-code" name="code" maxLength={40} placeholder="e.g. 01"/></div></div><label className="field-label" htmlFor="chapter-source">Source reference (optional)</label><input id="chapter-source" name="sourceReference" maxLength={500} placeholder="ICAI PDF title, page, or URL"/>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDialogOpen(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save chapter'}<ArrowRight size={15}/></button></div></form></section></div>}
  </div>;
}

export default App;
