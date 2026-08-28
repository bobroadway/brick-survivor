import Phaser from 'phaser';
import type { GameState } from '../../simulation/gameState';
import { getPowerDefinition, getPowerDescription, getPowerLevel, type PowerId } from '../../simulation/powers';
import { RenderQualityManager } from '../rendering/RenderQualityManager';
import {
  isSamePowerChoiceFocus,
  movePowerChoiceFocus,
  type PowerChoiceControl,
  type PowerChoiceDirection,
  type PowerChoiceFocus,
} from './powerChoiceNavigation';

const CARD_WIDTH = 285;
const CARD_CENTER_Y = 315;
const CARD_HEIGHT = 235;
const BUTTON_Y = 462;
const BUTTON_HEIGHT = 42;
const BUTTON_GAP = 8;
const CHOOSE_SHARE = 0.6;
const CARD_XS = [310, 640, 970] as const;
const REROLL_FOCUS: PowerChoiceFocus = { kind: 'reroll' };

interface ChoiceVisual {
  background: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  chooseBackground: Phaser.GameObjects.Rectangle;
  chooseText: Phaser.GameObjects.Text;
  banBackground: Phaser.GameObjects.Rectangle;
  banText: Phaser.GameObjects.Text;
}

export class PowerChoiceOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly choices: ChoiceVisual[] = [];
  private readonly rerollBackground: Phaser.GameObjects.Rectangle;
  private readonly rerollText: Phaser.GameObjects.Text;
  private state?: GameState;
  private focus: PowerChoiceFocus = { kind: 'choose', slot: 0 };
  private interactionEnabled = false;

  constructor(
    scene: Phaser.Scene,
    renderQuality: RenderQualityManager,
    private readonly select: (id: PowerId) => void,
    private readonly reroll: () => void,
    private readonly ban: (id: PowerId) => void,
  ) {
    this.container = scene.add.container(0, 0).setDepth(30).setVisible(false);
    this.container.add(scene.add.rectangle(0, 0, 1280, 720, 0x080a0f, 0.86).setOrigin(0));
    this.title = renderQuality.addText(640, 105, '', {
      color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '44px', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.title);
    for (let slot = 0; slot < CARD_XS.length; slot += 1) {
      const x = CARD_XS[slot];
      const background = scene.add.rectangle(x, CARD_CENTER_Y, CARD_WIDTH, CARD_HEIGHT, 0x273243, 0.98)
        .setStrokeStyle(2, 0x53637a);
      const text = renderQuality.addText(x, CARD_CENTER_Y, '', {
        align: 'center', color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '19px',
        wordWrap: { width: 245 },
      }).setOrigin(0.5);
      const chooseBackground = scene.add.rectangle(x, BUTTON_Y, CARD_WIDTH, BUTTON_HEIGHT, 0x29483a, 0.98)
        .setStrokeStyle(2, 0x5f8f73);
      const chooseText = renderQuality.addText(x, BUTTON_Y, 'CHOOSE', {
        color: '#dcefe3', fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold',
      }).setOrigin(0.5);
      const banBackground = scene.add.rectangle(x, BUTTON_Y, 1, BUTTON_HEIGHT, 0x5a4028, 0.98)
        .setStrokeStyle(2, 0xa97845);
      const banText = renderQuality.addText(x, BUTTON_Y, '', {
        color: '#f3e2cb', fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold',
      }).setOrigin(0.5);
      chooseBackground.on(Phaser.Input.Events.POINTER_OVER, () => this.focusControl({ kind: 'choose', slot }));
      chooseBackground.on(Phaser.Input.Events.POINTER_DOWN, () => this.activateControl({ kind: 'choose', slot }));
      banBackground.on(Phaser.Input.Events.POINTER_OVER, () => this.focusControl({ kind: 'ban', slot }));
      banBackground.on(Phaser.Input.Events.POINTER_DOWN, () => this.activateControl({ kind: 'ban', slot }));
      this.choices.push({ background, text, chooseBackground, chooseText, banBackground, banText });
      this.container.add([background, text, chooseBackground, chooseText, banBackground, banText]);
    }
    this.rerollBackground = scene.add.rectangle(640, 535, 250, 48, 0x273243, 0.98)
      .setStrokeStyle(2, 0x53637a);
    this.rerollText = renderQuality.addText(640, 535, '', {
      color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.rerollBackground.on(Phaser.Input.Events.POINTER_OVER, () => this.focusControl(REROLL_FOCUS));
    this.rerollBackground.on(Phaser.Input.Events.POINTER_DOWN, () => this.activateControl(REROLL_FOCUS));
    this.container.add([this.rerollBackground, this.rerollText]);
  }

  show(state: GameState, interactionEnabled = true, alpha = 1, preferredFocus?: PowerChoiceFocus): void {
    this.state = state;
    this.interactionEnabled = interactionEnabled;
    this.container.setVisible(true).setAlpha(alpha);
    const controls = this.getControls();
    this.focus = preferredFocus && controls.some((control) => isSamePowerChoiceFocus(control.focus, preferredFocus))
      ? preferredFocus
      : controls.find((control) => control.focus.kind === 'choose')?.focus ?? controls[0]?.focus ?? this.focus;
    this.refresh();
  }

  hide(): void {
    this.interactionEnabled = false;
    this.container.setVisible(false);
  }

  setPresentation(alpha: number, interactionEnabled: boolean): void {
    const interactionChanged = this.interactionEnabled !== interactionEnabled;
    this.interactionEnabled = interactionEnabled;
    this.container.setVisible(alpha > 0).setAlpha(Math.max(0, Math.min(1, alpha)));
    if (interactionChanged) this.refresh();
  }

  move(direction: PowerChoiceDirection): void {
    if (!this.state || !this.interactionEnabled) return;
    this.focus = movePowerChoiceFocus(this.focus, direction, this.getControls());
    this.refresh();
  }

  activateFocused(): void { this.activateControl(this.focus); }

  private focusControl(focus: PowerChoiceFocus): void {
    if (!this.interactionEnabled) return;
    this.focus = focus;
    this.refresh();
  }

  private activateControl(focus: PowerChoiceFocus): void {
    if (!this.state || !this.interactionEnabled) return;
    if (focus.kind === 'reroll') {
      if (this.state.powers.rerollsRemaining > 0) this.reroll();
      return;
    }
    const id = this.state.powers.currentChoices[focus.slot];
    if (!id) return;
    if (focus.kind === 'choose') this.select(id);
    else if (this.state.powers.bansRemaining > 0) this.ban(id);
  }

  private getControls(): PowerChoiceControl[] {
    if (!this.state) return [];
    const controls: PowerChoiceControl[] = [];
    const showBans = this.state.powers.bansRemaining > 0;
    for (let slot = 0; slot < this.state.powers.currentChoices.length; slot += 1) {
      if (!this.state.powers.currentChoices[slot]) continue;
      const geometry = this.getButtonGeometry(slot, showBans);
      controls.push({ focus: { kind: 'choose', slot }, x: geometry.chooseX, y: BUTTON_Y });
      if (showBans) controls.push({ focus: { kind: 'ban', slot }, x: geometry.banX, y: BUTTON_Y });
    }
    if (this.state.powers.rerollsRemaining > 0) controls.push({ focus: REROLL_FOCUS, x: 640, y: 535 });
    return controls;
  }

  private getButtonGeometry(slot: number, showBan: boolean): {
    chooseX: number; chooseWidth: number; banX: number; banWidth: number;
  } {
    const cardX = CARD_XS[slot];
    if (!showBan) return { chooseX: cardX, chooseWidth: CARD_WIDTH, banX: cardX, banWidth: 0 };
    const usableWidth = CARD_WIDTH - BUTTON_GAP;
    const chooseWidth = Math.round(usableWidth * CHOOSE_SHARE);
    const banWidth = usableWidth - chooseWidth;
    const left = cardX - CARD_WIDTH / 2;
    return {
      chooseX: left + chooseWidth / 2,
      chooseWidth,
      banX: left + chooseWidth + BUTTON_GAP + banWidth / 2,
      banWidth,
    };
  }

  private refresh(): void {
    if (!this.state) return;
    const controls = this.getControls();
    if (!controls.some((control) => isSamePowerChoiceFocus(control.focus, this.focus))) {
      this.focus = controls.find((control) => control.focus.kind === 'choose')?.focus ?? controls[0]?.focus ?? this.focus;
    }
    this.title.setText(`LEVEL ${this.state.progression.level}`);
    const showBans = this.state.powers.bansRemaining > 0;
    for (let slot = 0; slot < this.choices.length; slot += 1) {
      const visual = this.choices[slot];
      const id = this.state.powers.currentChoices[slot];
      const visible = Boolean(id);
      const chooseFocused = visible && isSamePowerChoiceFocus(this.focus, { kind: 'choose', slot });
      const banFocused = visible && showBans && isSamePowerChoiceFocus(this.focus, { kind: 'ban', slot });
      const cardFocused = chooseFocused || banFocused;
      visual.background.setVisible(visible).setStrokeStyle(cardFocused ? 3 : 2, cardFocused ? 0xe4c46c : 0x53637a);
      visual.text.setVisible(visible);
      visual.chooseBackground.setVisible(visible);
      visual.chooseText.setVisible(visible);
      visual.banBackground.setVisible(visible && showBans);
      visual.banText.setVisible(visible && showBans);
      if (!id) {
        visual.chooseBackground.disableInteractive();
        visual.banBackground.disableInteractive();
        continue;
      }
      const definition = getPowerDefinition(id);
      const nextLevel = getPowerLevel(this.state.powers, id) + 1;
      visual.text.setText(`${definition.name}\n\nLv${nextLevel}\n\n${getPowerDescription(id, nextLevel, true)}`);
      const geometry = this.getButtonGeometry(slot, showBans);
      visual.chooseBackground.setPosition(geometry.chooseX, BUTTON_Y).setSize(geometry.chooseWidth, BUTTON_HEIGHT)
        .setDisplaySize(geometry.chooseWidth, BUTTON_HEIGHT)
        .setFillStyle(chooseFocused ? 0x3f7558 : 0x29483a, 0.98)
        .setStrokeStyle(chooseFocused ? 3 : 2, chooseFocused ? 0x82c799 : 0x5f8f73);
      visual.chooseText.setPosition(geometry.chooseX, BUTTON_Y);
      visual.banBackground.setPosition(geometry.banX, BUTTON_Y).setSize(geometry.banWidth, BUTTON_HEIGHT)
        .setDisplaySize(geometry.banWidth, BUTTON_HEIGHT)
        .setFillStyle(banFocused ? 0x8a5f31 : 0x5a4028, 0.98)
        .setStrokeStyle(banFocused ? 3 : 2, banFocused ? 0xe2a75e : 0xa97845);
      visual.banText.setPosition(geometry.banX, BUTTON_Y).setText(`BAN (${this.state.powers.bansRemaining})`);
      if (this.interactionEnabled) visual.chooseBackground.setInteractive({ useHandCursor: true });
      else visual.chooseBackground.disableInteractive();
      if (this.interactionEnabled && showBans) visual.banBackground.setInteractive({ useHandCursor: true });
      else visual.banBackground.disableInteractive();
    }
    const rerolls = this.state.powers.rerollsRemaining;
    const rerollFocused = rerolls > 0 && isSamePowerChoiceFocus(this.focus, REROLL_FOCUS);
    if (this.interactionEnabled && rerolls > 0) this.rerollBackground.setInteractive({ useHandCursor: true });
    else this.rerollBackground.disableInteractive();
    this.rerollText.setText(`REROLL (${rerolls})`).setAlpha(rerolls > 0 ? 1 : 0.45);
    this.rerollBackground.setFillStyle(rerolls > 0 ? 0x273243 : 0x1b202a, 0.98)
      .setStrokeStyle(rerollFocused ? 3 : 2, rerollFocused ? 0xe4c46c : 0x53637a);
  }
}
