import {
  calculateBalance,
  clampBalanceSettings,
  cloneBalanceSettings,
  createGameDefaultBalanceSettings,
  getDerivedDensity,
  getGunMaxDps,
  type BalanceReport,
  type BalanceSettings,
  type MetricSet,
} from '../../src/balance/model';
import { POWER_DEFINITIONS, type PowerId } from '../../src/simulation/powers';
import { GAME_CONFIG } from '../../src/simulation/config';
import { BRICK_SPEED_CLASSES, canSpeedClassSpawnArmored, getGunSpec, getSpeedRampEndSecondsForRules } from '../../src/simulation/gameplayRules';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Balance Lab root is missing.');
let settings = createGameDefaultBalanceSettings();
let debounceTimer = 0;

function time(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function parseTime(value: string): number {
  if (value.includes(':')) { const [minutes, seconds] = value.split(':').map(Number); return Math.max(0, (minutes || 0) * 60 + (seconds || 0)); }
  return Math.max(0, Number(value) || 0);
}
function number(value: number, digits = 2): string { return Number.isFinite(value) ? value.toFixed(digits) : '∞'; }
function metric(label: string, value: string, title = ''): string { return `<div class="metric" title="${title}"><span>${label}</span><b>${value}</b></div>`; }
function row(label: string, set: MetricSet): string { return `<tr><td>${label}</td><td>${number(set.max)}</td><td>${number(set.median)}</td><td>${number(set.likely)}</td></tr>`; }

type InputSpec = { label: string; path: string; value: number | boolean | null; kind?: 'time' | 'percent' | 'auto' | 'checkbox'; step?: number; title?: string };
function field(spec: InputSpec): string {
  const type = spec.kind === 'checkbox' ? 'checkbox' : 'text';
  let displayed: string | number = spec.value === null ? 'AUTO' : spec.value as number;
  if (spec.kind === 'time' && typeof spec.value === 'number') displayed = time(spec.value);
  if (spec.kind === 'percent' && typeof spec.value === 'number') displayed = number(spec.value * 100, 1);
  return `<label class="field" title="${spec.title ?? ''}"><span>${spec.label}</span><input data-path="${spec.path}" data-kind="${spec.kind ?? 'number'}" type="${type}" ${spec.value === true ? 'checked' : ''} value="${type === 'checkbox' ? '' : displayed}"></label>`;
}
function setPath(path: string, value: unknown): void {
  const keys = path.split('.'); let target: Record<string, unknown> = settings as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value;
}

function render(): void {
  settings = clampBalanceSettings(settings);
  const report = calculateBalance(settings);
  const weights = report.normalizedWeights;
  const speedTimingRules = {
    easyEndSeconds: settings.speedTiming.easyEndSeconds,
    winSeconds: settings.speedTiming.winSeconds,
    maxSpeedLeadSeconds: settings.speedTiming.maxSpeedLeadSeconds,
  };
  app.innerHTML = `
    <header><h1>BALANCE LAB</h1>${field({ label: 'TIME', path: 'timeSeconds', value: settings.timeSeconds, kind: 'time' })}${field({ label: 'PLAYER LEVEL', path: 'playerLevel', value: settings.playerLevel })}<button id="reset">RESET TO GAME DEFAULTS</button><span class="hint">Developer-only deterministic throughput model</span><span id="error" class="error"></span></header>
    <div class="layout">
      <section><h2>GAME PARAMETERS — BOARD / SPEED TIMING</h2><div class="fields">
        ${field({ label: 'Easy start', path: 'speedTiming.easyEndSeconds', value: settings.speedTiming.easyEndSeconds, kind: 'time' })}
        ${field({ label: 'Win time', path: 'speedTiming.winSeconds', value: settings.speedTiming.winSeconds, kind: 'time' })}
        ${field({ label: 'Max-speed lead', path: 'speedTiming.maxSpeedLeadSeconds', value: settings.speedTiming.maxSpeedLeadSeconds, kind: 'time' })}
        ${field({ label: 'Columns', path: 'board.columns', value: settings.board.columns })}
        ${field({ label: 'Board width', path: 'board.logicalWidth', value: settings.board.logicalWidth })}
        ${field({ label: 'Board height', path: 'board.logicalHeight', value: settings.board.logicalHeight })}
        ${field({ label: 'Brick width', path: 'board.brickWidth', value: settings.board.brickWidth })}
        ${field({ label: 'Brick height', path: 'board.brickHeight', value: settings.board.brickHeight })}
        ${field({ label: 'Horizontal pitch', path: 'board.horizontalPitch', value: settings.board.horizontalPitch })}
        ${field({ label: 'Vertical pitch', path: 'board.verticalPitch', value: settings.board.verticalPitch })}
        ${field({ label: 'Roof Y', path: 'board.roofY', value: settings.board.roofY })}
        ${field({ label: 'Danger Y', path: 'board.dangerY', value: settings.board.dangerY })}
        ${field({ label: 'Loss Y', path: 'board.lossY', value: settings.board.lossY })}
      </div><p class="hint">Current max-speed timestamp: ${time(getSpeedRampEndSecondsForRules(speedTimingRules))}</p></section>
      <section><h2>GAME PARAMETERS — DENSITY / SPEED</h2><div class="fields">
        ${field({ label: 'Density start level', path: 'density.startLevel', value: settings.density.startLevel })}
        ${field({ label: 'Density full level', path: 'density.fullLevel', value: settings.density.fullLevel })}
        ${field({ label: 'Start min', path: 'density.startMin', value: settings.density.startMin })}
        ${field({ label: 'Start max', path: 'density.startMax', value: settings.density.startMax })}
        ${field({ label: 'Full min', path: 'density.fullMin', value: settings.density.fullMin })}
        ${field({ label: 'Full max', path: 'density.fullMax', value: settings.density.fullMax })}
        ${field({ label: 'Density override', path: 'density.override', value: settings.density.override, kind: 'auto', title: 'AUTO derives density from PLAYER LEVEL.' })}
        ${BRICK_SPEED_CLASSES.map(key => field({ label: `Start ${key}`, path: `speed.start.${key}`, value: settings.speed.start[key] })).join('')}
        ${BRICK_SPEED_CLASSES.map(key => field({ label: `Max ${key}`, path: `speed.max.${key}`, value: settings.speed.max[key] })).join('')}
        ${BRICK_SPEED_CLASSES.map(key => field({ label: `${key} weight`, path: `speed.weights.${key}`, value: settings.speed.weights[key] })).join('')}
      </div><p class="hint">Effective normalized weights: S ${number(weights.SLOW*100,1)}% · M ${number(weights.MEDIUM*100,1)}% · F ${number(weights.FAST*100,1)}% · R ${number(weights.RUSH*100,1)}%</p></section>
      <section><h2>GAME PARAMETERS — BRICK TYPES</h2><div class="fields">
        ${field({ label: 'Armored enabled', path: 'armored.enabled', value: settings.armored.enabled, kind: 'checkbox' })}
        ${field({ label: 'Armor chance', path: 'armored.chance', value: settings.armored.chance, kind: 'percent' })}
        ${field({ label: 'Armor HP', path: 'armored.hp', value: settings.armored.hp })}
        ${field({ label: 'Armor XP', path: 'armored.xp', value: settings.armored.xp })}
        ${field({ label: 'Boss enabled', path: 'boss.enabled', value: settings.boss.enabled, kind: 'checkbox' })}
        ${field({ label: 'Boss HP', path: 'boss.hp', value: settings.boss.hp })}
        ${field({ label: 'Boss lottery', path: 'boss.lotteryChance', value: settings.boss.lotteryChance, kind: 'percent' })}
        ${field({ label: 'First lottery', path: 'boss.firstLotterySeconds', value: settings.boss.firstLotterySeconds, kind: 'time' })}
        ${field({ label: 'Re-arm after leaving', path: 'boss.rearmSeconds', value: settings.boss.rearmSeconds, kind: 'time' })}
        ${field({ label: 'Final Boss lead', path: 'boss.finalBossLeadSeconds', value: settings.boss.finalBossLeadSeconds, kind: 'time' })}
        ${field({ label: 'Boss speed ×', path: 'boss.speedMultiplier', value: settings.boss.speedMultiplier })}
        ${field({ label: 'Boss entrance speed', path: 'boss.entranceSpeed', value: settings.boss.entranceSpeed })}
      </div><p class="hint">Armor remains a modifier on eligible ${BRICK_SPEED_CLASSES.filter(canSpeedClassSpawnArmored).join('/')} bricks. Boss pressure is reported separately from continuous conveyor HP/s.</p></section>
      <section><h2>GAME PARAMETERS — BALL / ASSIST</h2><div class="fields">
        ${field({ label: 'Ball speed', path: 'ball.speed', value: settings.ball.speed })}
        ${field({ label: 'Pressure assist enabled', path: 'pressureAssist.enabled', value: settings.pressureAssist.enabled, kind: 'checkbox' })}
        ${field({ label: 'Assist grace', path: 'pressureAssist.graceSeconds', value: settings.pressureAssist.graceSeconds })}
        ${field({ label: 'Assist max ramp', path: 'pressureAssist.maximumProgress', value: settings.pressureAssist.maximumProgress, kind: 'percent' })}
        ${field({ label: 'Assist ramp/sec', path: 'pressureAssist.progressPerSecond', value: settings.pressureAssist.progressPerSecond, kind: 'percent' })}
      </div></section>
      <section><h2>GAME PARAMETERS — PLAYER SURVIVAL</h2><div class="fields">
        ${field({ label: 'Max HP', path: 'playerSurvival.maxHp', value: settings.playerSurvival.maxHp })}
        ${field({ label: 'Final Ball lost damage', path: 'playerSurvival.finalBallLostDamage', value: settings.playerSurvival.finalBallLostDamage })}
        ${field({ label: 'Normal Brick lost', path: 'playerSurvival.normalBrickLostDamage', value: settings.playerSurvival.normalBrickLostDamage })}
        ${field({ label: 'Normal Brick tank', path: 'playerSurvival.normalBrickPaddleDamage', value: settings.playerSurvival.normalBrickPaddleDamage })}
        ${field({ label: 'Armored Brick lost', path: 'playerSurvival.armoredBrickLostDamage', value: settings.playerSurvival.armoredBrickLostDamage })}
        ${field({ label: 'Armored Brick tank', path: 'playerSurvival.armoredBrickPaddleDamage', value: settings.playerSurvival.armoredBrickPaddleDamage })}
        ${field({ label: 'Boss lost', path: 'playerSurvival.bossLostDamage', value: settings.playerSurvival.bossLostDamage })}
        ${field({ label: 'Boss contact — player', path: 'playerSurvival.bossContactPlayerDamage', value: settings.playerSurvival.bossContactPlayerDamage })}
        ${field({ label: 'Boss contact — Boss', path: 'playerSurvival.bossContactBossDamage', value: settings.playerSurvival.bossContactBossDamage })}
        ${field({ label: 'Boss contact cooldown', path: 'playerSurvival.bossContactCooldownSeconds', value: settings.playerSurvival.bossContactCooldownSeconds })}
        ${field({ label: 'Level-up heal', path: 'playerSurvival.levelUpHeal', value: settings.playerSurvival.levelUpHeal })}
      </div><p class="hint">Canonical survival-resource facts only; not converted into throughput or DPS.</p></section>
      <section class="wide"><h2>POWERS — 0 MEANS NOT OWNED</h2><div class="power-grid">
        ${POWER_DEFINITIONS.map(({id,name}) => `<label class="field"><span>${name}</span><select data-path="powers.${id}" data-kind="number">${Array.from({length:GAME_CONFIG.powers.maxLevel+1},(_,level)=>`<option ${settings.powers[id]===level?'selected':''}>${level}</option>`).join('')}</select></label>`).join('')}
        ${field({ label: 'Split acquired at', path: 'splitAcquiredAtSeconds', value: settings.splitAcquiredAtSeconds, kind: 'time' })}
        ${field({ label: 'Active Balls override', path: 'activeBallCountOverride', value: settings.activeBallCountOverride, kind: 'auto' })}
      </div></section>
      <section class="wide"><h2>MODEL ASSUMPTIONS</h2><div class="fields">
        ${field({ label: 'Average path factor', path: 'assumptions.averageTravelDistanceFactor', value: settings.assumptions.averageTravelDistanceFactor, kind: 'percent' })}
        ${field({ label: 'Best path', path: 'assumptions.bestTravelDistance', value: settings.assumptions.bestTravelDistance })}
        ${field({ label: 'Contact efficiency', path: 'assumptions.contactEfficiency', value: settings.assumptions.contactEfficiency, kind: 'percent' })}
        ${field({ label: 'Continuation factor', path: 'assumptions.continuationDistanceFactor', value: settings.assumptions.continuationDistanceFactor, kind: 'percent' })}
        ${field({ label: 'Paddle retention/width', path: 'assumptions.paddleRetentionPerWidthIncrease', value: settings.assumptions.paddleRetentionPerWidthIncrease, kind: 'percent' })}
        ${field({ label: 'Pierce median efficiency', path: 'assumptions.pierceMedianEfficiency', value: settings.assumptions.pierceMedianEfficiency, kind: 'percent' })}
        ${field({ label: 'Pierce likely efficiency', path: 'assumptions.pierceLikelyEfficiency', value: settings.assumptions.pierceLikelyEfficiency, kind: 'percent' })}
        ${field({ label: 'Ice shatter chance', path: 'assumptions.iceShatterProbability', value: settings.assumptions.iceShatterProbability, kind: 'percent' })}
        ${field({ label: 'Ice re-hit chance', path: 'assumptions.iceRehitProbability', value: settings.assumptions.iceRehitProbability, kind: 'percent' })}
        ${field({ label: 'Ice chain generations', path: 'assumptions.iceAssumedChainGenerations', value: settings.assumptions.iceAssumedChainGenerations })}
        ${field({ label: 'Ice control seconds', path: 'assumptions.icePressureSeconds', value: settings.assumptions.icePressureSeconds })}
        ${field({ label: 'Gun likely base hit', path: 'assumptions.gunLikelyBaseHitRate', value: settings.assumptions.gunLikelyBaseHitRate, kind: 'percent' })}
        ${field({ label: 'Gun likely density hit', path: 'assumptions.gunLikelyDensityHitRate', value: settings.assumptions.gunLikelyDensityHitRate, kind: 'percent' })}
        ${field({ label: 'Missile likely base hit', path: 'assumptions.missileLikelyBaseHitRate', value: settings.assumptions.missileLikelyBaseHitRate, kind: 'percent' })}
        ${field({ label: 'Missile density hit', path: 'assumptions.missileLikelyDensityHitRate', value: settings.assumptions.missileLikelyDensityHitRate, kind: 'percent' })}
        ${field({ label: 'Electric available cells', path: 'assumptions.electricAvailableCells', value: settings.assumptions.electricAvailableCells })}
        ${field({ label: 'Trapped assist active', path: 'assumptions.trappedBallAssistActive', value: settings.assumptions.trappedBallAssistActive, kind: 'checkbox' })}
        ${field({ label: 'Ball inactivity', path: 'assumptions.trappedBallInactivitySeconds', value: settings.assumptions.trappedBallInactivitySeconds })}
        ${field({ label: 'Seed', path: 'assumptions.monteCarloSeed', value: settings.assumptions.monteCarloSeed })}
        ${field({ label: 'Samples', path: 'assumptions.monteCarloSamples', value: settings.assumptions.monteCarloSamples })}
      </div><p class="hint">These are statistical estimates, not gameplay rules. Fixed-seed sampling is deterministic and does not use Math.random.</p></section>
      ${renderOutputs(settings, report)}
    </div>`;
  bindInputs();
}

function renderOutputs(current: BalanceSettings, report: BalanceReport): string {
  const boss = report.boss;
  const occupancy = report.density / current.board.columns;
  const gunLevels = Array.from({ length: GAME_CONFIG.powers.maxLevel }, (_, index) => {
    const level = index + 1;
    const spec = getGunSpec(level);
    const maximumDps = getGunMaxDps(level);
    const estimatedDps = maximumDps * (current.assumptions.gunLikelyBaseHitRate
      + current.assumptions.gunLikelyDensityHitRate * occupancy);
    return `<tr><td>${level}</td><td>${spec.bulletsPerVolley}</td><td>${spec.volleyPairs}</td><td>${number(spec.reloadSeconds, 1)}s</td><td>${number(maximumDps, 3)}</td><td>${number(estimatedDps, 3)}</td></tr>`;
  }).join('');
  const timeline = current.assumptions.reportingTimelineSeconds.map(snapshot => {
    const next = cloneBalanceSettings(current); next.timeSeconds = snapshot;
    const result = calculateBalance(next, { includePowerReports: false });
    return `<tr><td>${time(snapshot)}</td><td>${number(result.boardHpPerSecond.likely)}</td><td>${number(result.combined.total.likely)}</td><td class="${result.comparison.likelyNetPressure>0?'positive':'negative'}">${number(result.comparison.likelyNetPressure)}</td></tr>`;
  }).join('');
  return `
    <section class="wide"><h2>BOARD PRESSURE — ${time(current.timeSeconds)}</h2><div class="metrics">
      ${metric('Density', `${number(report.density,2)} / ${current.board.columns}`)}
      ${metric('SLOW px/s', number(report.classSpeeds.SLOW))}${metric('MEDIUM px/s', number(report.classSpeeds.MEDIUM))}
      ${metric('FAST px/s', number(report.classSpeeds.FAST))}${metric('RUSH px/s', number(report.classSpeeds.RUSH))}
      ${metric('Weighted speed', number(report.weightedAverageSpeed))}${metric('Frontier likely', number(report.formation.frontierSpeed.likely))}
      ${metric('Formations/s', number(report.formation.formationsPerSecond.likely))}${metric('Generated bricks/s', number(report.formation.generatedBricksPerSecond.likely))}
      ${metric('Average HP/brick', number(report.averageHpPerBrick,3))}${metric('LIKELY BOARD HP/s', number(report.boardHpPerSecond.likely), 'Expected conveyor HP throughput using sampled spatial-frontier speed.')}
      ${metric('MEDIAN BOARD HP/s', number(report.boardHpPerSecond.median))}${metric('MAX BOARD HP/s', number(report.boardHpPerSecond.max), 'Best legal homogeneous speed/HP composition at maximum selected density; impossible RUSH+Armor is excluded.')}
    </div><p class="hint">Boss: recurring lottery from ${time(current.boss.firstLotterySeconds)} at ${number(current.boss.lotteryChance * 100, 0)}% per qualifying kill · re-arms ${time(current.boss.rearmSeconds)} after a normal Boss leaves · mandatory Final Boss ${time(boss.guaranteedFinalBossTime)}${boss.guaranteedFinalBossDue ? ' (due)' : ''}, immediate and allowed alongside one normal Boss · cruise ${number(boss.cruiseSpeed)} px/s · max-RUSH arrival ${number(boss.rushArrivalSpeed)} px/s · discrete HP ${number(boss.discreteHp,0)}.</p></section>
    <section><h2>BASE BALL / SHARED EVENTS</h2><table><thead><tr><th></th><th>MAX</th><th>MEDIAN</th><th>LIKELY</th></tr></thead><tbody>${row('Contacts/s',report.ballContactsPerSecond)}${row('Base Ball DPS',report.baseBallDps)}${row('Elemental proc events/s',report.elementalProcEventsPerSecond)}</tbody></table><p class="hint">Active Balls: ${report.activeBallCount}. Elemental events are shared by Electric, Fire, and Wind and include legal Ball kills, Ice freezes, and direct Ball shatters.</p></section>
    <section><h2>COMBINED BUILD</h2><table><thead><tr><th></th><th>MAX</th><th>MEDIAN</th><th>LIKELY</th></tr></thead><tbody>${row('Base Ball',report.combined.baseBall)}${row('Power contribution',report.combined.powerContribution)}${row('TOTAL PLAYER DPS',report.combined.total)}</tbody></table><div class="metrics">${metric('Likely board HP/s',number(report.boardHpPerSecond.likely))}${metric('Likely player DPS',number(report.combined.total.likely))}${metric('NET PRESSURE',number(report.comparison.likelyNetPressure),'Board HP/s minus player DPS. Positive means unresolved HP accumulation.',)}${metric('MAX net',number(report.comparison.maxNetPressure))}</div><p class="hint">Negative net pressure does not guarantee survival; spatial distribution, trapped trajectories, low fast bricks, and discrete Bosses remain decisive. This is a throughput model.</p></section>
    <section class="wide"><h2>POWER CONTRIBUTIONS — INCREMENTAL UNDER CURRENT BUILD</h2><table><thead><tr><th>POWER</th><th>LV</th><th>MAX DPS</th><th>MEDIAN</th><th>LIKELY</th><th>NOTES</th></tr></thead><tbody>${report.powers.map(power=>`<tr><td>${power.name}</td><td>${power.level}</td><td>${number(power.contribution.max)}</td><td>${number(power.contribution.median)}</td><td>${number(power.contribution.likely)}</td><td>${power.id==='PADDLE_SIZE'?`Direct 0; throughput ×${number(power.throughputMultiplier??1,3)}`:power.id==='ICE_BALL'?`Capacity ${power.iceCollisionCapacity??0}; freeze ${number(power.frozenBricksPerSecond??0)}/s; control ${number(power.pressureReductionHpPerSecond??0)} HP·s/s`:''}</td></tr>`).join('')}</tbody></table></section>
    <section class="wide"><h2>CANONICAL GUN PROGRESSION</h2><table><thead><tr><th>LV</th><th>BULLETS / VOLLEY</th><th>PAIRED STEPS</th><th>RELOAD</th><th>MAX DPS</th><th>ESTIMATED DPS</th></tr></thead><tbody>${gunLevels}</tbody></table><p class="hint">Each paired step fires simultaneous left/right bullets. Estimated DPS applies the current likely Gun hit-rate assumptions at the current board density.</p></section>
    <section class="wide"><h2>PRESSURE TRAJECTORY</h2><table><thead><tr><th>TIME</th><th>BOARD HP/s</th><th>PLAYER LIKELY</th><th>NET</th></tr></thead><tbody>${timeline}</tbody></table></section>
    <section class="wide definitions"><div><b>MAX</b>Theoretical practical ceiling with targets available and efficient legal paths.</div><div><b>MEDIAN</b>50th percentile across deterministic sampled plausible layouts.</div><div><b>LIKELY</b>Arithmetic mean under current density and assumptions.</div><div><b>BOARD HP/s</b>Continuous ordinary conveyor HP entering per second; Boss HP is separate.</div><div><b>NET PRESSURE</b>Board HP/s minus likely player DPS; not an exact survival prediction.</div></section>`;
}

function bindInputs(): void {
  document.querySelector('#reset')?.addEventListener('click', () => { settings = createGameDefaultBalanceSettings(); render(); });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach(control => {
    control.addEventListener('input', () => {
      const kind = control.dataset.kind; let value: unknown;
      if (kind === 'checkbox') value = (control as HTMLInputElement).checked;
      else if (kind === 'time') value = parseTime(control.value);
      else if (kind === 'auto') value = control.value.trim().toUpperCase() === 'AUTO' || control.value.trim() === '' ? null : Number(control.value);
      else if (kind === 'percent') value = Number(control.value) / 100;
      else value = Number(control.value);
      if (typeof value === 'number' && !Number.isFinite(value)) {
        document.querySelector('#error')!.textContent = `Invalid value for ${control.dataset.path}`;
        return;
      }
      setPath(control.dataset.path!, value);
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(render, 100);
    });
  });
}

render();
