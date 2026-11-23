export const YOUTUBE_SUBJECTS = [
  { id: 'subject-fr', code: 'FR', name: 'Financial Reporting' },
  { id: 'subject-afm', code: 'AFM', name: 'Advanced Financial Management' },
  { id: 'subject-audit', code: 'AUDIT', name: 'Advanced Auditing' },
  { id: 'subject-dt', code: 'DT', name: 'Direct Tax Laws' },
  { id: 'subject-idt', code: 'IDT', name: 'Indirect Tax Laws' },
  { id: 'subject-ibs', code: 'IBS', name: 'Integrated Business Solutions' },
] as const;

export const YOUTUBE_LECTURE_CATEGORIES = [
  { key: 'detailed', label: 'Detailed lectures', queries: ['full detailed lectures', 'regular batch full classes'] },
  { key: 'full_course', label: 'Full course playlists', queries: ['complete course playlist', 'full course playlist classes'] },
  { key: 'chapter_wise', label: 'Chapter-wise classes', queries: ['chapter wise classes', 'chapter lectures'] },
  { key: 'marathon', label: 'Marathon lectures', queries: ['marathon lecture', 'full syllabus marathon'] },
  { key: 'revision', label: 'Revision lectures', queries: ['revision lecture', 'quick revision class'] },
  { key: 'fast_track', label: 'Fast-track classes', queries: ['fast track classes', 'fastrack lecture'] },
  { key: 'mcq', label: 'MCQ classes', queries: ['MCQ class questions', 'multiple choice questions class'] },
  { key: 'case_study', label: 'Case-study discussions', queries: ['case study discussion', 'case study questions'] },
  { key: 'exam_prep', label: 'Exam preparation classes', queries: ['exam preparation strategy', 'question paper preparation class'] },
] as const;

export interface YouTubeQuotaReservation {
  (method: 'search' | 'standard'): Promise<void>;
}

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason?: string;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export async function youtubeGet<T>(key: string, method: string, params: Record<string, string>, reserve: YouTubeQuotaReservation): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserve(method === 'search' ? 'search' : 'standard');
    const url = new URL(`https://www.googleapis.com/youtube/v3/${method}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set('key', key);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const payload = await response.json() as { error?: { message?: string; errors?: { reason?: string }[] } };
      if (response.ok) return payload as T;
      const reason = payload.error?.errors?.[0]?.reason;
      const error = new YouTubeApiError(payload.error?.message || `YouTube API returned ${response.status}.`, response.status, reason);
      if (response.status >= 500 || response.status === 429) {
        lastError = error;
        if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); continue; }
      }
      throw error;
    } catch (error) {
      if (error instanceof YouTubeApiError) throw error;
      lastError = error;
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); continue; }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('YouTube API request failed.');
}

export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0);
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'from', 'ca', 'final', 'lecture', 'class'].includes(word));
}

export function classifyYoutubeVideo(input: { title: string; description: string; subjectName: string; categoryHint: string; chapterTitles: string[]; topicTitles?: string[] }) {
  const text = `${input.title} ${input.description}`.toLowerCase();
  const subjectTerms = words(input.subjectName);
  const subjectHits = subjectTerms.filter((word) => text.includes(word)).length;
  const subjectConfidence = subjectHits === subjectTerms.length ? 0.97 : subjectHits > 0 ? 0.78 : 0.58;
  const rules: [string, RegExp, number][] = [
    ['marathon', /\bmarathon\b|one[ -]?shot|full syllabus/i, 0.96],
    ['fast_track', /fast[ -]?track|fastrack|crash course/i, 0.95],
    ['revision', /revision|revise|quick recap|rapid recap/i, 0.94],
    ['mcq', /\bmcq\b|multiple choice/i, 0.93],
    ['case_study', /case[ -]?stud(y|ies)|caselet/i, 0.93],
    ['detailed', /detailed|regular batch|full lecture|in[ -]?depth/i, 0.90],
  ];
  const found = rules.find(([, pattern]) => pattern.test(text));
  const lectureType = found?.[0] ?? input.categoryHint;
  const lectureConfidence = found?.[2] ?? 0.62;
  let chapterTitle: string | null = null;
  let chapterConfidence = 0;
  for (const candidate of input.chapterTitles) {
    const tokens = words(candidate);
    if (!tokens.length) continue;
    const hits = tokens.filter((word) => text.includes(word)).length;
    const score = hits / tokens.length;
    if (score > chapterConfidence) { chapterConfidence = score; chapterTitle = candidate; }
  }
  if (chapterConfidence < 0.66) { chapterConfidence = 0; chapterTitle = null; }
  let topicTitle: string | null = null;
  let topicConfidence = 0;
  for (const candidate of input.topicTitles ?? []) {
    const tokens = words(candidate);
    if (!tokens.length) continue;
    const score = tokens.filter((word) => text.includes(word)).length / tokens.length;
    if (score > topicConfidence) { topicConfidence = score; topicTitle = candidate; }
  }
  if (topicConfidence < 0.66) { topicConfidence = 0; topicTitle = null; }
  const attemptMatch = text.match(/(?:may|sep(?:tember)?|nov(?:ember)?|jan(?:uary)?)\s*['’]?(20\d{2})/i);
  const attemptRelevance = attemptMatch ? (attemptMatch[1] === '2028' && /may\s*['’]?2028/i.test(text) ? 'mentions_may_2028_syllabus_unverified' : `mentions_${attemptMatch[0].replace(/\s+/g, '_').toLowerCase()}`) : 'unverified';
  return { subjectConfidence, lectureType, lectureConfidence, chapterTitle, chapterConfidence, topicTitle, topicConfidence, attemptRelevance };
}

export function makeSubjectSearchTasks(subjectId: string, subjectName: string, facultyNames: string[]) {
  const names = [...new Set(facultyNames.map((name) => name.trim()).filter(Boolean))];
  const preferred = names[0];
  const alternate = names[1];
  return YOUTUBE_LECTURE_CATEGORIES.flatMap((category) => {
    const queries = [
      `CA Final ${subjectName} ${preferred ? `${preferred} ` : ''}${category.queries[0]}`,
      ...(alternate ? [`CA Final ${subjectName} ${alternate} ${category.queries[1]}`] : []),
      `CA Final ${subjectName} ${category.queries[1]}`,
    ];
    return queries.map((query) => ({ subjectId, lectureType: category.key, query: query.slice(0, 450) }));
  });
}
