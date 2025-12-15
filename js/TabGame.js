// js/TabGame.js
import { Piece } from "./Piece.js";
import { AIPlayer } from "./AIPlayer.js";

// Classe Principal — TabGame
export class TabGame {
  constructor(ui) {
    this.ui = ui;
    this.rows = 4;
    this.cols = 9;
    this.board = [];
    this.selected = null;
    this.currentRoll = null;
    this.currentPlayer = "G";
    this.gameOver = false;
    this.isRolling = false;

    // Controlo de lançamentos por turno (pode haver vários por turno, 1/4/6 concedem novo lançamento)
    this.turnRolls = 0; // nº de lançamentos no turno atual
    this.extraRollPending = false; // true se tem direito a relançar (1/4/6)

    this.ai = null;
  }

  // Inicialização do Jogo
  init(cols = 9, first = "Gold") {
    this.cols = cols;
    this.rows = 4;
    this.currentPlayer = first === "Gold" ? "G" : "B";
    this.board = Array(this.rows * this.cols).fill(null);

    // Peças iniciais
    for (let c = 0; c < cols; c++) {
      this.board[0 * cols + c] = new Piece("G"); // linha 0
      this.board[3 * cols + c] = new Piece("B"); // linha 3
    }

    // Reset de estado
    this.selected = null;
    this.currentRoll = null;
    this.gameOver = false;
    this.turnRolls = 0;
    this.extraRollPending = false;
    this.isRolling = false;

    // UI reset
    this.ui.clearHighlights(true);
    this.ui.setSkipEnabled(false);
    this.ui.renderBoard(this.getBoardMatrix(), this.currentPlayer, (r, c) => this.handleCellClick(r, c));
    this.ui.refreshRollButton(this);
    this.updateCounts();
    this.ui.addMessage("System", `${this.currentPlayer === "G" ? "Gold" : "Black"} begins!`);

    // Cria IA se modo for Player vs Computer
    this.ai = null;
    if (this.ui.modeSelect?.value === "pvc") {
      const level = this.ui.aiLevelSelect?.value || "easy";
      this.ai = new AIPlayer(level, this);
      this.ui.addMessage("System", `AI (${level}) is ready.`);
    }

    // Se o modo for PvC e o primeiro jogador for a IA (Black)
    if (this.ui.modeSelect?.value === "pvc" && this.currentPlayer === "B" && this.ai) {
      setTimeout(() => this.ai.makeMove(), 800);
    }
  }

  // Funções auxiliares
  mirrorIndex(idx) {
    return this.rows * this.cols - 1 - idx;
  }

  getBoardMatrix() {
    const matrix = [];
    for (let r = 0; r < this.rows; r++) {
      matrix.push(this.board.slice(r * this.cols, (r + 1) * this.cols));
    }
    return matrix;
  }

  updateCounts() {
    let g = 0,
      b = 0;
    for (const cell of this.board) {
      if (cell && cell.player === "G") g++;
      if (cell && cell.player === "B") b++;
    }
    this.ui.updateCounts(g, b);
  }

  render() {
    this.ui.renderBoard(this.getBoardMatrix(), this.currentPlayer, (r, c) => this.handleCellClick(r, c));
    const boardEl = this.ui.boardEl;
    if (!boardEl) return;

    for (let i = 0; i < this.board.length; i++) {
      const piece = this.board[i];
      const cellEl = boardEl.children[i];
      if (!cellEl) continue;

      const chip = cellEl.querySelector(".chip");
      if (!chip) continue;

      chip.classList.remove("initial", "moved", "final");
      if (piece) chip.classList.add(piece.type);
    }
  }

  // Regra de movimento
  canMovePiece(piece) {
    if (!piece) return false;
    return this.currentRoll === 1 || piece.type !== "initial";
  }

  // Lançar os Paus (Sticks) — versão canvas/frames
  rollSticks() {
    if (this.gameOver || this.isRolling) return;
    if (this.currentRoll !== null) return; // já há roll ativo
    if (!(this.extraRollPending || this.turnRolls === 0)) return; // não tem direito a lançar

    this.isRolling = true;
    this.ui.setRollEnabled(false);
    this.ui.setSkipEnabled(false);

    // Simulação do lançamento (resultado final)
    const sticks = Array(4)
      .fill(0)
      .map(() => Math.random() < 0.5);
    const upCount = sticks.filter(Boolean).length;
    const value = upCount === 0 ? 6 : upCount;

    // animação (canvas) começa já
    this.ui.playSound("https://actions.google.com/sounds/v1/objects/wood_hit_mallet.ogg");
    this.ui.animateSticks(sticks, value, false);

    // só depois da animação (~1s) é que aplicamos estado + lógica
    setTimeout(() => {
      // regista o lançamento deste turno
      this.turnRolls += 1;
      this.currentRoll = value;

      // extra roll SEMPRE que sair 1/4/6
      this.extraRollPending = value === 1 || value === 4 || value === 6;

      this.ui.playSound("https://actions.google.com/sounds/v1/cartoon/wood_impact_plank.ogg");
      this.ui.addMessage("System", `Sticks rolled: ${value}`);

      // Verificar se há jogadas possíveis
      const hasMovable = this.board.some((cell) => {
        if (!cell || cell.player !== this.currentPlayer) return false;
        return this.canMovePiece(cell);
      });

      // Caso não haja jogadas possíveis
      if (!hasMovable) {
        if (this.extraRollPending) {
          // pode relançar (1/4/6)
          this.ui.addMessage("System", `No moves available, but you keep the extra roll (1/4/6).`);
          this.currentRoll = null;
          this.ui.refreshRollButton(this);

          // liberta o lock
          this.isRolling = false;
          return;
        }

        // sem jogadas e sem extra roll: tem de passar turno
        this.ui.addMessage("System", `No valid moves available — skip turn.`);
        this.currentRoll = null;
        this.ui.refreshRollButton(this);

        // PvC: IA (Black) passa automaticamente
        if (this.ui.modeSelect?.value === "pvc" && this.currentPlayer === "B" && this.ai) {
          this.ui.addMessage("System", "AI skips turn automatically (no valid moves).");
          this.isRolling = false;

          setTimeout(() => {
            this.switchTurn();
            this.ui.refreshRollButton(this);
          }, 800);

          return;
        }

        // PvP: habilita botão Skip
        this.ui.setSkipEnabled(true, () => {
          this.ui.setSkipEnabled(false);
          this.switchTurn();
        });

        this.isRolling = false;
        return;
      }

      // Há jogadas: mantém currentRoll ativo (jogador escolhe peça)
      this.ui.refreshRollButton(this);

      // Liberta a flag (permitir cliques no tabuleiro, etc.)
      this.isRolling = false;
    }, 1000);
  }

  // Interação do jogador
  handleCellClick(r, c) {
    if (this.gameOver) return;
    const idx = r * this.cols + c;
    const cellValue = this.board[idx];

    if (!this.currentRoll) {
      this.ui.addMessage("System", "Roll the sticks first!");
      return;
    }

    // Seleção de peça
    if (this.selected === null && cellValue && cellValue.player === this.currentPlayer) {
      if (!this.canMovePiece(cellValue)) {
        this.ui.addMessage("System", `Cannot move initial pieces with roll = ${this.currentRoll}.`);
        return;
      }

      this.selected = idx;
      this.ui.clearHighlights(true);
      const selectedEl = this.ui.boardEl?.children[idx];
      if (selectedEl) selectedEl.classList.add("selected");

      const targets = this.validTargetsFrom(idx);
      this.highlightTargets(targets);
      if (targets.length === 0) {
        this.ui.addMessage("System", `No valid moves with ${this.currentRoll}.`);
      }
      return;
    }

    // Deseleção
    if (this.selected === idx) {
      this.ui.clearHighlights(true);
      this.selected = null;
      return;
    }

    // Mover
    if (this.selected !== null) {
      const targets = this.validTargetsFrom(this.selected);
      if (targets.includes(idx)) {
        this.movePiece(this.selected, idx);
        this.ui.clearHighlights(true);
        this.selected = null;
      } else {
        this.ui.addMessage("System", `Invalid move: move exactly ${this.currentRoll} steps.`);
      }
    }
  }

  highlightTargets(targets) {
    targets.forEach((idx) => {
      const el = this.ui.boardEl?.children[idx];
      if (el) el.classList.add("target");
    });
  }

  // Movimento de Peças
  movePiece(fromIdx, toIdx) {
    
    const movingPiece = this.board[fromIdx];
    if (movingPiece) {
      // ghost move (não bloqueia lógica)
      this.ui.animatePieceMove?.(fromIdx, toIdx, { player: movingPiece.player, type: movingPiece.type });
    }

    const targetPiece = this.board[toIdx];
    

    // se havia peça no destino, é captura -> flash + shake no destino
    if (targetPiece) {
      // se estiveres a usar a animação de movimento (~380ms), fica melhor disparar depois
      setTimeout(() => this.ui.fxCapture?.(toIdx), 380);
    }

    this.board[toIdx] = movingPiece;
    this.board[fromIdx] = null;

    if (!movingPiece) return;

    // Atualiza estado da peça
    if (!movingPiece.moved) {
      movingPiece.moved = true;
      movingPiece.type = "moved";
    }

    // Debug informativo
    const rowFrom = Math.floor(fromIdx / this.cols);
    const rowToRaw = Math.floor(toIdx / this.cols);

    // Corrige para jogador preto (espelhamento vertical)
    const rowTo = movingPiece.player === "B" ? this.rows - 1 - rowToRaw : rowToRaw;

    console.log(`[movePiece] ${movingPiece.player} from row ${rowFrom} to row ${rowTo} (raw=${rowToRaw})`, {
      moved: movingPiece.moved,
      wasOnLastRow: movingPiece.wasOnLastRow,
      type: movingPiece.type,
    });

    // Marca a peça se entrar na última fila (r = 3 no referencial do jogador)
    if (movingPiece && rowTo === 3) {
      if (!movingPiece.wasOnLastRow) {
        movingPiece.wasOnLastRow = true;
        movingPiece.type = "final";
        this.ui.addMessage("System", "Piece reached the last row for the first time.");
        console.log("[movePiece] → marcou como FINAL");
      }
    } else if (movingPiece.wasOnLastRow && rowTo !== 3) {
      // Se já esteve na última fila e saiu dela - mantém visual de final
      movingPiece.type = "final";
    }

    console.log("[movePiece] AFTER update:", {
      moved: movingPiece.moved,
      wasOnLastRow: movingPiece.wasOnLastRow,
      type: movingPiece.type,
    });

    // Atualiza o tabuleiro e contadores
    this.render();
    this.updateCounts();

    // Vitória
    const winner = this.checkWin();
    if (winner) {
      this.endGameWithWinner(winner, "wins the game! 🎉");
      return;
    }

    // Extra roll SEMPRE que o lançamento atual foi 1/4/6
    if (this.currentRoll === 1 || this.currentRoll === 4 || this.currentRoll === 6) {
      this.ui.addMessage("System", `Extra roll granted (1/4/6). Same player rolls again.`);
      this.extraRollPending = true;
      this.currentRoll = null;
      this.ui.refreshRollButton(this);

      // Se for IA (modo PvC), deixa que ela trate sozinha do novo lançamento
      if (this.ui.modeSelect?.value === "pvc" && this.currentPlayer === "B" && this.ai) {
        setTimeout(() => {
          this.ai.makeMove();
        }, 1800);
      }
      return;
    }

    // Fim de turno normal
    this.currentRoll = null;
    this.switchTurn();
  }

  // Gestão de Turnos
  switchTurn() {
    this.currentPlayer = this.currentPlayer === "G" ? "B" : "G";
    const name = this.currentPlayer === "G" ? "Gold" : "Black";
    this.ui.addMessage("System", `It's now ${name}'s turn.`);

    // reset do controlo de rolls por turno
    this.turnRolls = 0;
    this.extraRollPending = false;

    this.selected = null;
    this.ui.clearHighlights(true);
    this.ui.setSkipEnabled(false);

    this.render();
    this.ui.refreshRollButton(this);

    // Se for modo PvC e for a vez da IA (preto)
    if (this.ui.modeSelect?.value === "pvc" && this.currentPlayer === "B" && this.ai) {
      setTimeout(() => this.ai.makeMove(), 800);
    }
  }

  // Fim de jogo
  quitGame() {
    if (this.gameOver) return;
    const winner = this.currentPlayer === "G" ? "Black" : "Gold";
    this.endGameWithWinner(winner, "wins by resignation.");
  }

  endGameWithWinner(winner, reasonText) {
    this.gameOver = true;
    this.ui.addMessage("System", `${winner} ${reasonText}`);
    const winSpan = winner === "Gold" ? this.ui.goldCounter : this.ui.blackCounter;
    winSpan?.classList.add("win");
    const piecesLeft = this.countPieces(winner);

    if (window.recordGameResult) {
      window.recordGameResult(winner, piecesLeft, "—");
    }

    this.ui.setRollEnabled(false);
    this.ui.setSkipEnabled(false);
  }

  countPieces(winner) {
    let g = 0,
      b = 0;
    for (const cell of this.board) {
      if (cell && cell.player === "G") g++;
      if (cell && cell.player === "B") b++;
    }
    return winner === "Gold" ? g : b;
  }

  checkWin() {
    let g = 0,
      b = 0;
    for (const cell of this.board) {
      if (cell && cell.player === "G") g++;
      if (cell && cell.player === "B") b++;
    }
    if (g === 0) return "Black";
    if (b === 0) return "Gold";
    return null;
  }

  // Lógica de Caminho e Destinos
  getBoardPath() {
    const path = [];
    for (let r = 0; r < this.rows; r++) {
      if (r % 2 === 0) for (let c = this.cols - 1; c >= 0; c--) path.push(r * this.cols + c);
      else for (let c = 0; c < this.cols; c++) path.push(r * this.cols + c);
    }
    return path;
  }

  getPathIndex(idx) {
    const path = this.getBoardPath();
    return path.indexOf(idx);
  }

  getNextOnPath(idx) {
    const path = this.getBoardPath();
    const pos = this.getPathIndex(idx);
    return pos >= 0 && pos + 1 < path.length ? path[pos + 1] : null;
  }

  getSpecialMoves(curIdx, nextIdx) {
    const specials = [];
    const rCur = Math.floor(curIdx / this.cols);
    const rNxt = Math.floor(nextIdx / this.cols);
    const cCur = curIdx % this.cols;

    // Apenas a bifurcação correta: 3ª -> 4ª fila, alternativa para 2ª (espelho)
    if (rCur === 2 && rNxt === 3) {
      const rr = 1; // 2ª fila (0-based)
      const cc = cCur; // mesma coluna (espelho)
      specials.push(rr * this.cols + cc);
    }

    return specials;
  }

  computeNextPositions(idx) {
    const path = this.getBoardPath();

    // índice de tabuleiro -> posição no path
    const idxToPathPos = new Map();
    for (let i = 0; i < path.length; i++) idxToPathPos.set(path[i], i);

    const p = idxToPathPos.get(idx);
    if (p == null) return [];

    const result = [];

    if (p + 1 < path.length) {
      // Passo normal dentro do path + bifurcação (se aplicável)
      const cur = path[p];
      const nxt = path[p + 1];
      result.push(nxt, ...this.getSpecialMoves(cur, nxt));
    } else {
      // Última casa do path: permitir "subir" para a 3ª fila (mesma coluna)
      const cur = path[p];
      const rCur = Math.floor(cur / this.cols);
      if (rCur === 3) {
        const cCur = cur % this.cols;
        const aboveIdx = 2 * this.cols + cCur; // (r=2, mesma coluna)
        result.push(aboveIdx);
      }
    }

    return [...new Set(result)];
  }

  advanceVariants(startIdx, steps) {
    let frontier = [startIdx];
    for (let i = 0; i < steps; i++) {
      const next = [];
      for (const pos of frontier) next.push(...this.computeNextPositions(pos));
      frontier = [...new Set(next)];
    }
    return frontier;
  }

  // Destinos Válidos
  validTargetsFrom(idx) {
    const roll = this.currentRoll;
    if (!roll || roll <= 0) return [];

    const board = this.board;
    const player = this.currentPlayer;
    const mirror = this.mirrorIndex.bind(this);

    // Converter para o espaço Gold se for Black
    let start = idx;
    if (player === "B") start = mirror(start);

    // Avançar exatamente 'roll' passos no caminho Gold
    const destsGold = this.advanceVariants(start, roll);

    // Voltar ao espaço real se for Black
    const dests = player === "B" ? destsGold.map(mirror) : destsGold;

    const piece = this.board[idx];

    return dests.filter((i) => {
      const p = board[i];
      const rowTo = Math.floor(i / this.cols);
      const rowFrom = Math.floor(idx / this.cols);

      // (1) não pode mover para casa ocupada pela mesma cor
      if (p && p.player === player) return false;

      // linhas físicas (no tabuleiro)
      const playerStartRow = player === "G" ? 0 : 3;
      const playerFinalRow = player === "G" ? 3 : 0;

      // (2) se já esteve na fila FINAL → não pode voltar a ENTRAR nela vindo de fora
      if (piece && piece.wasOnLastRow && rowFrom !== playerFinalRow && rowTo === playerFinalRow) {
        return false;
      }

      // (3) proibir voltar à fila inicial após a ter deixado
      if (rowTo === playerStartRow && rowFrom !== playerStartRow) {
        return false;
      }

      // (4) só pode ENTRAR na fila FINAL se a fila INICIAL já estiver vazia
      if (rowTo === playerFinalRow) {
        const hasStartPieces = this.board
          .slice(playerStartRow * this.cols, (playerStartRow + 1) * this.cols)
          .some((cell) => cell && cell.player === player);
        if (hasStartPieces) return false;
      }

      return true;
    });
  }
}
