export enum GamePhase {
  Running = 'RUNNING',
  Suspended = 'SUSPENDED',
}

export enum SuspensionReason {
  ManualPause = 'MANUAL_PAUSE',
  // Future reasons such as LEVEL_UP_SELECTION and GAME_OVER belong here.
}

export interface SessionState {
  phase: GamePhase;
  suspensionReason: SuspensionReason | null;
}

export function createSessionState(): SessionState {
  return { phase: GamePhase.Running, suspensionReason: null };
}

export function isSimulationRunning(session: SessionState): boolean {
  return session.phase === GamePhase.Running;
}

export function pauseManually(session: SessionState): void {
  session.phase = GamePhase.Suspended;
  session.suspensionReason = SuspensionReason.ManualPause;
}

export function toggleManualPause(session: SessionState): void {
  if (session.suspensionReason === SuspensionReason.ManualPause) {
    session.phase = GamePhase.Running;
    session.suspensionReason = null;
  } else if (session.phase === GamePhase.Running) {
    pauseManually(session);
  }
}
