// js/OnlineGame.js
import {
  GROUP_ID,
  join,
  leave,
  roll,
  notify,
  passTurn,
  openUpdateStream,
} from "./ServerAPI.js";

export class OnlineGame {
  constructor(ui) {
    this.ui = ui;
    this.size = 9;
    this.gameId = null;
    this.eventSource = null;

    this.currentTurn = null;   // nick do jogador cujo turno é
    this.pieces = null;        // array de peças do servidor (color, inMotion, reachedLastRow)
    this.players = null;       // {nick: "Blue"|"Red"}
    this.step = null;          // "from" | "to"
    this.mustPass = null;      // nick que é obrigado a passar
    this.dice = null;          // valor numérico dos paus (1,2,3,4,6) ou null
    this.keepPlaying = false;  // se o servidor permite novo lançamento com o valor atual

    this.myNick = null;        // o meu nick no servidor
    this.selectedCell = null;  // índice linear da célula selecionada ("from")
    this.currentTargets = [];  // destinos válidos atuais (highlight)

    // Tabuleiro lógico para o motor de regras (serpente)
    // boardRules[i] = { player: "G"|"B", inMotion: bool, wasOnLastRow: bool } ou null
    this.boardRules = null;
  }

  // ==================== LIMPEZA ====================

  cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.gameId = null;
    this.currentTurn = null;
    this.pieces = null;
    this.players = null;
    this.step = null;
    this.mustPass = null;
    this.dice = null;
    this.keepPlaying = false;
    this.myNick = null;
    this.selectedCell = null;
    this.currentTargets = [];
    this.boardRules = null;

    // Desativar Skip quando saímos do jogo
    const skipBtn = document.querySelector(".skip-btn");
    if (skipBtn) {
      skipBtn.disabled = true;
      skipBtn.classList.remove("enabled");
      skipBtn.onclick = null;
    }
  }

  // ==================== INICIAR / SAIR ====================

  async start(cols) {
    this.size = cols;

    const creds = this.ui.getCredentials();
    if (!creds) {
      this.ui.addMessage(
        "System",
        "You must log in before starting an online game."
      );
      return;
    }

    const { nick, password } = creds;
    this.myNick = nick;

    this.cleanup();

    this.ui.addMessage("System", "Joining online game...");
    try {
      const res = await join(GROUP_ID, nick, password, cols);

      if (!res.game) {
        this.ui.addMessage(
          "System",
          "Join response did not contain a game id."
        );
        return;
      }

      this.gameId = res.game;
      this.ui.addMessage(
        "System",
        `Joined game ${this.gameId}. Waiting for opponent...`
      );

      this.ui.quitBtn.disabled = false;

      this.eventSource = openUpdateStream(
        nick,
        this.gameId,
        (data) => this.handleUpdate(data),
        () => this.ui.addMessage("System", "Connection lost to server.")
      );
    } catch (e) {
      this.ui.addMessage("System", "Error joining online game: " + e.message);
    }
  }

  async quitGame() {
    if (!this.gameId) {
      this.cleanup();
      this.ui.addMessage("System", "Not currently in an active online game.");
      return;
    }

    const creds = this.ui.getCredentials();
    if (!creds) {
      this.ui.addMessage("System", "No credentials to leave game.");
      return;
    }

    const { nick, password } = creds;
    this.ui.addMessage("System", "Leaving game...");

    try {
      await leave(nick, password, this.gameId);
      this.ui.addMessage("System", "Left online game.");
    } catch (e) {
      this.ui.addMessage("System", "Error leaving: " + e.message);
    } finally {
      this.cleanup();
      this.ui.quitBtn.disabled = true;
    }
  }

  // ==================== AÇÕES (Throw / Pass / Click) ====================

  async handleRoll() {
    if (!this.gameId) {
      this.ui.addMessage("System", "No active game.");
      return;
    }

    const creds = this.ui.getCredentials();
    if (!creds) return;
    const { nick, password } = creds;

    this.ui.addMessage("System", "Rolling sticks...");

    try {
      await roll(nick, password, this.gameId);
      // Resultado virá via handleUpdate
    } catch (e) {
      this.ui.addMessage("System", "Roll error: " + e.message);
    }
  }

  async handlePass() {
    if (!this.gameId) {
      this.ui.addMessage("System", "No active game.");
      return;
    }

    const creds = this.ui.getCredentials();
    if (!creds) return;
    const { nick, password } = creds;

    this.ui.addMessage("System", "Passing turn...");

    try {
      await passTurn(nick, password, this.gameId);
      // Mudança virá via handleUpdate
    } catch (e) {
      this.ui.addMessage("System", "Pass error: " + e.message);
    }
  }

  async handleCellClick(row, col) {
    if (!this.gameId) {
      this.ui.addMessage("System", "No active game.");
      return;
    }

    // Só posso jogar no meu turno
    if (this.currentTurn !== this.myNick) {
      this.ui.addMessage("System", "Not your turn!");
      return;
    }

    // Se o servidor diz que tens de passar, não deves tentar mover
    if (this.mustPass === this.myNick) {
      this.ui.addMessage(
        "System",
        "You have no legal moves — press Skip Turn."
      );
      return;
    }

    const idx = row * this.size + col;

    // Precisamos do estado lógico das peças para as regras
    if (!this.boardRules) {
      this.rebuildRulesBoard();
    }
    const board = this.boardRules;
    const playerSymbol = this.getCurrentPlayerSymbol();

    const creds = this.ui.getCredentials();
    if (!creds) return;
    const { nick, password } = creds;

    // ===== STEP "from": escolher peça =====
    if (this.step === "from") {
      // Regra: tens de ter dado lançado
      if (this.dice == null) {
        this.ui.addMessage("System", "Roll the sticks first!");
        return;
      }

      const piece = board[idx];
      if (!piece || piece.player !== playerSymbol) {
        this.ui.addMessage("System", "You must select one of your own pieces.");
        return;
      }

      if (!this.canMovePieceRules(board, playerSymbol, this.dice, idx)) {
        this.ui.addMessage(
          "System",
          `Cannot move this piece with roll = ${this.dice}. Must be a tab (1) to start moving.`
        );
        return;
      }

      // Calcula destinos válidos em serpente
      const targets = this.validTargetsFromRules(
        board,
        playerSymbol,
        this.dice,
        idx
      );

      if (!targets.length) {
        this.ui.addMessage("System", `No valid moves with ${this.dice}.`);
        return;
      }

      // Highlight da peça e destinos
      this.ui.clearHighlights(true);
      const boardEl = this.ui.boardEl;
      if (boardEl && boardEl.children[idx]) {
        boardEl.children[idx].classList.add("selected");
      }
      this.selectedCell = idx;
      this.currentTargets = targets;
      this.highlightTargets(targets);
      this.ui.addMessage("System", "Select a destination square.");

      // Envia "from" para o servidor
      try {
        await notify(nick, password, this.gameId, idx);
      } catch (e) {
        this.ui.addMessage("System", "Move error: " + e.message);
        this.ui.clearHighlights(true);
        this.selectedCell = null;
        this.currentTargets = [];
      }
      return;
    }

    // ===== STEP "to": escolher destino =====
    if (this.step === "to") {
      if (this.selectedCell == null) {
        this.ui.addMessage("System", "Select a piece first.");
        return;
      }

      // Clicar outra vez na mesma célula -> cancelar seleção
      if (idx === this.selectedCell) {
        this.ui.addMessage("System", "Selection cancelled.");
        this.ui.clearHighlights(true);
        this.selectedCell = null;
        this.currentTargets = [];
        return;
      }

      // Garante que temos targets atuais
      if (!this.currentTargets || !this.currentTargets.length) {
        this.currentTargets = this.validTargetsFromRules(
          board,
          playerSymbol,
          this.dice,
          this.selectedCell
        );
      }

      if (!this.currentTargets.includes(idx)) {
        this.ui.addMessage("System", "Invalid destination for current roll.");
        return;
      }

      // Envia "to" para o servidor
      try {
        await notify(nick, password, this.gameId, idx);
      } catch (e) {
        this.ui.addMessage("System", "Move error: " + e.message);
      }
      // O servidor vai responder com novo update, que limpa highlights quando step voltar a "from"
      return;
    }

    // Caso estranho: se o step vier noutro estado, comportamento antigo (fallback)
    try {
      await notify(nick, password, this.gameId, idx);
    } catch (e) {
      this.ui.addMessage("System", "Move error: " + e.message);
      this.ui.clearHighlights(true);
    }
  }

  rollSticks() {
    this.handleRoll();
  }

  // ==================== UPDATE DO SERVIDOR ====================

  handleUpdate(data) {
    console.log("UPDATE from server:", data);

    if (data.error) {
      this.ui.addMessage("System", "Server error: " + data.error);
      return;
    }

    if (data.turn !== undefined) this.currentTurn = data.turn;
    if (data.pieces !== undefined) {
      this.pieces = data.pieces;
      this.rebuildRulesBoard();
    }
    if (data.players !== undefined) {
      this.players = data.players;
      const playerList = Array.isArray(data.players)
        ? data.players.join(" vs ")
        : Object.keys(data.players).join(" vs ");
      this.ui.addMessage("System", `Game started! Players: ${playerList}`);
    }

    if (data.step !== undefined) {
      this.step = data.step;

      if (data.step === "from") {
        this.selectedCell = null;
        this.currentTargets = [];
        this.ui.clearHighlights(true);
      }

      this.ui.addMessage(
        "System",
        `Step: ${data.step} ${
          data.step === "from" ? "(select piece)" : "(select destination)"
        }`
      );
    }

    // mustPass: quem é obrigado a passar
    if (data.mustPass !== undefined) {
      this.mustPass = data.mustPass;
      if (this.mustPass === this.myNick) {
        this.ui.addMessage(
          "System",
          "No valid moves available — you must skip your turn."
        );
      }
    } else {
      // se não vem no update, assumimos que ninguém é obrigado a passar
      this.mustPass = null;
    }

    // dados: value + keepPlaying
    if (data.dice !== undefined) {
      if (data.dice === null) {
        this.dice = null;
        this.keepPlaying = false;
      } else if (typeof data.dice === "object") {
        this.dice = data.dice?.value ?? null;
        this.keepPlaying = !!data.dice.keepPlaying;
        if (this.dice != null) {
          this.ui.addMessage("System", `Dice rolled: ${this.dice}`);
          this.ui.animateSticks(
            this.getStickSymbol(this.dice),
            this.dice,
            false
          );
        }
      } else {
        this.dice = data.dice;
        this.keepPlaying = false;
        if (this.dice != null) {
          this.ui.addMessage("System", `Dice rolled: ${this.dice}`);
          this.ui.animateSticks(
            this.getStickSymbol(this.dice),
            this.dice,
            false
          );
        }
      }
    }

    // Fim de jogo
    if (data.winner !== undefined) {
      this.ui.addMessage("System", `Game finished! Winner: ${data.winner}`);
      if (window.recordGameResult) {
        const piecesLeft = this.countPiecesForPlayer(data.winner);
        window.recordGameResult(data.winner, piecesLeft);
      }
      this.cleanup();
      this.ui.quitBtn.disabled = true;
      return;
    }

    // Atualiza tabuleiro visual
    this.renderBoard();

    // Mensagem de turno
    if (this.currentTurn) {
      const isMyTurn = this.currentTurn === this.myNick;
      const turnMsg = isMyTurn
        ? "Your turn!"
        : `${this.currentTurn}'s turn`;
      this.ui.addMessage("System", turnMsg);
    }

    // Botões
    this.updateRollButton();
    this.updateSkipButton();
  }

  // ==================== REGRAS EM SERPENTE (motor local) ====================

  rebuildRulesBoard() {
    if (!this.pieces) {
      this.boardRules = null;
      return;
    }
    const total = 4 * this.size;
    this.boardRules = new Array(total).fill(null);

    for (let i = 0; i < Math.min(total, this.pieces.length); i++) {
      const raw = this.pieces[i];
      if (!raw) continue;
      const player = raw.color === "Blue" ? "G" : "B";
      this.boardRules[i] = {
        player,
        inMotion: !!raw.inMotion,
        wasOnLastRow: !!raw.reachedLastRow,
      };
    }
  }

  mirrorIndexForRules(idx) {
    const total = 4 * this.size;
    return total - 1 - idx;
  }

  getBoardPathRules() {
    const rows = 4;
    const cols = this.size;
    const path = [];

    for (let r = 0; r < rows; r++) {
      if (r % 2 === 0) {
        // linhas 0 e 2: direita -> esquerda
        for (let c = cols - 1; c >= 0; c--) {
          path.push(r * cols + c);
        }
      } else {
        // linhas 1 e 3: esquerda -> direita
        for (let c = 0; c < cols; c++) {
          path.push(r * cols + c);
        }
      }
    }
    return path;
  }

  getSpecialMovesRules(curIdx, nextIdx) {
    const cols = this.size;
    const specials = [];
    const rCur = Math.floor(curIdx / cols);
    const rNxt = Math.floor(nextIdx / cols);
    const cCur = curIdx % cols;

    // Bifurcação: 3ª -> 4ª fila, com alternativa para 2ª fila (espelho)
    if (rCur === 2 && rNxt === 3) {
      const rr = 1; // 2ª fila (0-based)
      const cc = cCur;
      specials.push(rr * cols + cc);
    }

    return specials;
  }

  computeNextPositionsRules(idx) {
    const rows = 4;
    const cols = this.size;
    const path = this.getBoardPathRules();

    const idxToPathPos = new Map();
    for (let i = 0; i < path.length; i++) {
      idxToPathPos.set(path[i], i);
    }

    const p = idxToPathPos.get(idx);
    if (p == null) return [];

    const result = [];

    if (p + 1 < path.length) {
      const cur = path[p];
      const nxt = path[p + 1];
      result.push(nxt, ...this.getSpecialMovesRules(cur, nxt));
    } else {
      // Última casa do path (fim da 4ª fila) → "descer" para a 3ª (mesma coluna)
      const cur = path[p];
      const rCur = Math.floor(cur / cols);
      if (rCur === rows - 1) {
        const cCur = cur % cols;
        const aboveIdx = (rows - 2) * cols + cCur; // (linha 2, mesma coluna)
        result.push(aboveIdx);
      }
    }

    return [...new Set(result)];
  }

  advanceVariantsRules(startIdx, steps) {
    let frontier = [startIdx];
    for (let i = 0; i < steps; i++) {
      const next = [];
      for (const pos of frontier) {
        next.push(...this.computeNextPositionsRules(pos));
      }
      frontier = [...new Set(next)];
    }
    return frontier;
  }

  canMovePieceRules(board, player, roll, idx) {
    if (!roll || roll <= 0) return false;
    const piece = board[idx];
    if (!piece || piece.player !== player) return false;

    // Regra "must be a tab(1) to start moving":
    const isInitial = !piece.inMotion; // nunca mexeu
    return roll === 1 || !isInitial;
  }

  validTargetsFromRules(board, player, roll, idx) {
    if (!roll || roll <= 0) return [];

    const rows = 4;
    const cols = this.size;
    const mirror = (i) => this.mirrorIndexForRules(i);

    let start = idx;
    if (player === "B") start = mirror(start);

    const destsGold = this.advanceVariantsRules(start, roll);
    const dests = player === "B" ? destsGold.map(mirror) : destsGold;

    const piece = board[idx];
    const rowFrom = Math.floor(idx / cols);
    const playerStartRow = player === "G" ? 0 : rows - 1;
    const playerFinalRow = player === "G" ? rows - 1 : 0;

    return dests.filter((i) => {
      const p = board[i];
      const rowTo = Math.floor(i / cols);

      // (1) não pode cair em casa da mesma cor
      if (p && p.player === player) return false;

      // (2) se já esteve na fila FINAL → não voltar a entrar nela vindo de fora
      if (
        piece &&
        piece.wasOnLastRow &&
        rowFrom !== playerFinalRow &&
        rowTo === playerFinalRow
      ) {
        return false;
      }

      // (3) não pode voltar à fila INICIAL depois de a deixar
      if (rowTo === playerStartRow && rowFrom !== playerStartRow) {
        return false;
      }

      // (4) só pode ENTRAR na fila FINAL se a fila INICIAL estiver vazia
      if (rowTo === playerFinalRow) {
        const startRowCells = board.slice(
          playerStartRow * cols,
          (playerStartRow + 1) * cols
        );
        const hasStartPieces = startRowCells.some(
          (cell) => cell && cell.player === player
        );
        if (hasStartPieces) return false;
      }

      return true;
    });
  }

  highlightTargets(indices) {
    const boardEl = this.ui.boardEl;
    if (!boardEl) return;
    indices.forEach((i) => {
      const cellEl = boardEl.children[i];
      if (cellEl) cellEl.classList.add("target");
    });
  }

  // ==================== RENDER / CONTADORES ====================

  countPiecesForPlayer(nick) {
    if (!this.pieces || !this.players) return 0;
    const color = this.players[nick]; // "Blue" | "Red"
    if (!color) return 0;
    return this.pieces.filter((p) => p && p.color === color).length;
  }

  renderBoard() {
    if (!this.pieces) return;

    const boardMatrix = [];
    for (let r = 0; r < 4; r++) {
      const row = [];
      for (let c = 0; c < this.size; c++) {
        const idx = r * this.size + c;
        const raw = this.pieces[idx];

        if (raw) {
          const player = raw.color === "Blue" ? "G" : "B";
          let type = "initial";
          if (raw.reachedLastRow) type = "final";
          else if (raw.inMotion) type = "moved";

          row.push({ player, type });
        } else {
          row.push(null);
        }
      }
      boardMatrix.push(row);
    }

    const myColor = this.getMyColor();

    this.ui.renderBoard(boardMatrix, myColor, (r, c) =>
      this.handleCellClick(r, c)
    );

    let goldCount = 0;
    let blackCount = 0;
    this.pieces.forEach((p) => {
      if (!p) return;
      const col = p.color === "Blue" ? "G" : "B";
      if (col === "G") goldCount++;
      else blackCount++;
    });
    this.ui.updateCounts(goldCount, blackCount);
  }

  getMyColor() {
    if (!this.players || !this.myNick) return "G";
    const c = this.players[this.myNick]; // "Blue"|"Red"
    return c === "Red" ? "B" : "G";
  }

  getCurrentPlayerSymbol() {
    if (!this.currentTurn || !this.players) return "G";
    const c = this.players[this.currentTurn];
    return c === "Red" ? "B" : "G";
  }

  // ==================== Botões (Throw / Skip) ====================

  updateRollButton() {
    const isMyTurn = this.currentTurn === this.myNick;
    const iMustPass = this.mustPass === this.myNick;

    const needsRoll =
      this.step === "from" &&
      !iMustPass &&
      (this.dice === null || this.keepPlaying === true);

    console.log("[DEBUG RollButton]", {
      myNick: this.myNick,
      currentTurn: this.currentTurn,
      step: this.step,
      dice: this.dice,
      keepPlaying: this.keepPlaying,
      mustPass: this.mustPass,
      isMyTurn,
      iMustPass,
      needsRoll,
      canRoll,
    });

    const canRoll = isMyTurn && needsRoll;
    this.ui.setRollEnabled(canRoll);

  }

  updateSkipButton() {
    const skipBtn = document.querySelector(".skip-btn");
    if (!skipBtn) return;

    const mustSkipNow =
      this.mustPass === this.myNick && this.currentTurn === this.myNick;

    if (mustSkipNow) {
      skipBtn.disabled = false;
      skipBtn.classList.add("enabled");
      skipBtn.onclick = () => {
        skipBtn.disabled = true;
        skipBtn.classList.remove("enabled");
        this.handlePass();
      };
    } else {
      skipBtn.disabled = true;
      skipBtn.classList.remove("enabled");
      skipBtn.onclick = null;
    }
  }

  // ==================== Sticks ====================

  getStickSymbol(value) {
    const symbols = {
      1: "⎮•••",
      2: "⎮⎮••",
      3: "⎮⎮⎮•",
      4: "⎮⎮⎮⎮",
      5: "•••••",
      6: "••••",
    };
    return symbols[value] || "⎮⎮⎮⎮";
  }
}
