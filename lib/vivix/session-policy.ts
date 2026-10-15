// A demo session lasts at most ten minutes, including startup time.
export const SESSION_DURATION_SECONDS = 600;
export function remainingTime(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
