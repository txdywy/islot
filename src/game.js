import { BET_STEPS, PAYLINES, THEMES } from "./game-data.js";

const state = {
  themeId: localStorage.getItem("islot-theme") || "vegas",
  balance: Number(localStorage.getItem("islot-balance") || 50000),
  betIndex: Number(localStorage.getItem("islot-bet-index") || 2),
  freeSpins: Number(localStorage.getItem("islot-free-spins") || 0),
  heat: Number(localStorage.getItem("islot-heat") || 0),
  unlockedThemes: readStoredJson("islot-unlocked-themes", ["vegas"]),
  themeProgress: readStoredJson("islot-theme-progress", {}),
  lineCount: clampNumber(Number(localStorage.getItem("islot-line-count") || PAYLINES.length), 1, PAYLINES.length),
  spinning: false,
  turbo: false,
  muted: false,
  auto: false,
  autoTimer: 0,
  linePreviewTimer: 0,
};

const audio = {
  ctx: null,
  master: null,
  spinOsc: null,
  spinGain: null,
  spinNoise: null,
  spinNoiseGain: null,
  noiseBuffer: null,
};

const els = {
  shell: document.querySelector("#gameShell"),
  machine: document.querySelector("#machine"),
  reels: document.querySelector("#reels"),
  paylineOverlay: document.querySelector("#paylineOverlay"),
  themeList: document.querySelector("#themeList"),
  themeCount: document.querySelector("#themeCount"),
  balance: document.querySelector("#balanceValue"),
  bet: document.querySelector("#betValue"),
  lineCount: document.querySelector("#lineCountValue"),
  jackpot: document.querySelector("#jackpotValue"),
  freeSpins: document.querySelector("#freeSpinsValue"),
  themeName: document.querySelector("#currentThemeName"),
  heatFill: document.querySelector("#heatFill"),
  heatText: document.querySelector("#heatText"),
  paytable: document.querySelector("#paytableList"),
  winBanner: document.querySelector("#winBanner"),
  winTitle: document.querySelector("#winTitle"),
  winAmount: document.querySelector("#winAmount"),
  spinButton: document.querySelector("#spinButton"),
  spinHint: document.querySelector("#spinHint"),
  autoButton: document.querySelector("#autoButton"),
  addCoins: document.querySelector("#addCoinsButton"),
  bankAdd: document.querySelector("#bankAddButton"),
  betDown: document.querySelector("#betDown"),
  betUp: document.querySelector("#betUp"),
  lineDown: document.querySelector("#lineDown"),
  lineUp: document.querySelector("#lineUp"),
  mute: document.querySelector("#muteButton"),
  turbo: document.querySelector("#turboButton"),
  toastStack: document.querySelector("#toastStack"),
  canvas: document.querySelector("#fxCanvas"),
};

const fx = {
  ctx: els.canvas.getContext("2d"),
  particles: [],
  width: 0,
  height: 0,
};

const format = new Intl.NumberFormat("zh-CN");
const reelStopEase = "cubic-bezier(.12, .78, .12, 1)";
const THEME_UNLOCK_TARGET = 100;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

if (!state.unlockedThemes.includes("vegas")) state.unlockedThemes.unshift("vegas");
if (!state.unlockedThemes.includes(state.themeId)) state.themeId = state.unlockedThemes[0];

function readStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function currentTheme() {
  return THEMES.find((theme) => theme.id === state.themeId) || THEMES[0];
}

function currentBet() {
  return BET_STEPS[state.betIndex];
}

function currentLineCount() {
  return clampNumber(state.lineCount, 1, PAYLINES.length);
}

function currentTotalBet() {
  return currentBet() * currentLineCount();
}

function saveState() {
  localStorage.setItem("islot-theme", state.themeId);
  localStorage.setItem("islot-balance", String(state.balance));
  localStorage.setItem("islot-bet-index", String(state.betIndex));
  localStorage.setItem("islot-free-spins", String(state.freeSpins));
  localStorage.setItem("islot-heat", String(state.heat));
  localStorage.setItem("islot-line-count", String(currentLineCount()));
  localStorage.setItem("islot-unlocked-themes", JSON.stringify(state.unlockedThemes));
  localStorage.setItem("islot-theme-progress", JSON.stringify(state.themeProgress));
}

function themeIndex(themeId) {
  return THEMES.findIndex((theme) => theme.id === themeId);
}

function isThemeUnlocked(themeId) {
  return state.unlockedThemes.includes(themeId);
}

function themeProgress(themeId) {
  if (isThemeUnlocked(THEMES.at(-1)?.id) && themeId === THEMES.at(-1)?.id) return THEME_UNLOCK_TARGET;
  return Math.min(THEME_UNLOCK_TARGET, Number(state.themeProgress[themeId] || 0));
}

function nextLockedTheme(themeId = state.themeId) {
  const index = themeIndex(themeId);
  if (index < 0) return null;
  return THEMES.slice(index + 1).find((theme) => !isThemeUnlocked(theme.id)) || null;
}

function renderShell() {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.setProperty("--theme", theme.accent);
  document.documentElement.style.setProperty("--theme-2", theme.second);
  els.themeCount.textContent = THEMES.length;
  els.themeName.textContent = theme.name;
  els.balance.textContent = format.format(state.balance);
  els.bet.textContent = format.format(currentBet());
  els.lineCount.textContent = currentLineCount();
  els.jackpot.textContent = format.format(theme.jackpot + state.heat * currentBet() * 7);
  els.freeSpins.textContent = state.freeSpins;
  els.spinHint.textContent =
    state.freeSpins > 0
      ? `${currentLineCount()} 条线 · 免费局`
      : `${currentLineCount()} 条线 · 总下注 ${format.format(currentTotalBet())}`;
  els.lineDown.disabled = currentLineCount() <= 1;
  els.lineUp.disabled = currentLineCount() >= PAYLINES.length;
  els.autoButton.classList.toggle("is-active", state.auto);
  els.turbo.classList.toggle("is-active", state.turbo);
  els.mute.classList.toggle("is-active", state.muted);
  els.heatFill.style.width = `${Math.min(100, state.heat * 14)}%`;
  const progress = themeProgress(theme.id);
  const nextTheme = nextLockedTheme(theme.id);
  els.heatFill.style.width = `${progress}%`;
  els.heatText.textContent = nextTheme
    ? `${theme.name} 探索进度 ${Math.floor(progress)}%，满格解锁「${nextTheme.name}」。`
    : "所有主题已解锁，继续冲击大奖和免费局。";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.themeShortcut === theme.id);
    tab.classList.toggle("is-locked", !isThemeUnlocked(tab.dataset.themeShortcut));
  });
}

function renderThemes() {
  els.themeList.innerHTML = THEMES.map(
    (theme, index) => {
      const locked = !isThemeUnlocked(theme.id);
      const previous = THEMES[index - 1];
      const progress = themeProgress(theme.id);
      const unlockHint = locked ? `通关 ${previous?.name || "前置主题"} 解锁` : progress >= THEME_UNLOCK_TARGET ? "已解锁" : `进度 ${Math.floor(progress)}%`;
      return `
      <button class="theme-card theme-${theme.id} ${theme.id === state.themeId ? "is-active" : ""} ${locked ? "is-locked" : ""}" data-theme-id="${theme.id}" ${locked ? "aria-disabled=\"true\"" : ""}>
        <span class="theme-icon">${theme.icon}</span>
        <span>
          <strong>${theme.name}</strong>
          <small>${unlockHint}</small>
        </span>
      </button>
    `;
    },
  ).join("");
}

function renderPaytable() {
  const theme = currentTheme();
  els.paytable.innerHTML = theme.symbols
    .slice(0, 5)
    .map((symbol) => `<li><span>${symbol.glyph} ${symbol.label}</span><strong>x${symbol.payout[4]}</strong></li>`)
    .join("");
}

function weightedSymbol(theme) {
  const total = theme.symbols.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = Math.random() * total;
  for (const symbol of theme.symbols) {
    roll -= symbol.weight;
    if (roll <= 0) return symbol;
  }
  return theme.symbols.at(-1);
}

function randomBoard(theme) {
  return Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => weightedSymbol(theme)));
}

function spinStrip(theme, finalColumn) {
  return [...Array.from({ length: 6 }, () => weightedSymbol(theme)), ...finalColumn];
}

function symbolMarkup(symbol, extraClass = "") {
  return `
    <div class="symbol symbol-${symbol.id} ${extraClass}" data-symbol="${symbol.id}">
      <span class="symbol-art" aria-hidden="true"></span>
      <span class="glyph">${symbol.glyph}</span>
      <small>${symbol.label}</small>
    </div>
  `;
}

function renderBoard(board, spinningColumns = []) {
  els.reels.innerHTML = board
    .map(
      (column, colIndex) => `
        <div class="reel ${spinningColumns.includes(colIndex) ? "is-spinning" : ""}" style="--delay:${colIndex * 90}ms">
          ${column
            .map((symbol) => symbolMarkup(symbol))
            .join("")}
        </div>
      `,
    )
    .join("");
}

function renderSpinStrips(finalBoard, theme) {
  els.reels.innerHTML = finalBoard
    .map((column, colIndex) => {
      const strip = spinStrip(theme, column);
      return `
        <div class="reel is-rolling" style="--delay:${colIndex * 90}ms">
          <div class="reel-strip">
            ${strip.map((symbol, index) => symbolMarkup(symbol, index >= strip.length - 3 ? "is-final" : "")).join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function syncRollingReelMetrics() {
  const reels = [...els.reels.querySelectorAll(".reel.is-rolling")];
  for (const reel of reels) {
    const styles = window.getComputedStyle(reel);
    const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
    const rowHeight = Math.max(1, (reel.clientHeight - gap * 2) / 3);
    reel.style.setProperty("--reel-row-height", `${rowHeight}px`);
    reel.style.setProperty("--reel-row-gap", `${gap}px`);
  }
}

function evaluate(board, bet, lineCount = currentLineCount()) {
  const wins = [];
  let total = 0;

  for (const [lineIndex, line] of PAYLINES.slice(0, lineCount).entries()) {
    const rowSymbols = line.map((row, col) => board[col][row]);
    const base = rowSymbols.find((symbol) => symbol.id !== "wild") || rowSymbols[0];
    if (base.id === "scatter") continue;

    let count = 0;
    for (const symbol of rowSymbols) {
      if (symbol.id === base.id || symbol.id === "wild") count += 1;
      else break;
    }

    if (count >= 3) {
      const multiplier = base.payout[count - 1] || 0;
      const amount = multiplier * bet;
      total += amount;
      wins.push({ lineIndex, symbol: base, count, amount, multiplier });
    }
  }

  const scatters = board.flat().filter((symbol) => symbol.id === "scatter").length;
  let freeSpinsWon = 0;
  if (scatters >= 3) {
    freeSpinsWon = scatters + 5;
    const scatterMultiplier = scatters * 2.4;
    const scatterPay = Math.round(scatterMultiplier * bet * lineCount);
    total += scatterPay;
    wins.push({ lineIndex: -1, symbol: { label: "SCATTER", glyph: "✦" }, count: scatters, amount: scatterPay, multiplier: scatterMultiplier * lineCount });
  }

  return { total, wins, freeSpinsWon, scatters, lineCount };
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  fx.width = window.innerWidth;
  fx.height = window.innerHeight;
  els.canvas.width = Math.floor(fx.width * ratio);
  els.canvas.height = Math.floor(fx.height * ratio);
  fx.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function ensureAudio() {
  if (state.muted) return null;
  if (!audio.ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audio.ctx = new AudioContext();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.32;
    audio.master.connect(audio.ctx.destination);
    audio.noiseBuffer = audio.ctx.createBuffer(1, audio.ctx.sampleRate * 0.5, audio.ctx.sampleRate);
    const data = audio.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  return audio.ctx;
}

function tone(freq, duration = 0.12, type = "sine", volume = 0.25, when = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function noiseHit(duration = 0.12, volume = 0.2, cutoff = 1400, when = 0) {
  const ctx = ensureAudio();
  if (!ctx || !audio.noiseBuffer) return;
  const start = ctx.currentTime + when;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = audio.noiseBuffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(cutoff, start);
  filter.Q.value = 8;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  source.start(start);
  source.stop(start + duration);
}

function spinTiming() {
  const firstStopDelay = state.turbo ? 420 : 850;
  const stopGap = state.turbo ? 150 : 330;
  const stopDuration = state.turbo ? 260 : 450;
  return {
    firstStopDelay,
    stopGap,
    stopDuration,
    loopDuration: state.turbo ? 115 : 150,
    totalDuration: firstStopDelay + stopDuration + (stopGap + stopDuration) * (5 - 1),
  };
}

function startSpinSound(totalDuration = spinTiming().totalDuration) {
  const ctx = ensureAudio();
  if (!ctx || audio.spinOsc) return;
  const now = ctx.currentTime;
  tone(220, 0.32, "sawtooth", 0.1);
  tone(820, 0.18, "triangle", 0.055, 0.12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const noise = ctx.createBufferSource();
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(58, now);
  osc.frequency.exponentialRampToValueAtTime(state.turbo ? 182 : 132, now + 0.42);
  osc.frequency.exponentialRampToValueAtTime(state.turbo ? 112 : 82, now + totalDuration / 1000);
  filter.type = "lowpass";
  filter.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.11, now + 0.08);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);

  noise.buffer = audio.noiseBuffer;
  noise.loop = true;
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(state.turbo ? 1800 : 1380, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(state.turbo ? 1120 : 820, now + totalDuration / 1000);
  noiseFilter.Q.value = 1.2;
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(state.turbo ? 0.072 : 0.105, now + 0.12);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audio.master);

  osc.start();
  noise.start();
  audio.spinOsc = osc;
  audio.spinGain = gain;
  audio.spinNoise = noise;
  audio.spinNoiseGain = noiseGain;
  scheduleSpinTicks(totalDuration);
  noiseHit(0.18, 0.16, 900);
}

function stopSpinSound() {
  const ctx = audio.ctx;
  if (!ctx) return;
  if (audio.spinOsc && audio.spinGain) {
    audio.spinGain.gain.cancelScheduledValues(ctx.currentTime);
    audio.spinGain.gain.setValueAtTime(Math.max(audio.spinGain.gain.value, 0.001), ctx.currentTime);
    audio.spinGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    audio.spinOsc.stop(ctx.currentTime + 0.22);
  }
  if (audio.spinNoise && audio.spinNoiseGain) {
    audio.spinNoiseGain.gain.cancelScheduledValues(ctx.currentTime);
    audio.spinNoiseGain.gain.setValueAtTime(Math.max(audio.spinNoiseGain.gain.value, 0.001), ctx.currentTime);
    audio.spinNoiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    audio.spinNoise.stop(ctx.currentTime + 0.24);
  }
  audio.spinOsc = null;
  audio.spinGain = null;
  audio.spinNoise = null;
  audio.spinNoiseGain = null;
}

function scheduleSpinTicks(totalDuration) {
  const step = state.turbo ? 0.058 : 0.08;
  const seconds = totalDuration / 1000;
  const count = Math.floor(seconds / step);
  for (let i = 0; i < count; i += 1) {
    const t = 0.04 + i * step;
    const phase = i / Math.max(1, count - 1);
    const shimmer = i % 5 === 0 ? 140 : i % 3 === 0 ? 72 : 0;
    const pitch = 680 + (i % 8) * 34 + shimmer - phase * 110;
    const volume = (state.turbo ? 0.027 : 0.033) * (1 - phase * 0.28);
    tone(pitch, 0.024, i % 4 === 0 ? "triangle" : "square", volume, t);
    if (i % 4 === 0) noiseHit(0.028, 0.026, 2100 + (i % 6) * 170, t + 0.006);
  }
}

function playButtonSound() {
  tone(420, 0.07, "triangle", 0.18);
  tone(780, 0.08, "sine", 0.11, 0.035);
}

function playReelStop(index) {
  tone(128 - index * 7, 0.16, "sine", 0.22);
  tone(540 + index * 72, 0.055, "triangle", 0.14, 0.018);
  tone(1040 + index * 120, 0.045, "sine", 0.07, 0.04);
  noiseHit(0.075, 0.14, 1600 + index * 260);
}

function playCoinCascade(count = 10, start = 0) {
  const notes = [988, 1175, 1318, 1568, 1760, 2093];
  for (let i = 0; i < count; i += 1) {
    const delay = start + i * 0.031;
    tone(notes[i % notes.length] * (i % 4 === 0 ? 0.5 : 1), 0.075, i % 2 ? "triangle" : "sine", 0.092, delay);
    if (i % 2 === 0) noiseHit(0.038, 0.04, 3200 + i * 95, delay);
  }
}

function playFreeSpinSound() {
  [659, 784, 988, 1318, 1568, 1976].forEach((note, index) => tone(note, 0.12, "sine", 0.12, index * 0.055));
  playCoinCascade(14, 0.12);
}

function playWinSound(mega = false) {
  const notes = mega ? [523, 659, 784, 1046, 1318, 1568] : [523, 659, 784, 988];
  notes.forEach((note, index) => tone(note, 0.15 + index * 0.018, "triangle", mega ? 0.17 : 0.12, index * 0.055));
  playCoinCascade(mega ? 24 : 12, 0.08);
  if (mega) {
    noiseHit(0.42, 0.2, 2600, 0.08);
    tone(98, 0.5, "sawtooth", 0.1, 0.02);
    [523, 659, 784, 1046].forEach((note) => tone(note, 0.42, "sine", 0.055, 0.22));
  }
}

async function animateReels(finalBoard, theme) {
  renderSpinStrips(finalBoard, theme);
  const reels = [...els.reels.querySelectorAll(".reel")];
  const { firstStopDelay, stopGap, stopDuration, loopDuration } = spinTiming();
  const scatterCount = finalBoard.flat().filter((symbol) => symbol.id === "scatter").length;
  els.machine.classList.add("is-reel-spinning");

  await new Promise((resolve) => requestAnimationFrame(resolve));
  syncRollingReelMetrics();

  const loopAnimations = reels.map((reel) => {
    const strip = reel.querySelector(".reel-strip");
    const rowHeight = Number.parseFloat(reel.style.getPropertyValue("--reel-row-height")) || (reel.clientHeight / 3);
    const gap = Number.parseFloat(reel.style.getPropertyValue("--reel-row-gap")) || 0;
    const cycleDistance = (rowHeight + gap) * 3;
    strip.style.transform = "translate3d(0, 0, 0)";
    reel.classList.add("is-speeding");
    return strip.animate(
      [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(0, -${cycleDistance}px, 0)` },
      ],
      {
        duration: loopDuration,
        easing: "linear",
        iterations: Infinity,
      },
    );
  });

  const stopReel = (reel, index) =>
    new Promise((resolve) => {
      const strip = reel.querySelector(".reel-strip");
      const rowHeight = Number.parseFloat(reel.style.getPropertyValue("--reel-row-height")) || (reel.clientHeight / 3);
      const gap = Number.parseFloat(reel.style.getPropertyValue("--reel-row-gap")) || 0;
      const cycleDistance = (rowHeight + gap) * 3;
      loopAnimations[index]?.cancel();
      strip.innerHTML = [
        ...finalBoard[index].map((symbol) => symbolMarkup(symbol, "is-final")),
        ...Array.from({ length: 3 }, () => symbolMarkup(weightedSymbol(theme))),
      ].join("");
      strip.style.transform = `translate3d(0, -${cycleDistance}px, 0)`;
      const landing = strip.animate(
        [
          { transform: `translate3d(0, -${cycleDistance}px, 0)` },
          { transform: "translate3d(0, 18px, 0)", offset: 0.82 },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: stopDuration,
          easing: reelStopEase,
          fill: "forwards",
        },
      );
      landing.finished.then(() => {
        reel.classList.remove("is-speeding");
        reel.classList.remove("is-anticipating");
        reel.classList.add("is-stopped");
        playReelStop(index);
        setTimeout(() => reel.classList.remove("is-stopped"), 360);
        resolve();
      });
    });

  for (const [index, reel] of reels.entries()) {
    let waitTime = index === 0 ? firstStopDelay : stopGap;
    if (scatterCount >= 2 && index >= 3 && !state.turbo) {
      reel.classList.add("is-anticipating");
      waitTime += 820;
    }
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    await stopReel(reel, index);
  }

  loopAnimations.forEach((animation) => animation.cancel());
  els.machine.classList.remove("is-reel-spinning");
}

function spawnBurst(kind, amount = 120) {
  const theme = currentTheme();
  const palette = {
    goldstorm: ["#ffe27a", "#ff9a1f", "#ffffff", theme.accent],
    sunburst: ["#ffd45a", "#ff7133", "#fff6bf", "#19e0a7"],
    quake: ["#24ffa8", "#ffb000", "#f9ff8a", "#3f2d16"],
    blizzard: ["#d9fdff", "#86f8ff", "#b28cff", "#ffffff"],
    inferno: ["#ff5a1f", "#ffd05a", "#fff1b0", "#b5002f"],
  }[kind] || ["#fff", theme.accent, theme.second];

  const originX = fx.width * (0.42 + Math.random() * 0.18);
  const originY = fx.height * (0.28 + Math.random() * 0.28);
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * (kind === "blizzard" ? 5 : 12);
    fx.particles.push({
      x: originX + (Math.random() - 0.5) * 180,
      y: originY + (Math.random() - 0.5) * 120,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * 3,
      life: 50 + Math.random() * 90,
      maxLife: 90,
      size: 2 + Math.random() * (kind === "blizzard" ? 5 : 9),
      color: palette[Math.floor(Math.random() * palette.length)],
      shape: Math.random() > 0.65 ? "coin" : "spark",
      gravity: kind === "blizzard" ? 0.01 : 0.12,
      spin: Math.random() * 8,
    });
  }
  if (fx.particles.length > 420) {
    fx.particles.splice(0, fx.particles.length - 420);
  }
}

function spawnCoinShower(mega = false) {
  const amount = mega ? 260 : 130;
  const colors = ["#fff4a8", "#ffd45a", "#ff981f", "#ffffff", currentTheme().accent];
  for (let i = 0; i < amount; i += 1) {
    const fromTop = Math.random() > 0.34;
    fx.particles.push({
      x: fromTop ? Math.random() * fx.width : fx.width * (0.28 + Math.random() * 0.44),
      y: fromTop ? -30 - Math.random() * 240 : fx.height * (0.25 + Math.random() * 0.22),
      vx: (Math.random() - 0.5) * (fromTop ? 3.6 : 12),
      vy: fromTop ? 3 + Math.random() * 7 : -6 - Math.random() * 7,
      life: mega ? 105 + Math.random() * 90 : 80 + Math.random() * 60,
      maxLife: mega ? 150 : 110,
      size: 4 + Math.random() * (mega ? 9 : 7),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.18 ? "coin" : "spark",
      gravity: fromTop ? 0.12 : 0.2,
      spin: Math.random() * 8,
    });
  }
  if (fx.particles.length > 520) {
    fx.particles.splice(0, fx.particles.length - 520);
  }
}

function showWinSplash(amount, mega) {
  const node = document.createElement("div");
  node.className = `win-splash ${mega ? "is-mega" : ""}`;
  node.innerHTML = `<span>${mega ? "MEGA WIN" : "BIG WIN"}</span><strong>+${format.format(amount)}</strong>`;
  document.body.append(node);
  window.setTimeout(() => node.classList.add("is-leaving"), mega ? 1700 : 1250);
  window.setTimeout(() => node.remove(), mega ? 2300 : 1800);
}

function showUnlockSplash(theme) {
  const node = document.createElement("div");
  node.className = "win-splash unlock-splash is-mega";
  node.innerHTML = `<span>NEW STAGE UNLOCKED</span><strong>${theme.name}</strong><em>${theme.subtitle}</em>`;
  document.body.append(node);
  window.setTimeout(() => node.classList.add("is-leaving"), 2600);
  window.setTimeout(() => node.remove(), 3300);
}

function awardThemeProgress(result) {
  const theme = currentTheme();
  const nextTheme = nextLockedTheme(theme.id);
  if (!nextTheme) return;

  const mega = result.total >= currentBet() * 250 || result.wins.some((win) => win.count >= 5);
  const earned =
    7 +
    result.wins.length * 7 +
    (result.total > 0 ? 8 : 0) +
    result.freeSpinsWon * 4 +
    (mega ? 25 : 0);
  const current = themeProgress(theme.id);
  const nextProgress = Math.min(THEME_UNLOCK_TARGET, current + earned);
  state.themeProgress[theme.id] = nextProgress;

  if (current < THEME_UNLOCK_TARGET && nextProgress >= THEME_UNLOCK_TARGET) {
    unlockTheme(nextTheme);
  }
}

function unlockTheme(theme) {
  if (state.unlockedThemes.includes(theme.id)) return;
  state.unlockedThemes.push(theme.id);
  state.themeProgress[theme.id] = 0;
  showUnlockSplash(theme);
  toast("新关卡解锁！", `「${theme.name}」已经开放，点击主题卡进入。`);
  spawnBurst(theme.effect, 340);
  spawnCoinShower(true);
  playFreeSpinSound();
  renderThemes();
  renderShell();
}

function fxLoop() {
  fx.ctx.clearRect(0, 0, fx.width, fx.height);
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];
    p.life -= 1;
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.spin += 0.2;
    const alpha = Math.max(0, p.life / p.maxLife);
    fx.ctx.save();
    fx.ctx.globalAlpha = alpha;
    fx.ctx.translate(p.x, p.y);
    fx.ctx.rotate(p.spin);
    fx.ctx.fillStyle = p.color;
    fx.ctx.shadowColor = p.color;
    fx.ctx.shadowBlur = p.shape === "coin" ? 12 : 8;
    if (p.shape === "coin") {
      fx.ctx.beginPath();
      fx.ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.75, 0, 0, Math.PI * 2);
      fx.ctx.fill();
    } else {
      fx.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    fx.ctx.restore();
    if (p.life <= 0) fx.particles.splice(i, 1);
  }
  requestAnimationFrame(fxLoop);
}

function toast(title, detail = "") {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${title}</strong>${detail ? `<span>${detail}</span>` : ""}`;
  els.toastStack.append(node);
  setTimeout(() => node.classList.add("is-leaving"), 2600);
  setTimeout(() => node.remove(), 3200);
}

function pulseWin(result, spend) {
  const theme = currentTheme();
  const net = result.total - spend;
  els.winBanner.classList.remove("is-mega", "is-win");
  void els.winBanner.offsetWidth;

  if (result.total > 0) {
    const mega = result.total >= currentBet() * 250 || result.wins.some((win) => win.count >= 5);
    els.winTitle.textContent = mega ? "MEGA BLAST" : "WIN";
    els.winAmount.textContent = `+${format.format(result.total)}`;
    els.winBanner.classList.add(mega ? "is-mega" : "is-win");
    els.machine.classList.add(mega ? "is-mega-hit" : "is-small-hit");
    els.shell.classList.add("screen-shake");
    setTimeout(() => els.shell.classList.remove("screen-shake"), 700);
    setTimeout(() => els.machine.classList.remove("is-mega-hit", "is-small-hit"), mega ? 1600 : 900);
    spawnBurst(theme.effect, mega ? 260 : 130);
    spawnCoinShower(mega);
    showWinSplash(result.total, mega);
    playWinSound(mega);
    toast(mega ? "爆炸大奖！" : "中奖！", `${result.wins.length} 条高光 · 净收益 ${format.format(net)}`);
  } else {
    els.winTitle.textContent = "再来一把";
    els.winAmount.textContent = "LUCK CHARGING";
    tone(160, 0.08, "triangle", 0.08);
  }

  if (result.freeSpinsWon > 0) {
    toast("免费旋转触发", `获得 ${result.freeSpinsWon} 次免费局`);
    playFreeSpinSound();
    spawnBurst("blizzard", 180);
  }
}

function clearHighlights() {
  window.clearTimeout(state.linePreviewTimer);
  state.linePreviewTimer = 0;
  document.querySelectorAll(".symbol.is-hit").forEach((node) => node.classList.remove("is-hit"));
  els.paylineOverlay.innerHTML = "";
  els.paylineOverlay.classList.remove("is-active");
}

function appendPaylineDefs() {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <linearGradient id="paylineGold" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#fff7bc" stop-opacity="0"/>
      <stop offset="22%" stop-color="#ff36dc"/>
      <stop offset="50%" stop-color="#fff5a8"/>
      <stop offset="76%" stop-color="#20efff"/>
      <stop offset="100%" stop-color="#fff7bc" stop-opacity="0"/>
    </linearGradient>
    <filter id="paylineGlow" x="-30%" y="-80%" width="160%" height="260%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  `;
  els.paylineOverlay.append(defs);
}

function paylinePoints(reels, overlayRect, line, count = 5) {
  const points = [];
  for (let col = 0; col < count; col += 1) {
    const symbol = reels[col]?.querySelectorAll(".symbol")?.[line[col]];
    if (symbol) {
      const rect = symbol.getBoundingClientRect();
      points.push(`${rect.left + rect.width / 2 - overlayRect.left},${rect.top + rect.height / 2 - overlayRect.top}`);
    }
  }
  return points;
}

function previewActiveLines() {
  window.clearTimeout(state.linePreviewTimer);
  els.paylineOverlay.innerHTML = "";
  appendPaylineDefs();
  const reels = [...els.reels.querySelectorAll(".reel")];
  const overlayRect = els.paylineOverlay.getBoundingClientRect();
  PAYLINES.slice(0, currentLineCount()).forEach((line, lineIndex) => {
    const points = paylinePoints(reels, overlayRect, line);
    if (points.length >= 3) drawPayline(points, lineIndex, "preview");
  });
  els.paylineOverlay.classList.add("is-active", "is-previewing");
  state.linePreviewTimer = window.setTimeout(() => {
    els.paylineOverlay.innerHTML = "";
    els.paylineOverlay.classList.remove("is-active", "is-previewing");
  }, 1350);
}

function highlightWins(board, wins) {
  clearHighlights();
  const reels = [...els.reels.querySelectorAll(".reel")];
  const overlayRect = els.paylineOverlay.getBoundingClientRect();
  appendPaylineDefs();

  for (const win of wins) {
    if (win.lineIndex < 0) {
      document.querySelectorAll('[data-symbol="scatter"]').forEach((node) => node.classList.add("is-hit"));
      continue;
    }
    const line = PAYLINES[win.lineIndex];
    for (let col = 0; col < win.count; col += 1) {
      const symbol = reels[col]?.querySelectorAll(".symbol")?.[line[col]];
      symbol?.classList.add("is-hit");
    }
    const points = paylinePoints(reels, overlayRect, line, win.count);
    if (points.length >= 3) drawPayline(points, win.lineIndex);
  }
  if (wins.length > 0) els.paylineOverlay.classList.add("is-active");
}

function drawPayline(points, lineIndex, mode = "win") {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", `payline-burst payline-${lineIndex} ${mode === "preview" ? "payline-preview" : ""}`);

  const under = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  under.setAttribute("points", points.join(" "));
  under.setAttribute("class", "payline-under");
  group.append(under);

  const main = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  main.setAttribute("points", points.join(" "));
  main.setAttribute("class", "payline-main");
  group.append(main);

  points.forEach((point, index) => {
    const [cx, cy] = point.split(",").map(Number);
    const spark = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    spark.setAttribute("cx", cx);
    spark.setAttribute("cy", cy);
    spark.setAttribute("r", index === 0 || index === points.length - 1 ? 7 : 5);
    spark.setAttribute("class", "payline-spark");
    group.append(spark);
  });

  els.paylineOverlay.append(group);
}

async function spin() {
  if (state.spinning) return;
  playButtonSound();
  const bet = currentBet();
  const lineCount = currentLineCount();
  const lineCost = bet * lineCount;
  const isFree = state.freeSpins > 0;
  if (!isFree && state.balance < lineCost) {
    toast("金币不够啦", "点“爽充金币”可以立即加金币。");
    state.auto = false;
    renderShell();
    return;
  }

  state.spinning = true;
  clearHighlights();
  els.spinButton.disabled = true;
  els.machine.classList.add("is-armed");
  const theme = currentTheme();

  if (isFree) state.freeSpins -= 1;
  else state.balance -= lineCost;
  renderShell();

  const board = randomBoard(theme);
  startSpinSound(spinTiming().totalDuration);
  await animateReels(board, theme);
  stopSpinSound();
  renderBoard(board, []);
  const result = evaluate(board, bet, lineCount);
  state.balance += result.total;
  state.freeSpins += result.freeSpinsWon;
  state.heat = result.total > 0 ? Math.min(7, state.heat + 1) : Math.max(0, state.heat - 1);
  awardThemeProgress(result);
  state.spinning = false;
  els.spinButton.disabled = false;
  els.machine.classList.remove("is-armed");
  highlightWins(board, result.wins);
  pulseWin(result, isFree ? 0 : lineCost);
  renderShell();
  saveState();

  if (state.auto) {
    window.clearTimeout(state.autoTimer);
    state.autoTimer = window.setTimeout(spin, state.turbo ? 420 : 900);
  }
}

function setTheme(themeId) {
  if (!isThemeUnlocked(themeId)) {
    const target = THEMES.find((theme) => theme.id === themeId);
    const previous = THEMES[themeIndex(themeId) - 1];
    toast("关卡尚未解锁", `先把「${previous?.name || "前置关卡"}」进度打满，再开启「${target?.name || "新关卡"}」。`);
    spawnBurst("goldstorm", 40);
    return;
  }
  playButtonSound();
  state.themeId = themeId;
  state.heat = Math.max(0, state.heat - 1);
  renderThemes();
  renderPaytable();
  renderShell();
  renderBoard(randomBoard(currentTheme()), []);
  spawnBurst(currentTheme().effect, 80);
  saveState();
}

function addCoins() {
  playButtonSound();
  const gift = 50000 + Math.floor(Math.random() * 8) * 10000;
  state.balance += gift;
  toast("金币到账", `+${format.format(gift)}，放心爽玩。`);
  spawnBurst("goldstorm", 120);
  renderShell();
  saveState();
}

function bindEvents() {
  els.spinButton.addEventListener("click", spin);
  els.addCoins.addEventListener("click", addCoins);
  els.bankAdd.addEventListener("click", addCoins);
  els.betDown.addEventListener("click", () => {
    playButtonSound();
    state.betIndex = Math.max(0, state.betIndex - 1);
    renderShell();
    saveState();
  });
  els.betUp.addEventListener("click", () => {
    playButtonSound();
    state.betIndex = Math.min(BET_STEPS.length - 1, state.betIndex + 1);
    renderShell();
    saveState();
  });
  els.lineDown.addEventListener("click", () => {
    if (currentLineCount() <= 1) return;
    playButtonSound();
    state.lineCount = Math.max(1, currentLineCount() - 1);
    renderShell();
    previewActiveLines();
    saveState();
  });
  els.lineUp.addEventListener("click", () => {
    if (currentLineCount() >= PAYLINES.length) return;
    playButtonSound();
    state.lineCount = Math.min(PAYLINES.length, currentLineCount() + 1);
    renderShell();
    previewActiveLines();
    saveState();
  });
  els.autoButton.addEventListener("click", () => {
    playButtonSound();
    state.auto = !state.auto;
    renderShell();
    if (state.auto) spin();
    else window.clearTimeout(state.autoTimer);
  });
  els.turbo.addEventListener("click", () => {
    playButtonSound();
    state.turbo = !state.turbo;
    renderShell();
  });
  els.mute.addEventListener("click", () => {
    state.muted = !state.muted;
    if (state.muted) stopSpinSound();
    else playButtonSound();
    renderShell();
    toast(state.muted ? "静音模式" : "老虎机音效已开启", state.muted ? "已停止转轴和中奖音效。" : "包含滚轴、停轴、按钮、大奖合成音效。");
  });
  els.themeList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-theme-id]");
    if (card) setTheme(card.dataset.themeId);
  });
  document.querySelectorAll("[data-theme-shortcut]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeShortcut));
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      spin();
    }
  });
}

function init() {
  resizeCanvas();
  renderThemes();
  renderPaytable();
  renderShell();
  renderBoard(randomBoard(currentTheme()), []);
  bindEvents();
  fxLoop();
  spawnBurst("goldstorm", 80);
}

init();
