import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Link2, Plus, RefreshCw } from 'lucide-react';
import { api, type Subject } from './lib/api';

interface Source { id: string; name: string; base_url: string; terms_url: string | null; robots_status: string; policy_status: string; collection_mode: string; access_notes: string; }
interface Resource { id: string; canonical_url: string; title: string; resource_type: string; subject_code: string | null; review_status: string | null; source_name: string; }

export function ResourceCollector({ subjects, chapters }: { subjects: Subject[]; chapters: { id: string; subject_id: string; title: string }[] }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [chapterId, setChapterId] = useState('');

  async function refresh() {
    const [sourceData, resourceData] = await Promise.all([
      api<{ sources: Source[] }>('/api/resource-sources'),
      api<{ resources: Resource[] }>('/api/resources'),
    ]);
    setSources(sourceData.sources);
    setResources(resourceData.resources);
  }
  useEffect(() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load resources.')); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(''); setSaved('');
    try {
      const result = await api<{ duplicate: boolean }>('/api/resources', { method: 'POST', body: JSON.stringify({
        url: form.get('url'), title: form.get('title'), resourceType: form.get('resourceType'),
        provider: form.get('provider'), attempt: form.get('attempt'), scheme: form.get('scheme'),
        language: form.get('language'), subjectId: subjectId || null, chapterId: chapterId || null, sourceName: form.get('sourceName'), sourceUrl: form.get('sourceUrl'),
      }) });
      setSaved(result.duplicate ? 'This link was already in your catalogue. Its source reference was added.' : 'Resource saved to your catalogue for review.');
      event.currentTarget.reset(); setSubjectId(''); setChapterId(''); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Resource could not be saved.'); }
    finally { setSaving(false); }
  }

  return <div className="page-content resource-page">
    <div className="page-heading"><div><div className="eyebrow muted">DISCOVER · REVIEW · ORGANISE</div><h1>Resource collector<span className="heading-period">.</span></h1><p>Save public links and source details without copying protected files.</p></div><button className="icon-button" aria-label="Refresh resources" onClick={() => void refresh()}><RefreshCw size={16}/></button></div>
    <div className="resource-policy-note"><strong>Collection mode: link import</strong><span>Automatic discovery remains disabled until each site's access rules are confirmed. CA Study Partner's terms prohibit unauthorized automated extraction. Imported subject matches stay pending review.</span></div>
    <section className="resource-source-grid" aria-label="Investigated sources">{sources.map((source) => <article className="resource-source-card" key={source.id}><div className="resource-source-top"><strong>{source.name}</strong><span className={`source-policy source-${source.policy_status}`}>{source.policy_status.replaceAll('_', ' ')}</span></div><p>{source.access_notes}</p><div className="resource-source-foot"><span>robots: {source.robots_status}</span><a href={source.base_url} target="_blank" rel="noreferrer">Open source <ExternalLink size={13}/></a></div></article>)}</section>
    <section className="resource-import-panel"><div className="resource-panel-heading"><div><span className="panel-kicker">USER-AUTHORISED IMPORT</span><h2>Add a resource link</h2></div><Link2 size={19}/></div>
      <form onSubmit={(event) => void submit(event)} className="resource-import-form">
        <label>Resource title<input name="title" required maxLength={240} placeholder="Title as shown by the source"/></label>
        <label>Resource URL<input name="url" type="url" required placeholder="https://…"/></label>
        <div className="form-row"><label>Type<select name="resourceType" defaultValue="class"><option value="class">Class / lecture</option><option value="study_material">Study material</option><option value="question_paper">Question paper</option><option value="suggested_answer">Suggested answer</option><option value="rtp">RTP</option><option value="mtp">MTP</option><option value="mcq">MCQ / case study</option><option value="practice">Practice resource</option><option value="other">Other</option></select></label>
          <label>Subject<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setChapterId(''); }}><option value="">Unmapped</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select></label>
          <label>Chapter (optional)<select value={chapterId} onChange={(event) => setChapterId(event.target.value)}><option value="">Not mapped</option>{chapters.filter((chapter) => subjectId && chapter.subject_id === subjectId).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label></div>
        <div className="form-row"><label>Source name<input name="sourceName" maxLength={100} placeholder="e.g. ICAI / YouTube"/></label><label>Source page<input name="sourceUrl" type="url" placeholder="Optional page where you found it"/></label></div>
        <div className="form-row"><label>Attempt<input name="attempt" maxLength={40} placeholder="e.g. May 2028"/></label><label>Scheme<input name="scheme" maxLength={80} placeholder="If stated by source"/></label><label>Provider / faculty<input name="provider" maxLength={120}/></label><label>Language<input name="language" maxLength={60}/></label></div>
        {error && <div className="form-error" role="alert">{error}</div>}{saved && <div className="resource-saved" role="status">{saved}</div>}
        <button className="button button-primary" disabled={saving}><Plus size={15}/>{saving ? 'Saving…' : 'Save link'}</button>
      </form>
    </section>
    <section className="resource-catalogue"><div className="resource-panel-heading"><div><span className="panel-kicker">SAVED IN D1</span><h2>Catalogue <span className="nav-count">{resources.length}</span></h2></div></div>
      {resources.length ? resources.map((resource) => <article className="resource-row" key={resource.id}><div className="resource-icon"><Link2 size={16}/></div><div className="resource-row-copy"><strong>{resource.title}</strong><span>{resource.resource_type.replaceAll('_', ' ')} · {resource.subject_code ?? 'Unmapped'} · {resource.review_status === 'pending' ? 'Mapping pending review' : 'No mapping'} · via {resource.source_name || 'manual import'}</span></div><a href={resource.canonical_url} target="_blank" rel="noreferrer" aria-label={`Open ${resource.title}`}><ExternalLink size={16}/></a></article>) : <div className="empty-chapters">No links saved yet. Add a public link above to start your catalogue.</div>}
    </section>
  </div>;
}
