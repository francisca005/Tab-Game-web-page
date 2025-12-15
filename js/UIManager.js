// js/UIManager.js

export class UIManager {
  constructor() {
    // Seleciona todos os elementos do DOM
    this.boardEl = document.querySelector(".board");
    this.resultEl = document.querySelector(".result");
    this.throwBtn = document.querySelector(".throw-btn");
    this.quitBtn = document.querySelector(".quit-btn");
    this.skipBtn = document.querySelector(".skip-btn");
    this.chatBox = document.querySelector(".chat");
    this.goldCounter = document.querySelector(".gold-player");
    this.blackCounter = document.querySelector(".black-player");

    // Configurações e opções de jogo
    this.goToConfigBtn = document.getElementById("goToConfigBtn");
    this.goToGameBtn = document.getElementById("goToGameBtn");
    this.sizeInput = document.getElementById("boardSize");
    this.modeSelect = document.getElementById("modeSelect");
    this.firstSelect = document.getElementById("firstSelect");
    this.firstSelectLabel = this.firstSelect?.closest("label");
    this.aiLevelSelect = document.getElementById("aiLevel");
    this.aiLevelGroup = document.getElementById("aiLevelGroup");

    // Login visual(não funcional)
    this.loginBtn = document.querySelector(".login-btn");
    this.logoutBtn = document.querySelector(".logout-btn");
    this.loginForm = document.querySelector(".login-form");
    this.userInput = document.querySelector(".user-input");
    this.passInput = document.querySelector(".pass-input");
    this.welcomeText = document.querySelector(".welcome-text");

    // Callbacks configuráveis (definidas pelo jogo principal)
    this.onThrow = null;
    this.onQuit = null;
    this.onSkip = null;
    this.onGoToGame = null;
    this.onConfigChange = null;

    // Auth callbacks (online)
    this.onLogin = null;
    this.onLogout = null;

    // Canvas dos paus
    this.sticksCanvas = document.getElementById("sticksCanvas");
    this.sticksCtx = this.sticksCanvas?.getContext?.("2d") || null;

    this.sticksOverlayCanvas = document.getElementById("sticksOverlayCanvas");
    this.sticksOverlayCtx = this.sticksOverlayCanvas?.getContext?.("2d") || null;

    this.overlay = document.getElementById("sticks-overlay");
    this.bigResult = this.overlay?.querySelector(".sticks-result") || null;

    // Canvas de efeitos no tabuleiro (movimentos, partículas, etc.)
    this.boardWrap = document.querySelector(".board-wrap");
    this.boardFxCanvas = document.getElementById("boardFxCanvas");
    this.boardFxCtx = this.boardFxCanvas?.getContext?.("2d") || null;
    this._fxAnimRaf = null;


    // Timers da animação dos paus
    this._sticksAnimTimer = null;
    this._sticksOverlayHideTimer = null;

    // FX: captura (flash + shake)
    this._capRaf = null;
    this._capAnim = null;

  }

  // Inicialização e listeners
  initListeners() {
    // Botões principais
    this.throwBtn?.addEventListener("click", () => this.onThrow?.());
    this.quitBtn?.addEventListener("click", () => this.onQuit?.());

    // Navegar para as configurações
    this.goToConfigBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("configurations")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    // Iniciar o jogo
    this.goToGameBtn?.addEventListener("click", () => {
      this.onGoToGame?.({
        cols: Number(this.sizeInput.value) || 9,
        mode: this.modeSelect.value,
        first: this.firstSelect.value,
        aiLevel: this.aiLevelSelect.value,
      });
    });

    // Alterar visibilidade de AI conforme o modo
    this.modeSelect?.addEventListener("change", () => {
      this.updateAIVisibility();
      this.onConfigChange?.();
    });

    this.initLogin();

    // desenha sticks iniciais (agora já existe o método)
    this._drawSticksBoth([true, true, true, true], { jitter: 0, rotAmp: 0, idle: true });
    window.addEventListener("resize", () => this._resizeBoardFxCanvas?.());
  }

  // Login (usado no modo online; /register serve como registo + verificação)
  initLogin() {
    if (!this.loginBtn || !this.logoutBtn || !this.loginForm) return;

    // Enter no input faz login
    const submitIfEnter = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.loginBtn.click();
      }
    };
    this.userInput?.addEventListener("keydown", submitIfEnter);
    this.passInput?.addEventListener("keydown", submitIfEnter);

    this.loginBtn.addEventListener("click", async () => {
      // 1º clique abre o formulário
      if (this.loginForm.classList.contains("hidden")) {
        this.loginForm.classList.remove("hidden");
        this.userInput?.focus();
        return;
      }

      const nick = (this.userInput?.value || "").trim();
      const pass = (this.passInput?.value || "").trim();
      if (!nick || !pass) {
        this.addMessage("System", "Preenche user e password.");
        return;
      }

      this.loginBtn.disabled = true;
      try {
        await this.onLogin?.(nick, pass);
        this.setAuthUI(true, nick);
        this.loginForm.classList.add("hidden");
      } catch (e) {
        this.addMessage("System", `Login falhou: ${e.message || e}`);
      } finally {
        this.loginBtn.disabled = false;
      }
    });

    this.logoutBtn.addEventListener("click", async () => {
      this.logoutBtn.disabled = true;
      try {
        await this.onLogout?.();
      } finally {
        this.setAuthUI(false, "");
        this.logoutBtn.disabled = false;
      }
    });
  }

  setAuthUI(loggedIn, nick) {
    if (loggedIn) {
      this.logoutBtn.disabled = false;
      this.loginBtn.disabled = true;
      if (this.welcomeText) {
        this.welcomeText.textContent = `Olá, ${nick}!`;
        this.welcomeText.classList.remove("hidden");
      }
    } else {
      this.logoutBtn.disabled = true;
      this.loginBtn.disabled = false;
      if (this.welcomeText) {
        this.welcomeText.textContent = "";
        this.welcomeText.classList.add("hidden");
      }
      if (this.userInput) this.userInput.value = "";
      if (this.passInput) this.passInput.value = "";
    }
  }

  // Chat
  addMessage(sender, text) {
    const p = document.createElement("p");
    p.innerHTML = `<strong>${sender}:</strong> ${text}`;
    this.chatBox.appendChild(p);
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
  }

  // Contadores de peças
  updateCounts(g, b) {
    this.goldCounter.textContent = `Gold: ${g}`;
    this.blackCounter.textContent = `Black: ${b}`;
  }

  // Renderização do tabuleiro
  renderBoard(boardState, currentPlayer, onCellClick) {
    console.log("UIManager.renderBoard called", { currentPlayer, flatBoard: boardState.flat() });
    this.boardEl.innerHTML = "";

    this.cols = boardState[0].length;
    this.boardEl.style.gridTemplateColumns = `repeat(${this.cols}, 50px)`;

    boardState.forEach((row, r) => {
      row.forEach((cell, c) => {
        const div = document.createElement("div");
        div.className = "cell";
        div.dataset.row = r;
        div.dataset.col = c;

        // Se houver peça (objeto)
        if (cell?.player) {
          const piece = document.createElement("div");
          piece.classList.add("chip", cell.player === "G" ? "gold" : "black");
          if (cell.type) piece.classList.add(cell.type);
          div.appendChild(piece);
        }

        div.addEventListener("click", () => onCellClick?.(r, c));
        this.boardEl.appendChild(div);
      });
    });

    this._resizeBoardFxCanvas?.();

    // Atualiza status visual do jogador ativo
    document.querySelectorAll(".status-bar span").forEach((el) => el.classList.remove("active"));
    const active = currentPlayer === "G" ? this.goldCounter : this.blackCounter;
    active?.classList.add("active");
  }

  // Destaques no tabuleiro
  clearHighlights(alsoSelected = false) {
    this.boardEl.querySelectorAll(".cell.target").forEach((el) => el.classList.remove("target"));
    if (alsoSelected)
      this.boardEl.querySelectorAll(".cell.selected").forEach((el) => el.classList.remove("selected"));
  }

  highlightTargets(targets) {
    targets.forEach(({ r, c }) => {
      const index = r * this.cols + c;
      const el = this.boardEl.children[index];
      if (el) el.classList.add("target");
    });
  }

  markSelected(r, c) {
    const index = r * this.cols + c;
    const el = this.boardEl.children[index];
    if (el) el.classList.add("selected");
  }

  setSkipEnabled(can, onClick) {
    if (!this.skipBtn) return;
    this.skipBtn.disabled = !can;
    this.skipBtn.classList.toggle("enabled", can);
    if (can && typeof onClick === "function") {
      this.skipBtn.onclick = onClick;
    } else {
      this.skipBtn.onclick = null;
    }
  }

  // Visibilidade do nível de IA
  updateAIVisibility() {
    const isPVC = this.modeSelect?.value === "pvc";

    // AI options only in PvC
    this.aiLevelGroup?.classList.toggle("hidden", !isPVC);
    if (this.aiLevelSelect) this.aiLevelSelect.disabled = !isPVC;

    // In online PvP, the first player is always Black (server decides),
    // so hide/disable the First-to-play option.
    if (this.firstSelectLabel) this.firstSelectLabel.classList.toggle("hidden", !isPVC);
    if (this.firstSelect) this.firstSelect.disabled = !isPVC;
  }

  // ---------------- Canvas sticks (frames) ----------------

  _stopSticksAnimation() {
    if (this._sticksAnimTimer) {
      clearInterval(this._sticksAnimTimer);
      this._sticksAnimTimer = null;
    }
    if (this._sticksOverlayHideTimer) {
      clearTimeout(this._sticksOverlayHideTimer);
      this._sticksOverlayHideTimer = null;
    }
  }

  _valueToStickValues(value) {
    // 6 => 0 em pé (4 deitados)
    if (value === 6) return [false, false, false, false];

    const ups = Math.max(0, Math.min(4, value));
    const arr = Array.from({ length: 4 }, (_, i) => i < ups); // true = em pé

    // baralhar para não ficar sempre "os primeiros em pé"
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }


  _normalizeStickValues(stickValuesOrSymbol, value) {
    if (Array.isArray(stickValuesOrSymbol) && stickValuesOrSymbol.length === 4) {
      return stickValuesOrSymbol.map(Boolean);
    }
    return this._valueToStickValues(value);
  }

  _clearCanvas(ctx, canvas) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  _drawRoundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  _drawSticks(ctx, canvas, stickUps, opts = {}) {
    if (!ctx || !canvas) return;

    const { jitter = 0, rotAmp = 0, idle = false } = opts;

    this._clearCanvas(ctx, canvas);

    const W = canvas.width;
    const H = canvas.height;

    // “piso”
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, H * 0.72, W, H * 0.08);
    ctx.globalAlpha = 1;

    const n = 4;
    const padX = W * 0.08;
    const gap = (W - padX * 2) / n;

    // Pau mais "retangular" (fino e comprido)
    const thickness = Math.max(6, H * 0.10);       // espessura
    const length = Math.min(H * 0.62, gap * 0.95); // comprimento
    const yUp = H * 0.36;      // linha para os em pé
    const yDown = H * 0.58;    // linha para os deitados

    for (let i = 0; i < n; i++) {
      const up = !!stickUps[i];

      const cx = padX + gap * (i + 0.5);
      const baseY = up ? yUp : yDown;

      const jx = idle ? 0 : (Math.random() * 2 - 1) * jitter;
      const jy = idle ? 0 : (Math.random() * 2 - 1) * jitter * 0.35;
      const ang = idle ? 0 : (Math.random() * 2 - 1) * rotAmp;

      ctx.save();
      ctx.translate(cx + jx, baseY + jy);

      // se estiver deitado, roda 90º
      ctx.rotate(ang + (up ? 0 : Math.PI / 2));

      // corpo do pau (sempre desenhado vertical, a rotação trata do resto)
      ctx.fillStyle = up ? "#d6b07a" : "#b18a57";
      this._drawRoundedRect(ctx, -thickness / 2, -length / 2, thickness, length, Math.max(6, thickness * 0.6));
      ctx.fill();

      // “risca” lateral (mantém a leitura)
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#000";
      this._drawRoundedRect(ctx, -thickness * 0.12, -length / 2, thickness * 0.18, length, thickness * 0.6);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }


  _drawSticksBoth(stickUps, opts = {}) {
    this._drawSticks(this.sticksCtx, this.sticksCanvas, stickUps, opts);
    this._drawSticks(this.sticksOverlayCtx, this.sticksOverlayCanvas, stickUps, opts);
  }

  // Animação dos paus (canvas por frames)
  animateSticks(stickValuesOrSymbol, value, repeat) {
    const finalStickUps = this._normalizeStickValues(stickValuesOrSymbol, value);

    // Resultado (texto pequeno)
    if (this.resultEl) {
      this.resultEl.textContent = `Result: ${value}${repeat ? " (repeat)" : ""}`;
      this.resultEl.classList.add("show");
    }

    // Overlay + texto grande
    if (this.overlay) this.overlay.classList.remove("hidden");
    if (this.bigResult) {
      this.bigResult.textContent = `Result: ${value}${repeat ? " (repeat)" : ""}`;
      this.bigResult.style.opacity = 1;
    }

    this._stopSticksAnimation();

    const fps = 30;
    const totalFrames = 30; // ~1s
    let f = 0;

    this._sticksAnimTimer = setInterval(() => {
      f += 1;
      const t = Math.min(1, f / (totalFrames - 1));

      // jitter/rotação decrescem até ao fim
      const jitter = (1 - t) * 18;
      const rotAmp = (1 - t) * 1.4;

      // frames intermédios aleatórios, último frame = final
      const stickUps =
        f < totalFrames - 1 ? [0, 0, 0, 0].map(() => Math.random() < 0.5) : finalStickUps;

      this._drawSticksBoth(stickUps, { jitter, rotAmp });

      if (f >= totalFrames) {
        this._stopSticksAnimation();

        // mantém overlay um bocado e depois esconde
        this._sticksOverlayHideTimer = setTimeout(() => {
          this.overlay?.classList.add("hidden");
          this._sticksOverlayHideTimer = null;
        }, 2500);
      }
    }, 1000 / fps);
  }

  // ---------- Board FX Canvas helpers ----------

  _resizeBoardFxCanvas() {
    if (!this.boardFxCanvas || !this.boardFxCtx) return;
    const refEl = this.boardWrap || this.boardEl;
    if (!refEl) return;

    const rect = refEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.boardFxCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.boardFxCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.boardFxCanvas.style.width = `${rect.width}px`;
    this.boardFxCanvas.style.height = `${rect.height}px`;

    // desenhar em "CSS pixels"
    this.boardFxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.boardFxCtx.clearRect(0, 0, rect.width, rect.height);
  }

  _clearBoardFx() {
    if (!this.boardFxCanvas || !this.boardFxCtx) return;
    const refEl = this.boardWrap || this.boardEl;
    if (!refEl) return;
    const rect = refEl.getBoundingClientRect();
    this.boardFxCtx.clearRect(0, 0, rect.width, rect.height);
  }

  _cellCenterPx(r, c) {
    if (!this.boardEl) return null;
    const cols = this.cols || 9;
    const idx = r * cols + c;
    const cell = this.boardEl.children[idx];
    if (!cell) return null;

    const wrapRect = (this.boardWrap || this.boardEl).getBoundingClientRect();
    const cr = cell.getBoundingClientRect();

    return {
      x: (cr.left - wrapRect.left) + cr.width / 2,
      y: (cr.top - wrapRect.top) + cr.height / 2
    };
  }

  _drawChipFx(ctx, x, y, player, type, alpha = 1, scale = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // igual ao CSS (chip 36x36)
    const half = 18;

    const isGold = player === "G";
    ctx.fillStyle = isGold ? "#d4af37" : "#222";
    ctx.strokeStyle = isGold ? "#bfa100" : "#444";
    ctx.lineWidth = 2;

    // sombra leve
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 6;

    if (type === "final") {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-half, -half, half * 2, half * 2);
    } else if (type === "moved") {
      ctx.beginPath();
      ctx.rect(-half, -half, half * 2, half * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, half, 0, Math.PI * 2);
    }

    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
  }

  // animação simples (ghost) do quadrado fromIdx -> toIdx
  animatePieceMove(fromIdx, toIdx, pieceLike) {
    if (!this.boardFxCanvas || !this.boardFxCtx || !this.boardEl) return;
    if (typeof fromIdx !== "number" || typeof toIdx !== "number") return;

    const cols = this.cols || 9;

    const fromR = Math.floor(fromIdx / cols);
    const fromC = fromIdx % cols;
    const toR = Math.floor(toIdx / cols);
    const toC = toIdx % cols;

    const A = this._cellCenterPx(fromR, fromC);
    const B = this._cellCenterPx(toR, toC);
    if (!A || !B) return;

    // cancela animação anterior
    if (this._fxAnimRaf) {
      cancelAnimationFrame(this._fxAnimRaf);
      this._fxAnimRaf = null;
    }

    const player = pieceLike?.player || "G";
    const type = pieceLike?.type || "initial";

    const refEl = this.boardWrap || this.boardEl;
    const rect = refEl.getBoundingClientRect();
    const ctx = this.boardFxCtx;

    const dur = 380; // ms
    const t0 = performance.now();

    const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const frame = (now) => {
      const raw = (now - t0) / dur;
      const t = Math.max(0, Math.min(1, raw));
      const e = easeInOutQuad(t);

      ctx.clearRect(0, 0, rect.width, rect.height);

      // interp + pequeno "salto"
      const x = A.x + (B.x - A.x) * e;
      const y = A.y + (B.y - A.y) * e - Math.sin(Math.PI * e) * 10;

      // ghost por cima (ligeiramente maior)
      this._drawChipFx(ctx, x, y, player, type, 0.85, 1.05);

      if (t < 1) {
        this._fxAnimRaf = requestAnimationFrame(frame);
      } else {
        this._fxAnimRaf = null;
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    };

    this._fxAnimRaf = requestAnimationFrame(frame);
  }

  // --- FX: flash + shake na captura ---
  fxCapture(boardIdx, opts = {}) {
    if (!this.boardFxCanvas || !this.boardFxCtx || !this.boardEl) return;
    if (typeof boardIdx !== "number") return;

    // garante canvas com tamanho certo
    this._resizeBoardFxCanvas?.();

    const cols = this.cols || 9;
    const r = Math.floor(boardIdx / cols);
    const c = boardIdx % cols;

    const P = this._cellCenterPx(r, c);
    if (!P) return;

    // 1) SHAKE discreto (sem CSS, via Web Animations API)
    const shakeEl = this.boardWrap || this.boardEl;
    if (shakeEl?.animate) {
      try { this._capAnim?.cancel?.(); } catch {}
      this._capAnim = shakeEl.animate(
        [
          { transform: "translate(0,0)" },
          { transform: "translate(-3px,0)" },
          { transform: "translate(3px,0)" },
          { transform: "translate(-2px,0)" },
          { transform: "translate(2px,0)" },
          { transform: "translate(0,0)" },
        ],
        { duration: 140, easing: "ease-out" }
      );
    }

    // 2) FLASH no destino (curto e suave)
    const refEl = this.boardWrap || this.boardEl;
    const rect = refEl.getBoundingClientRect();
    const ctx = this.boardFxCtx;

    const dur = typeof opts.duration === "number" ? opts.duration : 220;
    const maxR = typeof opts.radius === "number" ? opts.radius : 28;

    if (this._capRaf) {
      cancelAnimationFrame(this._capRaf);
      this._capRaf = null;
    }

    const t0 = performance.now();
    const frame = (now) => {
      const raw = (now - t0) / dur;
      const t = Math.max(0, Math.min(1, raw));

      // fade rápido no fim
      const a = 0.55 * (1 - t);

      // limpa só o flash (nota: se o ghost move estiver ativo, ele vai limpar também)
      ctx.clearRect(0, 0, rect.width, rect.height);

      // gradiente radial
      const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, maxR);
      g.addColorStop(0, `rgba(255, 245, 160, ${a})`);
      g.addColorStop(0.6, `rgba(255, 210, 80, ${a * 0.65})`);
      g.addColorStop(1, `rgba(255, 210, 80, 0)`);

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(P.x, P.y, maxR, 0, Math.PI * 2);
      ctx.fill();

      if (t < 1) {
        this._capRaf = requestAnimationFrame(frame);
      } else {
        this._capRaf = null;
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    };

    this._capRaf = requestAnimationFrame(frame);
  }



  // som
  playSound(url, vol = 0.3) {
    const audio = new Audio(url);
    audio.volume = vol;
    audio.play().catch(() => {});
  }

  // Controlo do botão de lançamento
  setRollEnabled(can) {
    const rollBtn = document.querySelector(".throw-btn");
    if (!rollBtn) return;

    rollBtn.disabled = !can;
    rollBtn.classList.toggle("enabled", can);
  }

  resetGameUI() {
    this.clearHighlights(true);
    this.setRollEnabled(false);
    this.setSkipEnabled(false);

    // limpa resultado do dado (texto + visibilidade)
    if (this.resultEl) {
      this.resultEl.classList.remove("show");
      this.resultEl.textContent = "";
    }

    // limpa animação/canvas e esconde overlay
    this._stopSticksAnimation();
    this.overlay?.classList.add("hidden");
    this._drawSticksBoth([true, true, true, true], { jitter: 0, rotAmp: 0, idle: true });
    this._clearBoardFx?.();
  }

  refreshRollButton(game) {
    const can =
      !game.gameOver &&
      game.currentRoll === null &&
      (game.extraRollPending || game.turnRolls === 0);

    this.setRollEnabled(can);
  }
}
