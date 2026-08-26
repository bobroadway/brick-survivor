import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';

export interface RenderMetrics {
  cssWidth: number;
  cssHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  devicePixelRatio: number;
  logicalToPhysicalScale: number;
}

export class RenderQualityManager {
  private readonly texts = new Set<Phaser.GameObjects.Text>();
  private metrics?: RenderMetrics;
  private scheduled = false;
  private pixelRatioQuery?: MediaQueryList;

  private readonly scheduleRefresh = (): void => {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.refresh();
    });
  };

  private readonly handlePixelRatioChange = (): void => {
    this.watchPixelRatio();
    this.scheduleRefresh();
  };

  constructor(private readonly scene: Phaser.Scene) {
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.scheduleRefresh);
    window.addEventListener('resize', this.scheduleRefresh);
    window.visualViewport?.addEventListener('resize', this.scheduleRefresh);
    this.watchPixelRatio();
    this.scheduleRefresh();
  }

  addText(
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    const textObject = this.scene.add.text(x, y, text, style);
    this.texts.add(textObject);
    if (this.metrics) textObject.setResolution(this.metrics.logicalToPhysicalScale);
    textObject.once(Phaser.GameObjects.Events.DESTROY, () => this.texts.delete(textObject));
    return textObject;
  }

  getMetrics(): RenderMetrics | undefined {
    return this.metrics;
  }

  refresh(): void {
    const canvas = this.scene.game.canvas;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const cssScale = Math.min(bounds.width / GAME_CONFIG.width, bounds.height / GAME_CONFIG.height);
    const logicalToPhysicalScale = cssScale * devicePixelRatio * GAME_CONFIG.rendering.renderScale;
    const physicalWidth = Math.max(1, Math.round(GAME_CONFIG.width * logicalToPhysicalScale));
    const physicalHeight = Math.max(1, Math.round(GAME_CONFIG.height * logicalToPhysicalScale));

    if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
      this.scene.game.renderer.resize(physicalWidth, physicalHeight);
    }

    // FIT still owns the CSS dimensions. Its base/input coordinates are promoted
    // to physical pixels, while gameSize remains the fixed logical 1280x720 world.
    this.scene.scale.baseSize.setSize(physicalWidth, physicalHeight);
    this.scene.scale.updateBounds();
    this.scene.scale.displayScale.set(physicalWidth / bounds.width, physicalHeight / bounds.height);

    const camera = this.scene.cameras.main;
    camera.setViewport(0, 0, physicalWidth, physicalHeight);
    camera.setZoom(logicalToPhysicalScale);
    camera.centerOn(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2);

    for (const text of this.texts) text.setResolution(logicalToPhysicalScale);

    this.metrics = {
      cssWidth: bounds.width,
      cssHeight: bounds.height,
      physicalWidth,
      physicalHeight,
      devicePixelRatio,
      logicalToPhysicalScale,
    };
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.scheduleRefresh);
    window.removeEventListener('resize', this.scheduleRefresh);
    window.visualViewport?.removeEventListener('resize', this.scheduleRefresh);
    this.pixelRatioQuery?.removeEventListener('change', this.handlePixelRatioChange);
    this.texts.clear();
  }

  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.handlePixelRatioChange);
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.handlePixelRatioChange);
  }
}
