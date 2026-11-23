export interface Subject {
  id: string;
  code: string;
  name: string;
  position: number;
  chapter_count: number;
}

export interface Chapter {
  id: string;
  subject_id: string;
  subject_code: string;
  title: string;
  code: string | null;
  position: number;
  status: string;
  source_reference: string | null;
}

export interface StudySession {
  id: string;
  activity: string;
  started_at: string;
  duration_seconds: number;
}

export interface DashboardData {
  todaySeconds: number;
  weekSeconds: number;
  recent: StudySession[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
