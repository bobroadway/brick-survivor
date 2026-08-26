import Phaser from 'phaser';
import type { GameState } from '../../simulation/gameState';
import { getPowerDefinition, getPowerDescription, getPowerLevel, type PowerId } from '../../simulation/powers';
import { RenderQualityManager } from '../rendering/RenderQualityManager';

interface ChoiceVisual {
  background: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
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
  private focusIndex = 0;
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
    for (let index = 0; index < 3; index += 1) {
      const x = 310 + index * 330;
      const background = scene.add.rectangle(x, 315, 285, 235, 0x273243, 0.98)
        .setStrokeStyle(2, 0x53637a).setInteractive({ useHandCursor: true });
      const text = renderQuality.addText(x, 315, '', {
        align: 'center', color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '19px',
        wordWrap: { width: 245 },
      }).setOrigin(0.5);
      background.on(Phaser.Input.Events.POINTER_OVER, () => { this.focusIndex = index; this.refresh(); });
      background.on(Phaser.Input.Events.POINTER_DOWN, () => this.activateIndex(index));
      const banBackground = scene.add.rectangle(x, 458, 110, 34, 0x512f35, 0.98)
        .setStrokeStyle(2, 0xa56570).setInteractive({ useHandCursor: true });
      const banText = renderQuality.addText(x, 458, 'BAN', {
        color: '#f3d9dc', fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold',
      }).setOrigin(0.5);
      banBackground.on(Phaser.Input.Events.POINTER_DOWN, () => {
        const id = this.state?.powers.currentChoices[index];
        if (this.interactionEnabled && id) this.ban(id);
      });
      this.choices.push({ background, text, banBackground, banText });
      this.container.add([background, text, banBackground, banText]);
    }
    this.rerollBackground = scene.add.rectangle(640, 525, 250, 48, 0x273243, 0.98)
      .setStrokeStyle(2, 0x53637a).setInteractive({ useHandCursor: true });
    this.rerollText = renderQuality.addText(640, 525, '', {
      color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.rerollBackground.on(Phaser.Input.Events.POINTER_OVER, () => { this.focusIndex = 3; this.refresh(); });
    this.rerollBackground.on(Phaser.Input.Events.POINTER_DOWN, () => this.activateIndex(3));
    this.container.add([this.rerollBackground, this.rerollText]);
  }

  show(state: GameState, interactionEnabled = true, alpha = 1): void {
    this.state = state;
    this.focusIndex = 0;
    this.interactionEnabled = interactionEnabled;
    this.container.setVisible(true).setAlpha(alpha);
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
    if (!interactionChanged) return;
    if (interactionEnabled) {
      this.refresh();
    } else {
      for (const visual of this.choices) {
        visual.background.disableInteractive();
        visual.banBackground.disableInteractive();
      }
      this.rerollBackground.disableInteractive();
    }
  }

  move(direction: -1 | 1): void {
    if (!this.state || !this.interactionEnabled) return;
    const focusable = this.state.powers.currentChoices.flatMap((id, index) => id ? [index] : []);
    if (this.state.powers.rerollsRemaining > 0) focusable.push(3);
    if (focusable.length === 0) return;
    const current = Math.max(0, focusable.indexOf(this.focusIndex));
    this.focusIndex = focusable[(current + direction + focusable.length) % focusable.length];
    this.refresh();
  }

  activateFocused(): void { this.activateIndex(this.focusIndex); }

  private activateIndex(index: number): void {
    if (!this.state || !this.interactionEnabled) return;
    const id = this.state.powers.currentChoices[index];
    if (id) this.select(id);
    else if (index === 3) this.reroll();
  }

  refresh(): void {
    if (!this.state) return;
    this.title.setText(`LEVEL ${this.state.progression.level}`);
    for (let index = 0; index < this.choices.length; index += 1) {
      const visual = this.choices[index];
      const id = this.state.powers.currentChoices[index];
      visual.background.setVisible(Boolean(id));
      visual.text.setVisible(Boolean(id));
      const showBan = Boolean(id) && this.state.powers.bansRemaining > 0;
      visual.banBackground.setVisible(showBan);
      visual.banText.setVisible(showBan);
      if (!id) {
        visual.background.disableInteractive();
        visual.banBackground.disableInteractive();
        continue;
      }
      if (this.interactionEnabled) visual.background.setInteractive({ useHandCursor: true });
      else visual.background.disableInteractive();
      if (this.interactionEnabled && showBan) visual.banBackground.setInteractive({ useHandCursor: true });
      else visual.banBackground.disableInteractive();
      const definition = getPowerDefinition(id);
      const nextLevel = getPowerLevel(this.state.powers, id) + 1;
      visual.text.setText(`${definition.name}\n\nLv${nextLevel}\n\n${getPowerDescription(id, nextLevel, true)}`);
      visual.background.setStrokeStyle(this.focusIndex === index ? 3 : 2, this.focusIndex === index ? 0xe4c46c : 0x53637a);
    }
    const rerolls = this.state.powers.rerollsRemaining;
    if (this.interactionEnabled && rerolls > 0) this.rerollBackground.setInteractive({ useHandCursor: true });
    else this.rerollBackground.disableInteractive();
    this.rerollText.setText(`REROLL (${rerolls})`).setAlpha(rerolls > 0 ? 1 : 0.45);
    this.rerollBackground.setFillStyle(rerolls > 0 ? 0x273243 : 0x1b202a, 0.98);
    this.rerollBackground.setStrokeStyle(this.focusIndex === 3 && rerolls > 0 ? 3 : 2, this.focusIndex === 3 && rerolls > 0 ? 0xe4c46c : 0x53637a);
  }
}
