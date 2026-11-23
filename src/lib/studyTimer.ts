export type Activity = 'reading' | 'note_making' | 'practice' | 'revision' | 'mock_test' | 'lecture' | 'other';

export interface TimerState {
  sessionId: string;
  startedAt: string;
  accumulatedSeconds: number;
  runningSince: number | null;
  activity: Activity;
  subjectId: string | null;
}

export function elapsedSeconds(timer: TimerState, now = Date.now()): number {
  const currentRun = timer.runningSince === null ? 0 : Math.max(0, Math.floor((now - timer.runningSince) / 1000));
  return timer.accumulatedSeconds + currentRun;
}

export function durationFor(startedAt: string, endedAt: string): number {
  return Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
}
