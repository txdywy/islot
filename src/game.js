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
  turbo: localStorage.getItem("islot-turbo") === "true",
  muted: localStorage.getItem("islot-muted") === "true",
  auto: false,
  autoTimer: 0,
  linePreviewTimer: 0,
  themeReelStrips: {},
  reelStopIndices: [0, 0, 0, 0, 0],
};

const audio = {
  ctx: null,
  master: null,
  delay: null,
  delayGain: null,
  delayFeedback: null,
  compressor: null,
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
  confettiCanvas: document.querySelector("#confettiCanvas"),
  canvas: document.querySelector("#fxCanvas"),
};

const fx = {
  ctx: els.canvas.getContext("2d"),
  particles: [],
  width: 0,
  height: 0,
  low: false,
  frame: 0,
  reelsRect: null,
  anticipatingRects: [],
};

const confettiFx = {
  emit: null,
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

function detectLowFx() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return Boolean(reducedMotion || window.innerWidth < 768 || cores <= 4 || memory <= 4);
}

function updateFxQuality() {
  fx.low = detectLowFx();
  document.documentElement.classList.toggle("is-low-fx", fx.low);
}

function fxAmount(amount) {
  return Math.max(1, Math.round(amount * (fx.low ? 0.48 : 0.74)));
}

function fxCap(cap) {
  const isMobile = window.innerWidth < 768;
  return Math.min(cap, fx.low ? (isMobile ? 135 : 260) : (isMobile ? 180 : 430));
}

function scheduleParticles(factory, amount, cap) {
  const count = fxAmount(amount);
  const batchSize = fx.low ? 18 : 34;
  let created = 0;

  function emitBatch() {
    const end = Math.min(count, created + batchSize);
    for (; created < end; created += 1) pushParticle(factory(created));
    trimParticles(fxCap(cap));
    if (created < count) {
      window.setTimeout(emitBatch, fx.low ? 34 : 24);
    }
  }

  emitBatch();
  startFxLoop();
}

function initConfettiFx() {
  if (!window.confetti || !els.confettiCanvas) return;
  confettiFx.emit = window.confetti.create(els.confettiCanvas, {
    resize: true,
    useWorker: true,
    disableForReducedMotion: true,
  });
}

function launchPrizeConfetti(tier = "small") {
  if (!confettiFx.emit && window.confetti && els.confettiCanvas) initConfettiFx();
  const emit = confettiFx.emit || window.confetti;
  if (!emit) {
    spawnTreasureRain(tier);
    return;
  }

  const theme = currentTheme();
  const isMobile = window.innerWidth < 768;
  const presets = {
    small: { bursts: 2, particles: isMobile ? 28 : 46, spread: 62, scalar: isMobile ? 0.74 : 0.92, velocity: 46 },
    big: { bursts: 4, particles: isMobile ? 34 : 64, spread: 78, scalar: isMobile ? 0.82 : 1.04, velocity: 56 },
    mega: { bursts: 6, particles: isMobile ? 42 : 82, spread: 92, scalar: isMobile ? 0.9 : 1.18, velocity: 66 },
  };
  const preset = presets[tier] || presets.small;
  const colors = ["#fff4a8", "#ffd45a", "#ff981f", "#ffffff", "#72ff9c", theme.accent, theme.second || theme.accent];
  const shapes = ["circle", "square", "star"];

  for (let i = 0; i < preset.bursts; i += 1) {
    window.setTimeout(() => {
      const side = i % 2 === 0 ? 0.18 : 0.82;
      emit({
        particleCount: Math.round(preset.particles * (fx.low ? 0.68 : 1)),
        spread: preset.spread,
        startVelocity: preset.velocity,
        decay: 0.91,
        gravity: 0.92,
        ticks: fx.low ? 115 : 155,
        scalar: preset.scalar,
        shapes,
        colors,
        origin: {
          x: i === 0 ? 0.5 : side + (Math.random() - 0.5) * 0.12,
          y: i < 2 ? 0.32 : 0.18 + Math.random() * 0.22,
        },
        angle: i === 0 ? 90 : (side < 0.5 ? 56 : 124),
      });
    }, i * (fx.low ? 120 : 86));
  }
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
  localStorage.setItem("islot-turbo", String(state.turbo));
  localStorage.setItem("islot-muted", String(state.muted));
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

function generateThemeReelStrips(theme) {
  const strips = [];
  for (let col = 0; col < 5; col += 1) {
    const strip = [];
    theme.symbols.forEach((sym) => {
      const count = Math.max(1, Math.round(sym.weight * 1.5));
      for (let k = 0; k < count; k += 1) {
        strip.push(sym);
      }
    });
    for (let i = strip.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [strip[i], strip[j]] = [strip[j], strip[i]];
    }
    strips.push(strip);
  }
  return strips;
}

function randomBoard(theme) {
  if (state.themeReelStrips && state.themeReelStrips[theme.id]) {
    const strips = state.themeReelStrips[theme.id];
    return state.reelStopIndices.map((stopIndex, colIndex) => {
      const strip = strips[colIndex];
      return [
        strip[stopIndex % strip.length],
        strip[(stopIndex + 1) % strip.length],
        strip[(stopIndex + 2) % strip.length]
      ];
    });
  }
  return Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => weightedSymbol(theme)));
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

function renderSpinStrips(theme, scrollCounts) {
  const strips = state.themeReelStrips[theme.id];
  els.reels.innerHTML = strips
    .map((strip, colIndex) => {
      const startIndex = state.reelStopIndices[colIndex];
      const scrollCount = scrollCounts[colIndex];
      const scrollSymbols = [];
      for (let k = 0; k < scrollCount + 3; k += 1) {
        const sym = strip[(startIndex + k) % strip.length];
        const extraClass = (k >= scrollCount) ? "is-final" : "";
        scrollSymbols.push({ sym, extraClass });
      }
      return `
        <div class="reel is-rolling" style="--delay:${colIndex * 90}ms">
          <div class="reel-strip">
            ${scrollSymbols.map((item) => symbolMarkup(item.sym, item.extraClass)).join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function syncAllReelMetrics() {
  const reels = [...els.reels.querySelectorAll(".reel")];
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

let resizeTimer = 0;
function resizeCanvas() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(_doResize, 100);
}
function _doResize() {
  const isMobile = window.innerWidth < 768;
  updateFxQuality();
  const ratio = Math.min(fx.low ? 1.15 : (isMobile ? 1.35 : 1.65), window.devicePixelRatio || 1);
  fx.width = document.documentElement.clientWidth;
  fx.height = document.documentElement.clientHeight;
  els.canvas.width = Math.floor(fx.width * ratio);
  els.canvas.height = Math.floor(fx.height * ratio);
  fx.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  fx.reelsRect = null;
  fx.anticipatingRects = [];
  syncAllReelMetrics();
}

const THEME_SCALES = {
  vegas: [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51], // C Major Pentatonic (C5 - E6)
  egypt: [493.88, 523.25, 622.25, 659.25, 739.99, 783.99, 987.77, 1046.50], // E Phrygian Dominant (E5, F5, G#5, A5, B5, C6, D#6, E6)
  maya: [440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66], // A Minor Pentatonic (A4 - D6)
  arctic: [587.33, 659.25, 783.99, 880.00, 987.77, 1174.66, 1318.51, 1567.98], // D Major Pentatonic / Crystal (D5 - G6)
  dragon: [392.00, 466.16, 523.25, 587.33, 698.46, 783.99, 932.33, 1046.50]  // G Minor Pentatonic (G4 - C6)
};

function ensureAudio() {
  if (state.muted) return null;
  if (!audio.ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audio.ctx = new AudioContext();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.32;
    
    // Dynamics Compressor to glue sound and avoid clipping
    audio.compressor = audio.ctx.createDynamicsCompressor();
    audio.compressor.threshold.setValueAtTime(-12, audio.ctx.currentTime);
    audio.compressor.knee.setValueAtTime(30, audio.ctx.currentTime);
    audio.compressor.ratio.setValueAtTime(12, audio.ctx.currentTime);
    audio.compressor.attack.setValueAtTime(0.003, audio.ctx.currentTime);
    audio.compressor.release.setValueAtTime(0.08, audio.ctx.currentTime);
    
    // Lush Echo / Delay line
    audio.delay = audio.ctx.createDelay(1.0);
    audio.delayFeedback = audio.ctx.createGain();
    audio.delayGain = audio.ctx.createGain();
    
    audio.delay.delayTime.value = 0.16;
    audio.delayFeedback.gain.value = 0.35;
    audio.delayGain.gain.value = 0.5;
    
    audio.delay.connect(audio.delayFeedback);
    audio.delayFeedback.connect(audio.delay);
    audio.delay.connect(audio.master);
    
    audio.master.connect(audio.compressor);
    audio.compressor.connect(audio.ctx.destination);
    
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

function fmTone(carrierFreq, modFreqRatio, modIndexStart, modIndexEnd, duration, volume, type = "sine", when = 0, sendToDelay = false) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + when;
  
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const carrierGain = ctx.createGain();
  
  carrier.type = type;
  modulator.type = "sine";
  
  carrier.frequency.setValueAtTime(carrierFreq, start);
  modulator.frequency.setValueAtTime(carrierFreq * modFreqRatio, start);
  
  modGain.gain.setValueAtTime(carrierFreq * modFreqRatio * modIndexStart, start);
  modGain.gain.exponentialRampToValueAtTime(Math.max(0.001, carrierFreq * modFreqRatio * modIndexEnd), start + duration);
  
  carrierGain.gain.setValueAtTime(0.0001, start);
  carrierGain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
  carrierGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(carrierGain);
  
  carrierGain.connect(audio.master);
  if (sendToDelay && audio.delay) {
    carrierGain.connect(audio.delay);
  }
  
  modulator.start(start);
  carrier.start(start);
  
  modulator.stop(start + duration + 0.05);
  carrier.stop(start + duration + 0.05);
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
  
  // Starting sweep chimes
  fmTone(600, 1.414, 1.5, 0.1, 0.22, 0.12, "sine", 0, true);
  fmTone(900, 2.0, 1.0, 0.05, 0.18, 0.07, "sine", 0.05, true);
  
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  
  osc1.type = "triangle";
  osc2.type = "triangle";
  
  osc1.frequency.setValueAtTime(110, now);
  osc1.frequency.linearRampToValueAtTime(80, now + totalDuration / 1000);
  
  osc2.frequency.setValueAtTime(55, now);
  osc2.frequency.linearRampToValueAtTime(40, now + totalDuration / 1000);
  
  filter.type = "lowpass";
  filter.frequency.value = 160;
  
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.15);
  
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  
  osc1.start();
  osc2.start();
  
  audio.spinOsc = [osc1, osc2];
  audio.spinGain = gain;
  
  const noise = ctx.createBufferSource();
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();
  
  noise.buffer = audio.noiseBuffer;
  noise.loop = true;
  
  noiseFilter.type = "bandpass";
  noiseFilter.Q.value = 1.0;
  noiseFilter.frequency.setValueAtTime(1000, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(450, now + totalDuration / 1000);
  
  noiseGain.gain.setValueAtTime(0.001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.05, now + 0.2);
  
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audio.master);
  
  noise.start();
  
  audio.spinNoise = noise;
  audio.spinNoiseGain = noiseGain;
  
  scheduleSpinTicks(totalDuration);
  noiseHit(0.15, 0.12, 1000);
}

function stopSpinSound() {
  const ctx = audio.ctx;
  if (!ctx) return;
  if (audio.spinOsc && audio.spinGain) {
    audio.spinGain.gain.cancelScheduledValues(ctx.currentTime);
    audio.spinGain.gain.setValueAtTime(Math.max(audio.spinGain.gain.value, 0.001), ctx.currentTime);
    audio.spinGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    const oscillators = Array.isArray(audio.spinOsc) ? audio.spinOsc : [audio.spinOsc];
    oscillators.forEach(osc => {
      try { osc.stop(ctx.currentTime + 0.2); } catch (e) {}
    });
  }
  if (audio.spinNoise && audio.spinNoiseGain) {
    audio.spinNoiseGain.gain.cancelScheduledValues(ctx.currentTime);
    audio.spinNoiseGain.gain.setValueAtTime(Math.max(audio.spinNoiseGain.gain.value, 0.001), ctx.currentTime);
    audio.spinNoiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    try { audio.spinNoise.stop(ctx.currentTime + 0.2); } catch (e) {}
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
    const volume = (state.turbo ? 0.024 : 0.028) * (1 - phase * 0.35);
    const tickFilterCutoff = 2200 - phase * 500;
    noiseHit(0.008, volume, tickFilterCutoff, t);
    tone(1500 - phase * 300, 0.005, "sine", volume * 0.4, t);
  }
}

function playButtonSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  noiseHit(0.012, 0.09, 2800);
  tone(880, 0.06, "sine", 0.14);
  tone(1320, 0.07, "sine", 0.08, 0.01);
}

function playReelStop(index) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const thudStart = ctx.currentTime;
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thudOsc.type = "triangle";
  thudOsc.frequency.setValueAtTime(140, thudStart);
  thudOsc.frequency.exponentialRampToValueAtTime(45, thudStart + 0.06);
  thudGain.gain.setValueAtTime(0.001, thudStart);
  thudGain.gain.exponentialRampToValueAtTime(0.25, thudStart + 0.006);
  thudGain.gain.exponentialRampToValueAtTime(0.001, thudStart + 0.08);
  thudOsc.connect(thudGain);
  thudGain.connect(audio.master);
  thudOsc.start(thudStart);
  thudOsc.stop(thudStart + 0.1);
  
  noiseHit(0.03, 0.12, 1300 + index * 90);
  
  const baseFreq = 650 + index * 75;
  tone(baseFreq, 0.16, "sine", 0.08);
  tone(baseFreq * 1.618, 0.12, "sine", 0.04, 0.005);
}

function playCoinCascade(count = 10, start = 0) {
  const notes = [988, 1175, 1318, 1568, 1760, 2093];
  for (let i = 0; i < count; i += 1) {
    const delay = start + i * 0.035;
    fmTone(
      notes[i % notes.length] * (i % 3 === 0 ? 0.75 : 1.2),
      1.5,
      2.0,
      0.0,
      0.08,
      0.075,
      "sine",
      delay,
      true
    );
    noiseHit(0.015, 0.05, 3200 + i * 80, delay);
  }
}

function playFreeSpinSound() {
  const theme = currentTheme();
  const scale = THEME_SCALES[theme.id] || THEME_SCALES.vegas;
  scale.forEach((note, index) => {
    fmTone(
      note * 1.5,
      2.0,
      2.5,
      0.01,
      0.35,
      0.11,
      "sine",
      index * 0.055,
      true
    );
  });
  playCoinCascade(16, 0.15);
}

function playWinSound(mega = false) {
  const theme = currentTheme();
  const scale = THEME_SCALES[theme.id] || THEME_SCALES.vegas;
  
  if (mega) {
    const ctx = ensureAudio();
    if (ctx) {
      noiseHit(0.55, 0.25, 700);
      const bassOsc = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bassOsc.type = "sawtooth";
      bassOsc.frequency.setValueAtTime(82, ctx.currentTime);
      bassOsc.frequency.exponentialRampToValueAtTime(41, ctx.currentTime + 0.55);
      
      bassGain.gain.setValueAtTime(0.001, ctx.currentTime);
      bassGain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      bassGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      
      bassOsc.connect(bassGain);
      bassGain.connect(audio.master);
      bassOsc.start();
      bassOsc.stop(ctx.currentTime + 0.55);
    }
    
    const chordIndices = [0, 2, 4, 7, 9, 11, 7, 9, 11, 14];
    const extendedScale = [...scale, ...scale.map(f => f * 2)];
    
    chordIndices.forEach((idx, i) => {
      const freq = extendedScale[idx] || scale[0];
      fmTone(
        freq,
        i % 2 === 0 ? 1.414 : 2.0,
        3.0,
        0.01,
        0.5,
        0.14,
        "triangle",
        i * 0.065,
        true
      );
    });
    playCoinCascade(32, 0.1);
  } else {
    const arpeggio = [0, 2, 4, 7];
    arpeggio.forEach((idx, i) => {
      const freq = scale[idx] || scale[0];
      fmTone(
        freq,
        2.0,
        1.5,
        0.01,
        0.28,
        0.12,
        "sine",
        i * 0.065,
        true
      );
    });
    playCoinCascade(12, 0.08);
  }
}

async function animateReels(finalBoard, theme, scrollCounts, nextStopIndices) {
  renderSpinStrips(theme, scrollCounts);
  const reels = [...els.reels.querySelectorAll(".reel")];
  els.machine.classList.add("is-reel-spinning");

  await new Promise((resolve) => requestAnimationFrame(resolve));
  syncAllReelMetrics();

  const promises = reels.map((reel, index) => {
    const stripEl = reel.querySelector(".reel-strip");
    const rowHeight = Number.parseFloat(reel.style.getPropertyValue("--reel-row-height")) || (reel.clientHeight / 3);
    const gap = Number.parseFloat(reel.style.getPropertyValue("--reel-row-gap")) || 0;
    const scrollCount = scrollCounts[index];
    const scrollDistance = scrollCount * (rowHeight + gap);

    let duration = state.turbo ? (320 + index * 100) : (1200 + index * 360);
    const scattersBefore = finalBoard.slice(0, index).flat().filter((symbol) => symbol.id === "scatter").length;
    const isAnt = index >= 3 && scattersBefore >= 2 && !state.turbo;
    if (isAnt) {
      duration += 1600;
      reel.classList.add("is-anticipating");
    }

    reel.classList.add("is-speeding");
    const animation = stripEl.animate(
      [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(0, -${scrollDistance}px, 0)` }
      ],
      {
        duration: duration,
        easing: "cubic-bezier(0.25, -0.15, 0.1, 1.12)",
        fill: "forwards"
      }
    );

    return new Promise((resolve) => {
      animation.finished.then(() => {
        reel.classList.remove("is-speeding");
        reel.classList.remove("is-anticipating");
        reel.classList.add("is-stopped");
        playReelStop(index);
        setTimeout(() => reel.classList.remove("is-stopped"), 360);
        resolve();
      });
    });
  });

  await Promise.all(promises);
  state.reelStopIndices = nextStopIndices;
  els.machine.classList.remove("is-reel-spinning");
}

function spawnBurst(kind, amount = 120, customX = null, customY = null) {
  const isMobile = window.innerWidth < 768;
  const count = isMobile ? Math.min(amount, 34) : amount;
  const maxCap = fxCap(isMobile ? 120 : 340);
  const theme = currentTheme();
  const palette = {
    goldstorm: ["#ffe27a", "#ff9a1f", "#ffffff", theme.accent],
    sunburst: ["#ffd45a", "#ff7133", "#fff6bf", "#19e0a7"],
    quake: ["#24ffa8", "#ffb000", "#f9ff8a", "#3f2d16"],
    blizzard: ["#d9fdff", "#86f8ff", "#b28cff", "#ffffff"],
    inferno: ["#ff5a1f", "#ffd05a", "#fff1b0", "#b5002f"],
  }[kind] || ["#fff", theme.accent, theme.second];

  const originX = customX !== null ? customX : fx.width * (0.42 + Math.random() * 0.18);
  const originY = customY !== null ? customY : fx.height * (0.28 + Math.random() * 0.28);
  scheduleParticles(() => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * (kind === "blizzard" ? 5 : 12);
    return {
      x: originX + (customX !== null ? 0 : (Math.random() - 0.5) * 180),
      y: originY + (customY !== null ? 0 : (Math.random() - 0.5) * 120),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * 3,
      life: isMobile ? 30 + Math.random() * 40 : 50 + Math.random() * 90,
      maxLife: isMobile ? 50 : 90,
      size: isMobile ? 2 + Math.random() * 5 : 2 + Math.random() * (kind === "blizzard" ? 5 : 9),
      color: palette[Math.floor(Math.random() * palette.length)],
      shape: Math.random() > 0.65 ? "coin" : "spark",
      gravity: kind === "blizzard" ? 0.01 : 0.12,
      spin: Math.random() * 8,
    };
  }, count, maxCap);
}

function spawnCoinShower(mega = false) {
  const isMobile = window.innerWidth < 768;
  const amount = isMobile ? (mega ? 42 : 22) : (mega ? 190 : 88);
  const maxCap = fxCap(isMobile ? 120 : 380);
  const colors = ["#fff4a8", "#ffd45a", "#ff981f", "#ffffff", currentTheme().accent];
  scheduleParticles(() => {
    const fromTop = Math.random() > 0.34;
    return {
      x: fromTop ? Math.random() * fx.width : fx.width * (0.28 + Math.random() * 0.44),
      y: fromTop ? -30 - Math.random() * 240 : fx.height * (0.25 + Math.random() * 0.22),
      vx: (Math.random() - 0.5) * (fromTop ? 3.6 : 12),
      vy: fromTop ? 3 + Math.random() * 7 : -6 - Math.random() * 7,
      life: isMobile ? (mega ? 40 + Math.random() * 40 : 30 + Math.random() * 30) : (mega ? 105 + Math.random() * 90 : 80 + Math.random() * 60),
      maxLife: isMobile ? (mega ? 60 : 45) : (mega ? 150 : 110),
      size: isMobile ? 3 + Math.random() * 4 : 4 + Math.random() * (mega ? 9 : 7),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.18 ? "coin" : "spark",
      gravity: fromTop ? 0.12 : 0.2,
      spin: Math.random() * 8,
    };
  }, amount, maxCap);
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
  launchPrizeConfetti("mega");
  spawnBurst(theme.effect, 90);
  playFreeSpinSound();
  renderThemes();
  renderShell();
}

function paylineCanvasPoints(reels, line, count = 5) {
  const points = [];
  const canvasRect = els.canvas.getBoundingClientRect();
  for (let col = 0; col < count; col += 1) {
    const symbol = reels[col]?.querySelectorAll(".symbol")?.[line[col]];
    if (symbol) {
      const rect = symbol.getBoundingClientRect();
      points.push({
        x: rect.left + rect.width / 2 - canvasRect.left,
        y: rect.top + rect.height / 2 - canvasRect.top
      });
    }
  }
  return points;
}

function spawnPaylineTracers(wins) {
  const reels = [...els.reels.querySelectorAll(".reel")];
  const theme = currentTheme();
  const isMobile = window.innerWidth < 768;
  
  wins.forEach((win, index) => {
    if (win.lineIndex < 0) return; // Skip scatter
    const line = PAYLINES[win.lineIndex];
    const path = paylineCanvasPoints(reels, line, win.count);
    if (path.length < 2) return;
    
    const colors = [theme.accent, theme.second || theme.accent, "#ffffff"];
    
    // Comet 1
    spawnTracer(path, colors[index % colors.length], isMobile ? 8 : 12);
    
    // Comet 2 (delayed by 180ms)
    setTimeout(() => {
      if (state.spinning) return; // Only spawn if a new spin hasn't started
      spawnTracer(path, colors[(index + 1) % colors.length], isMobile ? 8 : 12);
    }, 180);
  });
}

function spawnTracer(path, color, speed) {
  fx.particles.push({
    shape: "tracer",
    path: path,
    targetPointIndex: 1,
    x: path[0].x,
    y: path[0].y,
    vx: 0,
    vy: 0,
    life: 999, // Tracers live until they complete their path
    maxLife: 999,
    size: window.innerWidth < 768 ? 4 : 7,
    color: color,
    speed: speed,
    gravity: 0,
    spin: 0
  });
  startFxLoop();
}

function spawnShockwave(x, y) {
  const theme = currentTheme();
  fx.particles.push({
    shape: "shockwave",
    x: x,
    y: y,
    vx: 0,
    vy: 0,
    life: window.innerWidth < 768 ? 20 : 28,
    maxLife: window.innerWidth < 768 ? 20 : 28,
    size: 0,
    color: theme.accent,
    gravity: 0,
    spin: 0
  });
  startFxLoop();
}

function pushParticle(particle) {
  fx.particles.push(particle);
}

function trimParticles(cap = window.innerWidth < 768 ? 150 : 520) {
  cap = fxCap(cap);
  if (fx.particles.length > cap) {
    fx.particles.splice(0, fx.particles.length - cap);
  }
}

function spawnTreasureRain(tier = "small") {
  const isMobile = window.innerWidth < 768;
  const theme = currentTheme();
  const config = {
    small: { amount: isMobile ? 20 : 52, cap: isMobile ? 115 : 300, speed: 1 },
    big: { amount: isMobile ? 46 : 126, cap: isMobile ? 145 : 360, speed: 1.18 },
    mega: { amount: isMobile ? 74 : 210, cap: isMobile ? 175 : 430, speed: 1.34 },
  }[tier] || { amount: 52, cap: 300, speed: 1 };
  const shapes = tier === "small"
    ? ["coin", "coin", "diamond", "spark"]
    : ["coin", "coin", "diamond", "goldbar", "bill", "spark"];
  const palette = ["#fff4a8", "#ffd45a", "#ff981f", "#ffffff", theme.accent, theme.second || theme.accent];

  scheduleParticles(() => {
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const fromTop = Math.random() > 0.22;
    return {
      x: fromTop ? Math.random() * fx.width : fx.width * (0.24 + Math.random() * 0.52),
      y: fromTop ? -30 - Math.random() * fx.height * 0.28 : fx.height * (0.22 + Math.random() * 0.25),
      vx: (Math.random() - 0.5) * (fromTop ? 3.8 : 13) * config.speed,
      vy: fromTop ? (3.2 + Math.random() * 7.4) * config.speed : (-6 - Math.random() * 8) * config.speed,
      life: (isMobile ? 46 : 86) + Math.random() * (tier === "mega" ? 95 : 60),
      maxLife: isMobile ? 92 : 150,
      size: (isMobile ? 4 : 6) + Math.random() * (shape === "bill" ? 8 : 10),
      color: palette[Math.floor(Math.random() * palette.length)],
      shape,
      gravity: shape === "bill" ? 0.07 : 0.14,
      spin: Math.random() * Math.PI * 2,
      wobble: Math.random() * Math.PI * 2,
    };
  }, config.amount, config.cap);
}

function drawLightning(ctx, x1, y1, x2, y2, color, width, isMobile) {
  ctx.save();
  ctx.beginPath();
  
  const steps = 8;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    let tx = x1 + dx * t;
    let ty = y1 + dy * t;
    if (i < steps) {
      const offset = (Math.random() - 0.5) * (isMobile ? 8 : 14);
      tx += (-dy / len) * offset;
      ty += (dx / len) * offset;
    }
    ctx.lineTo(tx, ty);
  }
  
  if (isMobile) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width + 1.5;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = width * 0.7;
    ctx.stroke();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = width * 0.35;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }
  ctx.restore();
}

let fxLoopRunning = false;

function startFxLoop() {
  if (fxLoopRunning) return;
  fxLoopRunning = true;
  requestAnimationFrame(fxLoop);
}

function fxLoop() {
  if (fx.particles.length === 0 && !state.spinning) {
    fx.ctx.clearRect(0, 0, fx.width, fx.height);
    fxLoopRunning = false;
    return;
  }
  
  const isMobile = window.innerWidth < 768;
  fx.frame += 1;
  fx.ctx.clearRect(0, 0, fx.width, fx.height);
  const particleLoad = fx.particles.length;
  const useGlow = !isMobile && !fx.low && particleLoad < 190;
  const drawDetails = particleLoad < (fx.low ? 120 : 260);
  
  // 1. Draw lightning for anticipating reels
  if (!isMobile && !fx.low && fx.frame % 2 === 0) {
    if (fx.frame % 8 === 0) {
      fx.anticipatingRects = [...document.querySelectorAll(".reel.is-anticipating")].map((reel) => {
        const rect = reel.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    }
    fx.anticipatingRects.forEach((rect) => {
      const theme = currentTheme();
      const lightningColor = theme.second || theme.accent;
      drawLightning(fx.ctx, rect.left, rect.top, rect.left, rect.bottom, lightningColor, 3, isMobile);
      drawLightning(fx.ctx, rect.right, rect.top, rect.right, rect.bottom, lightningColor, 3, isMobile);
    });
  }
  
  // 2. Spawn flame sparks during spinning
  if (state.spinning && fx.frame % (fx.low ? 5 : 3) === 0) {
    if (!fx.reelsRect || fx.frame % 15 === 0) {
      const rect = els.reels.getBoundingClientRect();
      fx.reelsRect = { left: rect.left, bottom: rect.bottom, width: rect.width };
    }
    const reelsRect = fx.reelsRect;
    const spawnCount = isMobile || fx.low ? 1 : 2;
    const colors = ["#ff3300", "#ff6600", "#ffaa00", "#ffd45a", "#ffffff"];
    for (let j = 0; j < spawnCount; j += 1) {
      if (Math.random() < (fx.low ? 0.16 : 0.28)) {
        fx.particles.push({
          x: reelsRect.left + Math.random() * reelsRect.width,
          y: reelsRect.bottom - Math.random() * 10,
          vx: (Math.random() - 0.5) * (isMobile ? 2.5 : 4.5),
          vy: -3.5 - Math.random() * (isMobile ? 3.5 : 6),
          life: isMobile ? 18 + Math.random() * 15 : 28 + Math.random() * 25,
          maxLife: isMobile ? 33 : 53,
          size: isMobile ? 1.5 + Math.random() * 2.5 : 2 + Math.random() * 4.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          shape: "spark",
          gravity: -0.06 - Math.random() * 0.04, // float upwards (negative gravity)
          spin: Math.random() * 4
        });
      }
    }
  }
  
  const newSparks = [];
  
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];

    // 1. Shockwave update & rendering
    if (p.shape === "shockwave") {
      p.life -= 1;
      if (p.life <= 0) {
        fx.particles.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, p.life / p.maxLife);
      fx.ctx.save();
      fx.ctx.globalAlpha = alpha * 0.55;
      fx.ctx.translate(p.x, p.y);
      const radius = (1 - alpha) * (isMobile ? 140 : 280);
      
      // Ring 1
      fx.ctx.beginPath();
      fx.ctx.arc(0, 0, radius, 0, Math.PI * 2);
      fx.ctx.strokeStyle = p.color;
      fx.ctx.lineWidth = alpha * (isMobile ? 2 : 4);
      fx.ctx.stroke();
      
      // Ring 2
      fx.ctx.beginPath();
      fx.ctx.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
      fx.ctx.strokeStyle = currentTheme().second || p.color;
      fx.ctx.lineWidth = alpha * (isMobile ? 1 : 2);
      fx.ctx.stroke();
      
      fx.ctx.restore();
      continue;
    }
    
    // 2. Tracer comet update & rendering
    if (p.shape === "tracer") {
      const target = p.path[p.targetPointIndex];
      if (!target) {
        fx.particles.splice(i, 1);
        continue;
      }
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= p.speed) {
        p.x = target.x;
        p.y = target.y;
        p.targetPointIndex += 1;
        if (p.targetPointIndex >= p.path.length) {
          fx.particles.splice(i, 1);
          continue;
        }
      } else {
        p.x += (dx / dist) * p.speed;
        p.y += (dy / dist) * p.speed;
      }
      
      // Spawn trail spark with low probability to save performance
      const sparkProb = fx.low ? 0.12 : (isMobile ? 0.2 : 0.34);
      if (Math.random() < sparkProb) {
        newSparks.push({
          x: p.x,
          y: p.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          life: isMobile ? 8 + Math.random() * 8 : 12 + Math.random() * 12,
          maxLife: isMobile ? 16 : 24,
          size: isMobile ? 1.5 + Math.random() * 1.5 : 2 + Math.random() * 2.5,
          color: p.color,
          shape: "spark",
          gravity: 0.02,
          spin: Math.random() * 4
        });
      }
      
      // Render tracer head
      fx.ctx.save();
      fx.ctx.fillStyle = p.color;
      if (useGlow) {
        fx.ctx.shadowColor = p.color;
        fx.ctx.shadowBlur = 7;
      }
      fx.ctx.beginPath();
      fx.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      fx.ctx.fill();
      fx.ctx.restore();
      continue;
    }
    
    // 3. Normal particles update & rendering
    p.life -= 1;
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.spin += p.shape === "bill" ? 0.05 : 0.2;
    p.wobble = (p.wobble || 0) + 0.08;
    const alpha = Math.max(0, p.life / p.maxLife);
    fx.ctx.save();
    fx.ctx.globalAlpha = alpha;
    fx.ctx.translate(p.x, p.y);
    fx.ctx.rotate(p.spin);
    fx.ctx.fillStyle = p.color;
    if (useGlow && p.shape !== "bill" && p.shape !== "goldbar") {
      fx.ctx.shadowColor = p.color;
      fx.ctx.shadowBlur = p.shape === "coin" ? 7 : 5;
    }
    if (p.shape === "coin") {
      fx.ctx.beginPath();
      fx.ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.75, 0, 0, Math.PI * 2);
      fx.ctx.fill();
      if (drawDetails) {
        fx.ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        fx.ctx.lineWidth = Math.max(1, p.size * 0.12);
        fx.ctx.stroke();
      }
    } else if (p.shape === "diamond") {
      fx.ctx.beginPath();
      fx.ctx.moveTo(0, -p.size * 1.1);
      fx.ctx.lineTo(p.size * 1.15, 0);
      fx.ctx.lineTo(0, p.size * 1.1);
      fx.ctx.lineTo(-p.size * 1.15, 0);
      fx.ctx.closePath();
      fx.ctx.fill();
      if (drawDetails) {
        fx.ctx.strokeStyle = "rgba(255, 255, 255, 0.62)";
        fx.ctx.lineWidth = Math.max(1, p.size * 0.1);
        fx.ctx.stroke();
      }
    } else if (p.shape === "goldbar") {
      const w = p.size * 2.3;
      const h = p.size * 1.05;
      fx.ctx.beginPath();
      fx.ctx.roundRect(-w / 2, -h / 2, w, h, Math.max(2, p.size * 0.2));
      fx.ctx.fill();
      fx.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      fx.ctx.fillRect(-w * 0.32, -h * 0.33, w * 0.64, h * 0.18);
    } else if (p.shape === "bill") {
      const w = p.size * 2.7;
      const h = p.size * 1.2;
      fx.ctx.translate(Math.sin(p.wobble) * 3, 0);
      fx.ctx.fillStyle = "#72ff9c";
      fx.ctx.fillRect(-w / 2, -h / 2, w, h);
      fx.ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      fx.ctx.lineWidth = 1;
      fx.ctx.strokeRect(-w / 2, -h / 2, w, h);
      fx.ctx.fillStyle = "rgba(0, 75, 28, 0.55)";
      fx.ctx.beginPath();
      fx.ctx.arc(0, 0, h * 0.28, 0, Math.PI * 2);
      fx.ctx.fill();
    } else {
      fx.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    fx.ctx.restore();
    if (p.life <= 0) fx.particles.splice(i, 1);
  }
  
  if (newSparks.length > 0) {
    fx.particles.push(...newSparks);
    trimParticles(isMobile ? 120 : 360);
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
    const winTier = mega ? "mega" : result.total >= currentBet() * currentLineCount() * 12 ? "big" : "small";
    launchPrizeConfetti(winTier);
    spawnBurst(theme.effect, mega ? 72 : 38);
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
    launchPrizeConfetti("big");
    spawnBurst("blizzard", 56);
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

  const burstSymbols = new Set();
  const theme = currentTheme();
  const isMobile = window.innerWidth < 768;

  for (const win of wins) {
    if (win.lineIndex < 0) {
      document.querySelectorAll('[data-symbol="scatter"]').forEach((node) => {
        node.classList.add("is-hit");
        if (!burstSymbols.has(node)) {
          burstSymbols.add(node);
          const rect = node.getBoundingClientRect();
          spawnBurst(theme.effect, isMobile ? 8 : 16, rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
      });
      continue;
    }
    const line = PAYLINES[win.lineIndex];
    for (let col = 0; col < win.count; col += 1) {
      const symbol = reels[col]?.querySelectorAll(".symbol")?.[line[col]];
      if (symbol) {
        symbol.classList.add("is-hit");
        if (!burstSymbols.has(symbol)) {
          burstSymbols.add(symbol);
          const rect = symbol.getBoundingClientRect();
          spawnBurst(theme.effect, isMobile ? 8 : 16, rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
      }
    }
    const points = paylinePoints(reels, overlayRect, line, win.count);
    if (points.length >= 3) drawPayline(points, win.lineIndex);
  }
  if (wins.length > 0) {
    els.paylineOverlay.classList.add("is-active");
    spawnPaylineTracers(wins);
  }
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
  const btnRect = els.spinButton.getBoundingClientRect();
  spawnShockwave(btnRect.left + btnRect.width / 2, btnRect.top + btnRect.height / 2);
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

  const strips = state.themeReelStrips[theme.id];
  const baseScroll = state.turbo ? 12 : 24;
  const stepScroll = state.turbo ? 4 : 10;
  const scrollCounts = Array.from({ length: 5 }, (_, col) => {
    const randOffset = Math.floor(Math.random() * 6);
    return baseScroll + col * stepScroll + randOffset;
  });

  const nextStopIndices = state.reelStopIndices.map((curr, col) => {
    const stripLen = strips[col].length;
    return (curr + scrollCounts[col]) % stripLen;
  });

  const board = nextStopIndices.map((stopIndex, colIndex) => {
    const strip = strips[colIndex];
    return [
      strip[stopIndex % strip.length],
      strip[(stopIndex + 1) % strip.length],
      strip[(stopIndex + 2) % strip.length]
    ];
  });

  startSpinSound(spinTiming().totalDuration);
  await animateReels(board, theme, scrollCounts, nextStopIndices);
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
  if (state.themeReelStrips && state.themeReelStrips[themeId]) {
    state.reelStopIndices = Array.from({ length: 5 }, (_, col) => {
      const len = state.themeReelStrips[themeId][col].length;
      return Math.floor(Math.random() * len);
    });
  }
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
  els.spinButton.addEventListener("touchstart", (e) => { e.preventDefault(); spin(); }, { passive: false });
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
    saveState();
  });
  els.mute.addEventListener("click", () => {
    state.muted = !state.muted;
    if (state.muted) stopSpinSound();
    else playButtonSound();
    renderShell();
    saveState();
    toast(state.muted ? "静音模式" : "老虎机音效已开启", state.muted ? "已停止转轴和中奖音效。" : "包含滚轴、停轴、按钮、大奖合成音效。");
  });
  els.themeList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-theme-id]");
    if (card) setTheme(card.dataset.themeId);
  });
  document.querySelectorAll("[data-theme-shortcut]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeShortcut));
  });
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      spin();
    }
  });
}

function initReelStrips() {
  state.themeReelStrips = {};
  THEMES.forEach((theme) => {
    state.themeReelStrips[theme.id] = generateThemeReelStrips(theme);
  });
  state.reelStopIndices = Array.from({ length: 5 }, (_, col) => {
    const len = state.themeReelStrips[state.themeId][col].length;
    return Math.floor(Math.random() * len);
  });
}

function init() {
  initReelStrips();
  _doResize();
  renderThemes();
  renderPaytable();
  renderShell();
  renderBoard(randomBoard(currentTheme()), []);
  bindEvents();
  initConfettiFx();
  spawnBurst("goldstorm", 80);
}

init();
