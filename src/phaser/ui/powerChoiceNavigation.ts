export type PowerChoiceDirection = 'left' | 'right' | 'up' | 'down';
export type PowerChoiceFocus =
  | { kind: 'choose' | 'ban'; slot: number }
  | { kind: 'reroll' };

export interface PowerChoiceControl {
  focus: PowerChoiceFocus;
  x: number;
  y: number;
}

export function powerChoiceFocusKey(focus: PowerChoiceFocus): string {
  return focus.kind === 'reroll' ? 'reroll' : `${focus.kind}:${focus.slot}`;
}

export function isSamePowerChoiceFocus(a: PowerChoiceFocus, b: PowerChoiceFocus): boolean {
  return powerChoiceFocusKey(a) === powerChoiceFocusKey(b);
}

export function movePowerChoiceFocus(
  current: PowerChoiceFocus,
  direction: PowerChoiceDirection,
  controls: readonly PowerChoiceControl[],
): PowerChoiceFocus {
  const currentControl = controls.find((control) => isSamePowerChoiceFocus(control.focus, current));
  if (!currentControl) return controls[0]?.focus ?? current;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let best: PowerChoiceControl | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of controls) {
    if (isSamePowerChoiceFocus(candidate.focus, current)) continue;
    const primary = horizontal
      ? (candidate.x - currentControl.x) * sign
      : (candidate.y - currentControl.y) * sign;
    if (primary <= 0) continue;
    const cross = horizontal
      ? Math.abs(candidate.y - currentControl.y)
      : Math.abs(candidate.x - currentControl.x);
    const score = primary + cross * 2;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.focus ?? current;
}
