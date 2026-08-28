export function getTransientEffectAlpha(remainingSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, remainingSeconds / durationSeconds));
}
