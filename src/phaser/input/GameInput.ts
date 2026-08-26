import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import type { SimulationInput } from '../../simulation/simulation';

const PAUSE_CODES = new Set(['Space', 'Escape', 'Enter', 'NumpadEnter']);

export class GameInput {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly aKey: Phaser.Input.Keyboard.Key;
  private readonly dKey: Phaser.Input.Keyboard.Key;
  private mouseTargetX: number;
  private mouseControlActive = false;
  private hadPointerLock = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat && PAUSE_CODES.has(event.code)) this.onTogglePause();
    if (this.isRunning() && ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      this.requestPointerLock();
    }
    if (PAUSE_CODES.has(event.code) || event.code === 'ArrowLeft' || event.code === 'ArrowRight') event.preventDefault();
  };

  private readonly handleWindowPointerDown = (): void => {
    if (this.isRunning()) this.onPointerPause();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isRunning() || document.pointerLockElement !== this.scene.game.canvas) return;
    if (!this.mouseControlActive) {
      this.mouseTargetX = this.getPaddleX();
      this.mouseControlActive = true;
    }
    const canvasWidth = this.scene.game.canvas.getBoundingClientRect().width;
    if (canvasWidth === 0) return;
    const physicalToLogicalScale = this.scene.scale.gameSize.width / canvasWidth;
    this.mouseTargetX += event.movementX * physicalToLogicalScale * GAME_CONFIG.input.mouseSensitivity;
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.scene.game.canvas;
    if (locked) this.hadPointerLock = true;
    else if (this.hadPointerLock) {
      this.hadPointerLock = false;
      if (this.isRunning()) this.onUnexpectedInputLoss();
    }
  };

  private readonly handleFocusLoss = (): void => {
    if (this.isRunning()) this.onUnexpectedInputLoss();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.handleFocusLoss();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getPaddleX: () => number,
    private readonly isRunning: () => boolean,
    private readonly onTogglePause: () => void,
    private readonly onPointerPause: () => void,
    private readonly onUnexpectedInputLoss: () => void,
  ) {
    if (!scene.input.keyboard) throw new Error('Keyboard input is unavailable');
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.aKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.dKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.mouseTargetX = getPaddleX();
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('pointerdown', this.handleWindowPointerDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('blur', this.handleFocusLoss);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  enterRunning(): void {
    this.mouseControlActive = false;
    this.mouseTargetX = this.getPaddleX();
    this.requestPointerLock();
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement !== this.scene.game.canvas) {
      void this.scene.game.canvas.requestPointerLock().catch(() => undefined);
    }
  }

  enterPaused(): void {
    this.mouseControlActive = false;
    this.mouseTargetX = this.getPaddleX();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  readSimulationInput(): SimulationInput {
    const leftHeld = this.cursors.left.isDown || this.aKey.isDown;
    const rightHeld = this.cursors.right.isDown || this.dKey.isDown;
    const movementAxis = leftHeld === rightHeld ? 0 : leftHeld ? -1 : 1;
    if (movementAxis !== 0) {
      this.mouseControlActive = false;
      this.mouseTargetX = this.getPaddleX();
    }
    return {
      movementAxis,
      paddleTargetX: movementAxis === 0 && this.mouseControlActive ? this.mouseTargetX : null,
    };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('pointerdown', this.handleWindowPointerDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('blur', this.handleFocusLoss);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.enterPaused();
  }
}
