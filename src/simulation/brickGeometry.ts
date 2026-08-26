import { GAME_CONFIG } from './config';

export interface VerticalBrickBounds {
  y: number;
  height: number;
}

/** Brick Y is the top edge throughout simulation, collision, and rendering. */
export function getBrickTop(brick: VerticalBrickBounds): number {
  return brick.y;
}

export function getBrickBottom(brick: VerticalBrickBounds): number {
  return brick.y + brick.height;
}

export function getBrickVerticalEdgeGap(
  upperBrick: VerticalBrickBounds,
  lowerBrick: VerticalBrickBounds,
): number {
  return getBrickTop(lowerBrick) - getBrickBottom(upperBrick);
}

export function getMinimumBrickVerticalEdgeGap(): number {
  return GAME_CONFIG.bricks.verticalEdgeGap;
}

export function getBrickRowPitch(): number {
  return GAME_CONFIG.bricks.brickHeight + getMinimumBrickVerticalEdgeGap();
}

export function getMinimumUpperBrickY(
  lowerBrick: VerticalBrickBounds,
  upperBrickHeight: number,
): number {
  return getBrickTop(lowerBrick) - getMinimumBrickVerticalEdgeGap() - upperBrickHeight;
}
