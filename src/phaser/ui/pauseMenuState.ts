export type PauseMenuFocus = 'RESUME' | 'WINDOWED' | 'FULLSCREEN' | 'RESTART' | 'QUIT';
export type ConfirmationKind = 'RESTART' | 'QUIT';
export type ConfirmationFocus = 'CONFIRM' | 'CANCEL';

export interface PauseMenuState {
  focus: PauseMenuFocus;
  confirmation: ConfirmationKind | null;
  confirmationFocus: ConfirmationFocus;
}

const ROWS: PauseMenuFocus[][] = [
  ['RESUME'],
  ['WINDOWED', 'FULLSCREEN'],
  ['RESTART'],
  ['QUIT'],
];

export function createPauseMenuState(): PauseMenuState {
  return { focus: 'RESUME', confirmation: null, confirmationFocus: 'CANCEL' };
}

export function resetPauseMenuState(state: PauseMenuState): void {
  state.focus = 'RESUME';
  state.confirmation = null;
  state.confirmationFocus = 'CANCEL';
}

export function movePauseMenuVertical(state: PauseMenuState, direction: -1 | 1): void {
  if (state.confirmation) {
    state.confirmationFocus = state.confirmationFocus === 'CONFIRM' ? 'CANCEL' : 'CONFIRM';
    return;
  }
  const rowIndex = ROWS.findIndex((row) => row.includes(state.focus));
  const nextRow = ROWS[(rowIndex + direction + ROWS.length) % ROWS.length];
  state.focus = nextRow.includes(state.focus) ? state.focus : nextRow[0];
}

export function movePauseMenuHorizontal(state: PauseMenuState, direction: -1 | 1): void {
  if (state.confirmation) {
    state.confirmationFocus = direction < 0 ? 'CONFIRM' : 'CANCEL';
  } else if (state.focus === 'WINDOWED' || state.focus === 'FULLSCREEN') {
    state.focus = state.focus === 'WINDOWED' ? 'FULLSCREEN' : 'WINDOWED';
  }
}
