import { useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import { api } from './lib/api';

interface Preference { subject_id: string; subject_code: string; subject_name: string; faculty_name: string; search_aliases: string; preferred_channel_id: string | null; channel_title: string | null; identity_status: string | null; }
interface Channel { channel_id: string; channel_title: string; description: string; custom_url: string | null; identity_status: string; verification_evidence: string; source: string; matched_subject_id: string | null; preferred_faculty_name: string | null; }

export function SettingsPage() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { faculty_name: string; search_aliases: string; preferred_channel_id: string }>>({});
  const [channelId, setChannelId] = useState('');
  const [channelSubjectId, setChannelSubjectId] = useState('subject-idt');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [prefData, channelData] = await Promise.all([
      api<{ preferences: Preference[] }>('/api/settings/faculty'),
      api<{ channels: Channel[] }>('/api/youtube/channels'),
    ]);
    setPreferences(prefData.preferences);
    setChannels(channelData.channels);
    setDrafts(Object.fromEntries(prefData.preferences.map((p) => [p.subject_id, {
      faculty_name: p.faculty_name, search_aliases: p.search_aliases, preferred_channel_id: p.preferred_channel_id ?? '',
    }])));
  }

  useEffect(() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load settings.')); }, []);

  async function save(preference: Preference) {
    const draft = drafts[preference.subject_id];
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/settings/faculty', { method: 'PATCH', body: JSON.stringify({
        subjectId: preference.subject_id, facultyName: draft.faculty_name, searchAliases: draft.search_aliases,
        preferredChannelId: draft.preferred_channel_id || null,
      }) });
      setMessage(`${preference.subject_code} preference saved. Discovery will prioritize this name and its aliases.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'The faculty preference could not be saved.'); }
    finally { setBusy(false); }
  }

  async function addAndCheck() {
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/youtube/channels', { method: 'POST', body: JSON.stringify({ channelId: channelId.trim(), subjectId: channelSubjectId }) });
      const result = await api<{ channel_title: string }>('/api/youtube/channels/' + encodeURIComponent(channelId.trim()) + '/verify', { method: 'POST' });
      setMessage(`YouTube returned “${result.channel_title}”. Review its profile and official links below before confirming identity.`);
      setChannelId(''); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Channel lookup failed. Configure the YouTube API secret first.'); }
    finally { setBusy(false); }
  }

  async function reviewChannel(channel: Channel, status: 'verified' | 'rejected') {
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/api/youtube/channels/${encodeURIComponent(channel.channel_id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(`${channel.channel_title} marked ${status}.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Channel review could not be saved.'); }
    finally { setBusy(false); }
  }

  return <div className="page-content settings-page">
    <div className="page-heading"><div><div className="eyebrow muted">PERSONALIZE YOUR DISCOVERY</div><h1>Settings<span className="heading-period">.</span></h1><p>Preferred faculty stay editable. A name match alone never verifies a YouTube channel.</p></div><button className="icon-button" aria-label="Refresh settings" onClick={() => void refresh()}><RefreshCw size={16}/></button></div>
    <div className="resource-policy-note"><strong>Channel identity review</strong><span>Check the YouTube channel profile, its CA Final subject content, and links to the faculty’s official teaching site or social profile. Only channels you mark verified can become a preferred channel. Similar names remain separate candidates.</span></div>
    {preferences.map((preference) => {
      const draft = drafts[preference.subject_id] ?? { faculty_name: preference.faculty_name, search_aliases: preference.search_aliases, preferred_channel_id: '' };
      const subjectChannels = channels.filter((channel) => channel.matched_subject_id === preference.subject_id || channel.channel_id === preference.preferred_channel_id);
      return <section className="resource-import-panel faculty-pref-panel" key={preference.subject_id}>
        <div className="resource-panel-heading"><div><span className="panel-kicker">{preference.subject_code} · {preference.subject_name}</span><h2>Preferred faculty</h2></div><UserRound size={18}/></div>
        <div className="form-row"><label>Preferred name<input value={draft.faculty_name} maxLength={120} onChange={(event) => setDrafts((all) => ({ ...all, [preference.subject_id]: { ...draft, faculty_name: event.target.value } }))}/></label>
          <label>Search name variants<input value={draft.search_aliases} maxLength={300} onChange={(event) => setDrafts((all) => ({ ...all, [preference.subject_id]: { ...draft, search_aliases: event.target.value } }))}/></label></div>
        <label className="field-label">Verified preferred channel<select value={draft.preferred_channel_id} onChange={(event) => setDrafts((all) => ({ ...all, [preference.subject_id]: { ...draft, preferred_channel_id: event.target.value } }))}><option value="">No channel verified yet</option>{subjectChannels.filter((channel) => channel.identity_status === 'verified').map((channel) => <option key={channel.channel_id} value={channel.channel_id}>{channel.channel_title} · {channel.channel_id}</option>)}</select></label>
        <button className="button button-primary" disabled={busy} onClick={() => void save(preference)}><Check size={15}/>Save {preference.subject_code} preference</button>
      </section>;
    })}
    <section className="resource-import-panel"><div className="resource-panel-heading"><div><span className="panel-kicker">CHANNEL IDENTITY CHECK</span><h2>Add a public faculty channel</h2></div><ShieldAlert size={18}/></div>
      <p className="settings-explainer">Enter the channel ID from a public YouTube channel URL. The app retrieves its public profile through YouTube Data API v3 and leaves it pending until you review it.</p>
      <div className="form-row"><label>Subject<select value={channelSubjectId} onChange={(event) => setChannelSubjectId(event.target.value)}>{preferences.map((p) => <option value={p.subject_id} key={p.subject_id}>{p.subject_code} · {p.subject_name}</option>)}</select></label><label>YouTube channel ID<input value={channelId} onChange={(event) => setChannelId(event.target.value)} placeholder="UC…" maxLength={24}/></label></div>
      <button className="button button-primary" disabled={busy || !channelId.trim()} onClick={() => void addAndCheck()}>{busy ? 'Checking…' : 'Fetch public channel profile'}</button>
    </section>
    <section className="resource-catalogue"><div className="resource-panel-heading"><div><span className="panel-kicker">CHANNEL REVIEW QUEUE</span><h2>Candidate channels</h2></div><span className="nav-count">{channels.length}</span></div>
      {channels.length ? channels.map((channel) => <article className="faculty-channel-card" key={channel.channel_id}><div className="resource-source-top"><strong>{channel.channel_title}</strong><span className={`source-policy source-${channel.identity_status}`}>{channel.identity_status.replaceAll('_',' ')}</span></div><a href={`https://www.youtube.com/channel/${encodeURIComponent(channel.channel_id)}`} target="_blank" rel="noreferrer">Open YouTube channel ↗</a><p>{channel.description || 'No profile description is available yet.'}</p><small>Channel ID: {channel.channel_id}{channel.custom_url ? ` · ${channel.custom_url}` : ''}{channel.preferred_faculty_name ? ` · candidate for ${channel.preferred_faculty_name}` : ''}</small>{channel.identity_status === 'pending_review' && <div className="channel-review-actions"><button className="button button-primary" disabled={busy} onClick={() => void reviewChannel(channel,'verified')}>I verified this exact channel</button><button className="button button-quiet" disabled={busy} onClick={() => void reviewChannel(channel,'rejected')}>Reject candidate</button></div>}</article>) : <div className="empty-chapters">No faculty channels have been found or added yet.</div>}
    </section>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="resource-saved" role="status">{message}</div>}
  </div>;
}
