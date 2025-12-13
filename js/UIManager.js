// js/UIManager.js
import { register, getRanking, GROUP_ID } from "./ServerAPI.js";



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
    this.onGoToGame = null;
    this.onConfigChange = null;

    this.welcomeText = document.querySelector(".welcome-text");

    // Leaderboard
    this.leaderboard = [];
    this.tableBody = document.querySelector(".classifications tbody");

    // Credenciais do utilizador autenticado
    this.nick = null;
    this.password = null;

    // Callbacks configuráveis...

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

  // Login REAL usando /register no servidor
  initLogin() {
    if (!this.loginBtn || !this.logoutBtn) return;

    // estado inicial
    this.logoutBtn.disabled = true;
    this.loginForm.classList.add("hidden");
    this.welcomeText.classList.add("hidden");

    // Clicar em "Log In":
    //  1º clique → mostra o formulário
    //  2º clique (com nick/pass preenchidos) → envia para o servidor
    this.loginBtn.addEventListener("click", async () => {
      // Se o formulário estiver escondido, só o mostramos
      if (this.loginForm.classList.contains("hidden")) {
        this.loginForm.classList.remove("hidden");
        this.userInput.focus();
        return;
      }

      const nick = this.userInput.value.trim();
      const pass = this.passInput.value.trim();

      if (!nick || !pass) {
        this.addMessage("System", "Please fill both user and password.");
        return;
      }

      this.loginBtn.disabled = true;
      this.addMessage("System", `Authenticating '${nick}' with server...`);

      try {
        await register(nick, pass); // chama /register
        this.nick = nick;
        this.password = pass;

        this.loginForm.classList.add("hidden");
        this.logoutBtn.disabled = false;

        if (this.welcomeText) {
          this.welcomeText.textContent = `Welcome, ${nick}!`;
          this.welcomeText.classList.remove("hidden");
        }

        this.addMessage("System", `Logged in as '${nick}' (server ok).`);
      } catch (err) {
        this.addMessage("System", `Authentication error: ${err.message}`);
      } finally {
        this.loginBtn.disabled = false;
      }
    });

    // Logout limpa credenciais só do lado do cliente
    this.logoutBtn.addEventListener("click", () => {
      this.nick = null;
      this.password = null;

      this.userInput.value = "";
      this.passInput.value = "";

      this.welcomeText.textContent = "";
      this.welcomeText.classList.add("hidden");

      this.logoutBtn.disabled = true;

      this.addMessage("System", "Logged out from local session.");
    });
  }

  // Obter credenciais atuais (será usado para join/leave/roll/notify/pass)
  getCredentials() {
    if (!this.nick || !this.password) return null;
    return { nick: this.nick, password: this.password };
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
  updateAIVisibility() {
    const isPVC = this.modeSelect.value === "pvc";
    this.aiLevelGroup.classList.toggle("hidden", !isPVC);
    this.aiLevelSelect.disabled = !isPVC;
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

  refreshRollButton(game) {
    const can =
      !game.gameOver &&
      game.currentRoll === null &&
      (game.extraRollPending || game.turnRolls === 0);

    this.setRollEnabled(can);
  }

}