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
      <button class="theme-card ${theme.id === state.themeId ? "is-active" : ""}" data-theme-id="${theme.id}">
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

function renderBoard(board, spinningColumns = []) {
  els.reels.innerHTML = board
    .map(
      (column, colIndex) => `
        <div class="reel ${spinningColumns.includes(colIndex) ? "is-spinning" : ""}" style="--delay:${colIndex * 90}ms">
          ${column
            .map(
              (symbol) => `
                <div class="symbol symbol-${symbol.id}" data-symbol="${symbol.id}">
                  <span class="glyph">${symbol.glyph}</span>
                  <small>${symbol.label}</small>
                </div>
              `,
            )
            .join("")}
        </div>
      `,
    )
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
    fx.ctx.shadowBlur = 18;
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
    els.shell.classList.add("screen-shake");
    setTimeout(() => els.shell.classList.remove("screen-shake"), 700);
    spawnBurst(theme.effect, mega ? 260 : 130);
    toast(mega ? "爆炸大奖！" : "中奖！", `${result.wins.length} 条高光 · 净收益 ${format.format(net)}`);
  } else {
    els.winTitle.textContent = "再来一把";
    els.winAmount.textContent = "LUCK CHARGING";
  }

  if (result.freeSpinsWon > 0) {
    toast("免费旋转触发", `获得 ${result.freeSpinsWon} 次免费局`);
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
      reels[col]?.children[line[col]]?.classList.add("is-hit");
    }
  }
}

async function spin() {
  if (state.spinning) return;
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

  const spinDuration = state.turbo ? 520 : 1180;
  const interval = window.setInterval(() => renderBoard(randomBoard(theme), [0, 1, 2, 3, 4]), 75);
  await new Promise((resolve) => setTimeout(resolve, spinDuration));
  window.clearInterval(interval);

  const board = randomBoard(theme);
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
  els.betDown.addEventListener("click", () => {
    state.betIndex = Math.max(0, state.betIndex - 1);
    renderShell();
    saveState();
  });
  els.betUp.addEventListener("click", () => {
    state.betIndex = Math.min(BET_STEPS.length - 1, state.betIndex + 1);
    renderShell();
    saveState();
  });
  els.autoButton.addEventListener("click", () => {
    state.auto = !state.auto;
    renderShell();
    if (state.auto) spin();
    else window.clearTimeout(state.autoTimer);
  });
  els.turbo.addEventListener("click", () => {
    state.turbo = !state.turbo;
    renderShell();
  });
  els.mute.addEventListener("click", () => {
    state.muted = !state.muted;
    renderShell();
    toast(state.muted ? "静音模式" : "音效氛围", "当前版本使用视觉反馈，后续可接 WebAudio。");
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
