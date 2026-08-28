import { GAME_CONFIG } from './config';
import type { ProjectileState } from './gameState';

export interface ElectricProjectileVisual {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  length: number;
}

export function createElectricVisualAmplitude(projectileId: number, targetBrickId: string): number {
  let hash = projectileId >>> 0;
  for (let index = 0; index < targetBrickId.length; index += 1) {
    hash = (Math.imul(hash ^ targetBrickId.charCodeAt(index), 16777619)) >>> 0;
  }
  const normalized = (hash & 0xffff) / 0xffff;
  const magnitude = GAME_CONFIG.powers.electricVisualMaximumOffset * (0.45 + normalized * 0.55);
  return (hash & 0x10000) === 0 ? -magnitude : magnitude;
}

export function getElectricProjectileVisual(projectile: ProjectileState): ElectricProjectileVisual {
  const progress = Math.max(0, Math.min(1, projectile.electricFlightProgress ?? 0));
  const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
  const nominalX = speed > 0 ? projectile.velocity.x / speed : 0;
  const nominalY = speed > 0 ? projectile.velocity.y / speed : -1;
  const perpendicularX = -nominalY;
  const perpendicularY = nominalX;
  const amplitude = projectile.electricVisualAmplitude ?? 0;
  const offset = amplitude * Math.sin(Math.PI * progress);
  const initialDistance = Math.max(1, projectile.electricInitialDistance ?? 1);
  const tangentOffset = amplitude * Math.PI * Math.cos(Math.PI * progress) / initialDistance;
  const tangentX = nominalX + perpendicularX * tangentOffset;
  const tangentY = nominalY + perpendicularY * tangentOffset;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const lengthMultiplier = 1
    + (GAME_CONFIG.powers.electricVisualMaximumLengthMultiplier - 1) * progress;
  return {
    x: projectile.x + perpendicularX * offset,
    y: projectile.y + perpendicularY * offset,
    directionX: tangentX / tangentLength,
    directionY: tangentY / tangentLength,
    length: GAME_CONFIG.powers.projectileLength * lengthMultiplier,
  };
}
