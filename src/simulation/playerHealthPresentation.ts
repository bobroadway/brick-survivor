import { GAME_CONFIG } from './config';

export const HEALTH_COLOR_GREEN = GAME_CONFIG.rendering.brickSpeedClassColors.SLOW;
export const HEALTH_COLOR_YELLOW = GAME_CONFIG.rendering.healthYellowColor;
export const HEALTH_COLOR_RED = GAME_CONFIG.rendering.brickSpeedClassColors.RUSH;

export function getHealthFraction(currentHp: number, maximumHp: number): number {
  if (!Number.isFinite(currentHp) || !Number.isFinite(maximumHp) || maximumHp <= 0) return 0;
  return Math.max(0, Math.min(1, currentHp / maximumHp));
}

function lerpChannel(from: number, to: number, progress: number): number {
  return Math.floor(from + (to - from) * Math.max(0, Math.min(1, progress)) + 0.5 + 1e-9);
}

function rgb(red: number, green: number, blue: number): number {
  return (red << 16) | (green << 8) | blue;
}

function lerpColor(from: number, to: number, progress: number): number {
  return rgb(
    lerpChannel((from >> 16) & 0xff, (to >> 16) & 0xff, progress),
    lerpChannel((from >> 8) & 0xff, (to >> 8) & 0xff, progress),
    lerpChannel(from & 0xff, to & 0xff, progress),
  );
}

/** Returns one solid RGB fill color selected from the current Health percentage. */
export function getHealthColor(currentHp: number, maximumHp: number): number {
  const percentage = getHealthFraction(currentHp, maximumHp);
  if (percentage <= 0.2) return HEALTH_COLOR_RED;
  if (percentage < 0.5) {
    const progress = (percentage - 0.2) / 0.3;
    return lerpColor(HEALTH_COLOR_RED, HEALTH_COLOR_YELLOW, progress);
  }
  if (percentage < 0.8) {
    const progress = (percentage - 0.5) / 0.3;
    return lerpColor(HEALTH_COLOR_YELLOW, HEALTH_COLOR_GREEN, progress);
  }
  return HEALTH_COLOR_GREEN;
}
