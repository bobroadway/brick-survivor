import {
  isSamePowerChoiceFocus,
  movePowerChoiceFocus,
  type PowerChoiceControl,
  type PowerChoiceDirection,
  type PowerChoiceFocus,
} from '../src/phaser/ui/powerChoiceNavigation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const controls: PowerChoiceControl[] = [
  { focus: { kind: 'choose', slot: 0 }, x: 251, y: 462 },
  { focus: { kind: 'ban', slot: 0 }, x: 388, y: 462 },
  { focus: { kind: 'choose', slot: 1 }, x: 581, y: 462 },
  { focus: { kind: 'ban', slot: 1 }, x: 718, y: 462 },
  { focus: { kind: 'choose', slot: 2 }, x: 911, y: 462 },
  { focus: { kind: 'ban', slot: 2 }, x: 1048, y: 462 },
  { focus: { kind: 'reroll' }, x: 640, y: 535 },
];

function move(current: PowerChoiceFocus, direction: PowerChoiceDirection): PowerChoiceFocus {
  return movePowerChoiceFocus(current, direction, controls);
}

assert(isSamePowerChoiceFocus(move({ kind: 'choose', slot: 0 }, 'right'), { kind: 'ban', slot: 0 }), 'right did not reach same-card BAN');
assert(isSamePowerChoiceFocus(move({ kind: 'ban', slot: 0 }, 'right'), { kind: 'choose', slot: 1 }), 'right did not reach next-card CHOOSE');
assert(isSamePowerChoiceFocus(move({ kind: 'choose', slot: 1 }, 'left'), { kind: 'ban', slot: 0 }), 'left did not reach nearest previous control');
assert(isSamePowerChoiceFocus(move({ kind: 'choose', slot: 1 }, 'down'), { kind: 'reroll' }), 'down did not reach REROLL');
assert(isSamePowerChoiceFocus(move({ kind: 'reroll' }, 'up'), { kind: 'choose', slot: 1 }), 'up did not return to nearest CHOOSE');

let focus: PowerChoiceFocus = { kind: 'choose', slot: 0 };
for (let index = 0; index < 5; index += 1) focus = move(focus, 'right');
assert(isSamePowerChoiceFocus(focus, { kind: 'ban', slot: 2 }), 'horizontal navigation did not reach every card action');

const noBanControls = controls.filter((control) => control.focus.kind !== 'ban');
const recovered = movePowerChoiceFocus({ kind: 'ban', slot: 1 }, 'right', noBanControls);
assert(isSamePowerChoiceFocus(recovered, { kind: 'choose', slot: 0 }), 'removed BAN focus did not recover to a valid action');
