// js/UIManager.js

export class UIManager {
  constructor() {
    // Seleciona todos os elementos do DOM
    this.boardEl = document.querySelector(".board");
    this.sticksEl = document.querySelector(".sticks");
    this.resultEl = document.querySelector(".result");
    this.throwBtn = document.querySelector(".throw-btn");
    this.quitBtn = document.querySelector(".quit-btn");
    this.skipBtn = document.querySelector(".skip-btn");
    this.overlay = document.getElementById("sticks-overlay");
    this.bigSticks = this.overlay?.querySelector(".sticks-big");
    this.bigResult = this.overlay?.querySelector(".sticks-result");
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

    // Leaderboard
    this.leaderboard = [];
    this.tableBody = document.querySelector(".classifications tbody");

    // Callbacks configuráveis (definidas pelo jogo principal)
    this.onThrow = null;
    this.onQuit = null;
    this.onSkip = null;
    this.onGoToGame = null;
    this.onConfigChange = null;

    // Auth callbacks (online)
    this.onLogin = null;
    this.onLogout = null;
  }

  //Inicialização e listeners 
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
    this.loadLeaderboard();
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

  //Chat 
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

    //Atualiza status visual do jogador ativo
    document.querySelectorAll(".status-bar span").forEach(el => el.classList.remove("active"));
    const active = currentPlayer === "G" ? this.goldCounter : this.blackCounter;
    active?.classList.add("active");
    
  }

  // Destaques no tabuleiro
  clearHighlights(alsoSelected = false) {
    this.boardEl.querySelectorAll(".cell.target").forEach(el => el.classList.remove("target"));
    if (alsoSelected)
      this.boardEl.querySelectorAll(".cell.selected").forEach(el => el.classList.remove("selected"));
  }

   highlightTargets(targets) {
    targets.forEach(({ r, c }) => {
      const index = r * (this.cols) + c;
      const el = this.boardEl.children[index];
      if (el) el.classList.add("target");
    });
  }

  markSelected(r, c) {
    const index = r * (this.cols) + c;
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

  // Leaderboard (localStorage)
  updateLeaderboard(winner, piecesLeft) {
    const record = {
      winner,
      piecesLeft,
      date: new Date().toLocaleString()
    };

    this.leaderboard.push(record);
    this.leaderboard.sort((a, b) => b.piecesLeft - a.piecesLeft);
    localStorage.setItem("tab_leaderboard", JSON.stringify(this.leaderboard));

    this.renderLeaderboard();
  }

  loadLeaderboard() {
    const saved = localStorage.getItem("tab_leaderboard");
    if (saved) this.leaderboard = JSON.parse(saved);
    this.renderLeaderboard();
  }

  renderLeaderboard() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = "";

    this.leaderboard.forEach((rec, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${rec.date}</td>
        <td>${rec.winner}${idx === 0 ? " 🏆" : ""}</td>
        <td>${rec.piecesLeft}</td>
      `;
      this.tableBody.appendChild(tr);
    });
  }

  // Visibilidade do nível de IA
  // Visibilidade do nível de IA
  updateAIVisibility() {
    const isPVC = this.modeSelect.value === "pvc";

    // AI options only in PvC
    this.aiLevelGroup.classList.toggle("hidden", !isPVC);
    this.aiLevelSelect.disabled = !isPVC;

    // In online PvP, the first player is always Black (server decides),
    // so hide/disable the First-to-play option.
    if (this.firstSelectLabel) this.firstSelectLabel.classList.toggle("hidden", !isPVC);
    if (this.firstSelect) this.firstSelect.disabled = !isPVC;
  }

  // Animação dos paus 
  animateSticks(symbols, value, repeat) {
    this.sticksEl.textContent = symbols;
    this.resultEl.textContent = `Result: ${value}${repeat ? " (repeat)" : ""}`;
    this.resultEl.classList.add("show");

    if (this.bigSticks && this.bigResult && this.overlay) {
      this.overlay.classList.remove("hidden");
      this.bigSticks.textContent = symbols;
      this.bigResult.textContent = `Result: ${value}${repeat ? " (repeat)" : ""}`;
      this.bigResult.style.opacity = 1;
      setTimeout(() => this.overlay.classList.add("hidden"), 2500);
    }
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
    if (this.sticksEl) {
      this.sticksEl.textContent = "";
    }
  }


  refreshRollButton(game) {
    const can =
      !game.gameOver &&
      game.currentRoll === null &&
      (game.extraRollPending || game.turnRolls === 0);

    this.setRollEnabled(can);
  }

}
