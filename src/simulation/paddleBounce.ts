import { GAME_CONFIG } from './config';
import { getPaddleSizeSpec } from './gameplayRules';

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
  const spec = getPaddleSizeSpec(clampedLevel);
  const currentHalfWidth = baseHalfWidth * spec.widthMultiplier;
  const offset = Math.max(0, Math.min(currentHalfWidth, Math.abs(absoluteImpactOffset)));

  if (offset <= baseHalfWidth || clampedLevel === 0) {
    return spec.centerElevationDegrees
      + (spec.baseEdgeElevationDegrees - spec.centerElevationDegrees) * (offset / baseHalfWidth);
  }

  const outerElevation = spec.extendedWingMinimumElevationDegrees;
  const extensionWidth = currentHalfWidth - baseHalfWidth;
  const progress = (offset - baseHalfWidth) / extensionWidth;
  const matchingBoundarySlope = (spec.baseEdgeElevationDegrees - spec.centerElevationDegrees)
    * (extensionWidth / baseHalfWidth);
  return monotoneHermite(spec.baseEdgeElevationDegrees, outerElevation, matchingBoundarySlope, progress);
}
