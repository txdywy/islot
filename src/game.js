import { BET_STEPS, PAYLINES, THEMES } from "./game-data.js";

const state = {
  themeId: localStorage.getItem("islot-theme") || "vegas",
  balance: Number(localStorage.getItem("islot-balance") || 50000),
  betIndex: Number(localStorage.getItem("islot-bet-index") || 2),
  freeSpins: Number(localStorage.getItem("islot-free-spins") || 0),
  heat: Number(localStorage.getItem("islot-heat") || 0),
  spinning: false,
  turbo: false,
  muted: false,
  auto: false,
  autoTimer: 0,
};

const audio = {
  ctx: null,
  master: null,
  spinOsc: null,
  spinGain: null,
  noiseBuffer: null,
};

const els = {
  shell: document.querySelector("#gameShell"),
  machine: document.querySelector("#machine"),
  reels: document.querySelector("#reels"),
  themeList: document.querySelector("#themeList"),
  themeCount: document.querySelector("#themeCount"),
  balance: document.querySelector("#balanceValue"),
  bet: document.querySelector("#betValue"),
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

function currentTheme() {
  return THEMES.find((theme) => theme.id === state.themeId) || THEMES[0];
}

function currentBet() {
  return BET_STEPS[state.betIndex];
}

function saveState() {
  localStorage.setItem("islot-theme", state.themeId);
  localStorage.setItem("islot-balance", String(state.balance));
  localStorage.setItem("islot-bet-index", String(state.betIndex));
  localStorage.setItem("islot-free-spins", String(state.freeSpins));
  localStorage.setItem("islot-heat", String(state.heat));
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
  els.jackpot.textContent = format.format(theme.jackpot + state.heat * currentBet() * 7);
  els.freeSpins.textContent = state.freeSpins;
  els.spinHint.textContent = state.freeSpins > 0 ? "免费局 · 不扣金币" : "5 条线 · 爆奖模式";
  els.autoButton.classList.toggle("is-active", state.auto);
  els.turbo.classList.toggle("is-active", state.turbo);
  els.mute.classList.toggle("is-active", state.muted);
  els.heatFill.style.width = `${Math.min(100, state.heat * 14)}%`;
  els.heatText.textContent =
    state.heat >= 6 ? "热度拉满，下一次大奖会非常夸张。" : state.heat > 0 ? `连胜 ${state.heat} 层，特效倍率正在升温。` : "等待第一把爆燃。";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.themeShortcut === theme.id);
  });
}

function renderThemes() {
  els.themeList.innerHTML = THEMES.map(
    (theme) => `
      <button class="theme-card theme-${theme.id} ${theme.id === state.themeId ? "is-active" : ""}" data-theme-id="${theme.id}">
        <span class="theme-icon">${theme.icon}</span>
        <span>
          <strong>${theme.name}</strong>
          <small>${theme.subtitle}</small>
        </span>
      </button>
    `,
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
  const stripLength = state.turbo ? 14 : 22;
  return [...Array.from({ length: stripLength }, () => weightedSymbol(theme)), ...finalColumn];
}

function symbolMarkup(symbol, extraClass = "") {
  return `
    <div class="symbol symbol-${symbol.id} ${extraClass}" data-symbol="${symbol.id}">
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

function evaluate(board, bet) {
  const wins = [];
  let total = 0;

  for (const [lineIndex, line] of PAYLINES.entries()) {
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
    const scatterPay = scatters * bet * 12;
    total += scatterPay;
    wins.push({ lineIndex: -1, symbol: { label: "SCATTER", glyph: "✦" }, count: scatters, amount: scatterPay, multiplier: scatters * 12 });
  }

  return { total, wins, freeSpinsWon, scatters };
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

function startSpinSound() {
  const ctx = ensureAudio();
  if (!ctx || audio.spinOsc) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(55, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(state.turbo ? 150 : 110, ctx.currentTime + 0.28);
  filter.type = "lowpass";
  filter.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.08);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  osc.start();
  audio.spinOsc = osc;
  audio.spinGain = gain;
  noiseHit(0.18, 0.18, 900);
}

function stopSpinSound() {
  const ctx = audio.ctx;
  if (!ctx || !audio.spinOsc || !audio.spinGain) return;
  audio.spinGain.gain.cancelScheduledValues(ctx.currentTime);
  audio.spinGain.gain.setValueAtTime(Math.max(audio.spinGain.gain.value, 0.001), ctx.currentTime);
  audio.spinGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  audio.spinOsc.stop(ctx.currentTime + 0.22);
  audio.spinOsc = null;
  audio.spinGain = null;
}

function playButtonSound() {
  tone(420, 0.07, "triangle", 0.18);
  tone(780, 0.08, "sine", 0.11, 0.035);
}

function playReelStop(index) {
  tone(520 + index * 92, 0.045, "triangle", 0.14);
  tone(1040 + index * 120, 0.04, "sine", 0.07, 0.018);
  noiseHit(0.055, 0.11, 1700 + index * 260);
}

function playCoinCascade(count = 10, start = 0) {
  const notes = [988, 1175, 1318, 1568, 1760, 2093];
  for (let i = 0; i < count; i += 1) {
    const delay = start + i * 0.038;
    tone(notes[i % notes.length] * (i % 3 === 0 ? 0.5 : 1), 0.07, i % 2 ? "triangle" : "sine", 0.085, delay);
    if (i % 2 === 0) noiseHit(0.035, 0.035, 3200 + i * 90, delay);
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
  const baseDuration = state.turbo ? 520 : 900;
  const stopGap = state.turbo ? 110 : 210;

  await new Promise((resolve) => requestAnimationFrame(resolve));

  const animations = reels.map((reel, index) => {
    const strip = reel.querySelector(".reel-strip");
    const travel = Math.max(0, strip.scrollHeight - reel.clientHeight);
    strip.style.transform = "translate3d(0, 0, 0)";
    reel.classList.add("is-speeding");
    const animation = strip.animate(
      [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(0, -${Math.max(0, travel * 0.24)}px, 0)`, offset: 0.18 },
        { transform: `translate3d(0, -${Math.max(0, travel - 34)}px, 0)`, offset: 0.78 },
        { transform: `translate3d(0, -${travel + 16}px, 0)`, offset: 0.92 },
        { transform: `translate3d(0, -${travel}px, 0)` },
      ],
      {
        duration: baseDuration + index * stopGap,
        easing: reelStopEase,
        fill: "forwards",
      },
    );
    animation.finished.then(() => {
      reel.classList.remove("is-speeding");
      reel.classList.add("is-stopped");
      playReelStop(index);
      setTimeout(() => reel.classList.remove("is-stopped"), 360);
    });
    return animation.finished;
  });

  await Promise.all(animations);
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
  document.querySelectorAll(".symbol.is-hit").forEach((node) => node.classList.remove("is-hit"));
}

function highlightWins(board, wins) {
  clearHighlights();
  const reels = [...els.reels.querySelectorAll(".reel")];
  for (const win of wins) {
    if (win.lineIndex < 0) {
      document.querySelectorAll('[data-symbol="scatter"]').forEach((node) => node.classList.add("is-hit"));
      continue;
    }
    const line = PAYLINES[win.lineIndex];
    for (let col = 0; col < win.count; col += 1) {
      reels[col]?.querySelectorAll(".symbol")?.[line[col]]?.classList.add("is-hit");
    }
  }
}

async function spin() {
  if (state.spinning) return;
  playButtonSound();
  const bet = currentBet();
  const lineCost = bet * PAYLINES.length;
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
  startSpinSound();
  await animateReels(board, theme);
  stopSpinSound();
  renderBoard(board, []);
  const result = evaluate(board, bet);
  state.balance += result.total;
  state.freeSpins += result.freeSpinsWon;
  state.heat = result.total > 0 ? Math.min(7, state.heat + 1) : Math.max(0, state.heat - 1);
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
