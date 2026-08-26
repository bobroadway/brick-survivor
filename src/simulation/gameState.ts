export interface GameState {
  readonly status: string;
}

export function createInitialGameState(): GameState {
  return { status: 'Brick Survivor initialized successfully' };
}
