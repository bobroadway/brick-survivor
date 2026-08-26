import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import type { SimulationInput } from '../../simulation/simulation';

const SHELL_CODES = new Set([
  'Tab', 'Escape', 'Enter', 'NumpadEnter', 'F11',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);
const LEFT_CODES = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_CODES = new Set(['KeyD', 'ArrowRight']);
const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);
type MovementDirection = -1 | 1;

function getMovementDirection(code: string): MovementDirection | null {
  if (LEFT_CODES.has(code)) return -1;
  if (RIGHT_CODES.has(code)) return 1;
  return null;
}

export class GameInput {
  private readonly heldMovementCodes = new Set<string>();
  private readonly heldShiftCodes = new Set<string>();
  private pendingMouseDisplacement = 0;
  private hadPointerLock = false;
  private displayTransitionActive = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat && SHELL_CODES.has(event.code)) this.onShellKeyDown(event.code);
    if (SHIFT_CODES.has(event.code)) this.heldShiftCodes.add(event.code);
    const direction = getMovementDirection(event.code);
    if (this.isRunning() && direction !== null) {
      this.requestPointerLock();
      this.heldMovementCodes.add(event.code);
    }
    if (SHELL_CODES.has(event.code)) event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldMovementCodes.delete(event.code);
    this.heldShiftCodes.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isRunning() || document.pointerLockElement !== this.scene.game.canvas) return;
    const canvasWidth = this.scene.game.canvas.getBoundingClientRect().width;
    if (canvasWidth === 0) return;
    const physicalToLogicalScale = this.scene.scale.gameSize.width / canvasWidth;
    this.pendingMouseDisplacement += event.movementX * physicalToLogicalScale * GAME_CONFIG.input.mouseSensitivity;
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.scene.game.canvas;
    if (locked) this.hadPointerLock = true;
    else if (this.hadPointerLock) {
      this.hadPointerLock = false;
      if (this.isRunning() && !this.displayTransitionActive) this.onUnexpectedInputLoss();
    }
  };

  private readonly handleFocusLoss = (): void => {
    if (this.isRunning() && !this.displayTransitionActive) this.onUnexpectedInputLoss();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.handleFocusLoss();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly isRunning: () => boolean,
    private readonly onShellKeyDown: (code: string) => void,
    private readonly onUnexpectedInputLoss: () => void,
  ) {
    if (!scene.input.keyboard) throw new Error('Keyboard input is unavailable');
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('blur', this.handleFocusLoss);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  enterRunning(): void {
    this.resetMovementInput();
    this.requestPointerLock();
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement !== this.scene.game.canvas) {
      void this.scene.game.canvas.requestPointerLock().catch(() => undefined);
    }
  }

  enterPaused(): void {
    this.resetMovementInput();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  beginDisplayTransition(): void {
    this.displayTransitionActive = true;
    this.resetMovementInput();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endDisplayTransition(): void {
    this.displayTransitionActive = false;
    this.resetMovementInput();
    if (this.isRunning()) this.requestPointerLock();
  }

  readSimulationInput(output: SimulationInput): void {
    let leftHeld = false;
    let rightHeld = false;
    for (const code of this.heldMovementCodes) {
      const direction = getMovementDirection(code);
      if (direction === -1) leftHeld = true;
      else if (direction === 1) rightHeld = true;
    }
    const movementAxis = leftHeld === rightHeld ? 0 : leftHeld ? -1 : 1;
    const mouseDisplacement = movementAxis === 0 ? this.pendingMouseDisplacement : 0;
    this.pendingMouseDisplacement = 0;
    output.movementAxis = movementAxis;
    output.mouseDisplacement = mouseDisplacement;
    output.speedMultiplier = movementAxis === 0
      ? GAME_CONFIG.paddle.speedBoostMultiplier
      : this.heldShiftCodes.size > 0
        ? GAME_CONFIG.paddle.speedBoostMultiplier
        : 1;
  }

  private resetMovementInput(): void {
    this.heldMovementCodes.clear();
    this.heldShiftCodes.clear();
    this.pendingMouseDisplacement = 0;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('blur', this.handleFocusLoss);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.enterPaused();
  }
}
