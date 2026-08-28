import { GAME_CONFIG } from './config';

const CENTER_ELEVATION_DEGREES = 90;
const BASE_EDGE_ELEVATION_DEGREES = 45;

function monotoneHermite(
  start: number,
  end: number,
  startSlope: number,
  progress: number,
): number {
  const secant = end - start;
  const limitedStartSlope = Math.sign(secant) * Math.min(Math.abs(startSlope), Math.abs(secant) * 3);
  const t2 = progress * progress;
  const t3 = t2 * progress;
  return (2 * t3 - 3 * t2 + 1) * start
    + (t3 - 2 * t2 + progress) * limitedStartSlope
    + (-2 * t3 + 3 * t2) * end;
}

export function getPaddleBounceElevationDegrees(powerLevel: number, absoluteImpactOffset: number): number {
  const baseHalfWidth = GAME_CONFIG.paddle.width / 2;
  const clampedLevel = Math.max(0, Math.min(GAME_CONFIG.powers.maxLevel, Math.floor(powerLevel)));
  const currentHalfWidth = baseHalfWidth * (1 + clampedLevel * 0.2);
  const offset = Math.max(0, Math.min(currentHalfWidth, Math.abs(absoluteImpactOffset)));

  if (offset <= baseHalfWidth || clampedLevel === 0) {
    return CENTER_ELEVATION_DEGREES
      + (BASE_EDGE_ELEVATION_DEGREES - CENTER_ELEVATION_DEGREES) * (offset / baseHalfWidth);
  }

  const outerElevation = GAME_CONFIG.powers.paddleOuterEdgeElevationDegreesByLevel[clampedLevel - 1];
  const extensionWidth = currentHalfWidth - baseHalfWidth;
  const progress = (offset - baseHalfWidth) / extensionWidth;
  const matchingBoundarySlope = (BASE_EDGE_ELEVATION_DEGREES - CENTER_ELEVATION_DEGREES)
    * (extensionWidth / baseHalfWidth);
  return monotoneHermite(BASE_EDGE_ELEVATION_DEGREES, outerElevation, matchingBoundarySlope, progress);
}
