import type { BrickState } from './brickField';
import { GAME_CONFIG } from './config';

export function getBrickDangerDepthProgress(brick: Pick<BrickState, 'y' | 'height'>): number {
  const brickBottom = brick.y + brick.height;
  const dangerRange = GAME_CONFIG.paddle.y - GAME_CONFIG.bricks.dangerLineY;
  if (dangerRange <= 0) return brickBottom >= GAME_CONFIG.bricks.dangerLineY ? 1 : 0;
  return Math.max(0, Math.min(1, (brickBottom - GAME_CONFIG.bricks.dangerLineY) / dangerRange));
}

export function isDangerBrick(brick: Pick<BrickState, 'y' | 'height'>): boolean {
  return brick.y + brick.height >= GAME_CONFIG.bricks.dangerLineY;
}

export function getMaximumDangerDepth(bricks: readonly BrickState[]): number {
  let maximum = 0;
  for (const brick of bricks) maximum = Math.max(maximum, getBrickDangerDepthProgress(brick));
  return maximum;
}

export function getDangerVignetteTarget(bricks: readonly BrickState[]): number {
  if (!bricks.some(isDangerBrick)) return 0;
  const minimum = GAME_CONFIG.rendering.dangerVignetteMinimumIntensity;
  return minimum + (1 - minimum) * getMaximumDangerDepth(bricks);
}

export function smoothDangerIntensity(current: number, target: number, deltaSeconds: number): number {
  const duration = GAME_CONFIG.rendering.dangerVignetteSmoothingSeconds;
  if (duration <= 0) return target;
  const blend = 1 - Math.exp(-Math.max(0, deltaSeconds) / duration);
  return current + (target - current) * blend;
}
