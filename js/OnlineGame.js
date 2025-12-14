// js/OnlineGame.js

import { Piece } from "./Piece.js";
import { ServerAPI } from "./ServerAPI.js";

/**
 * Online PvP controller.
 * Server is authoritative: client only sends commands and renders `update`.
 */
export class OnlineGame {
  constructor(ui, opts = {}) {
    this.ui = ui;
    this.rows = 4;

    this.serverUrl = opts.serverUrl || "http://twserver.alunos.dcc.fc.up.pt:8008";
    this.group = Number.isInteger(opts.group) ? opts.group : 99; // TODO: set your group id
    this.api = new ServerAPI(this.serverUrl);

    this.nick = null;
    this.password = null;

    this.gameId = null;
    this.eventSource = null;

    // last known server state
    this.size = 9;
    this.players = null;   // {nick: "Blue"|"Red"}
    this.initial = null;   // nick
    this.turn = null;      // nick
    this.step = null;      // "from"|"to"|"take"
    this.dice = null;      // null or {value, keepPlaying, stickValues}
    this.mustPass = null;  // null or nick
    this.pieces = null;    // array len 4*size
    this.selected = null;  // array of indices
    this.lastCell = null;  // number index from server (if provided)
    this.winner = null;

    // View preference: rotate board for the non-initial player.
    this.viewRotated = false;

    // prevent chat spam
    this._lastStatusMsg = "";

    // bind
    this.handleUpdate = this.handleUpdate.bind(this);
  }

  // --------- AUTH ---------

  async login(nick, password) {
    // server uses /register for both registration and password verification
    await this.api.register(String(nick), String(password));
    this.nick = String(nick);
    this.password = String(password);
  }

  isLoggedIn() {
    return !!(this.nick && this.password);
  }

  // --------- GAME LIFECYCLE ---------

  async start(size) {
    if (!this.isLoggedIn()) {
      throw new Error("Login required (nick/password)");
    }
    this.size = size;
    this.ui.addMessage("System", `Online: joining group ${this.group} (size ${size})...`);
    const { game } = await this.api.join(this.group, this.nick, this.password, size);
    this.gameId = game;
    this.ui.addMessage("System", `Online: joined game ${game}. Waiting for opponent / updates...`);

    // Start SSE
    this.closeStream();
    this.eventSource = this.api.openUpdateStream(
      this.gameId,
      this.nick,
      this.handleUpdate,
      (err) => {
        console.error("SSE error", err);
        this.ui.addMessage("System", "Online: connection error (update stream)." );
      }
    );
  }

  async leave() {
    if (!this.gameId) return;
    try {
      await this.api.leave(this.nick, this.password, this.gameId);
    } finally {
      this.closeStream();
      this.gameId = null;
    }
  }

  closeStream() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // --------- COMMANDS ---------

  async roll() {
    if (!this.gameId) return;
    return this.api.roll(this.nick, this.password, this.gameId);
  }

  async pass() {
    if (!this.gameId) return;
    return this.api.pass(this.nick, this.password, this.gameId);
  }

  async notifyByCoords(r, c) {
    if (!this.gameId) return;

    // Só podes jogar na tua vez
    if (this.turn && this.turn !== this.nick) {
      this.ui.addMessage("System", "Not your turn.");
      return;
    }

    // Se ainda não lançou o dado, não faz sentido selecionar peça
    if (this.dice === null) {
      this.ui.addMessage("System", "Roll the sticks first!");
      return;
    }

    const idx = this.uiToServerIndex(r, c);

    // Se estás a escolher destino/captura, só deixa clicar em:
    // - origem (para cancelar)
    // - destinos destacados pelo servidor (selected)
    if (this.step === "to" || this.step === "take") {
      const origin = (typeof this.lastCell === "number") ? this.lastCell : null;
      const targets = Array.isArray(this.selected) ? this.selected : [];

      const isOrigin = (origin !== null && idx === origin);
      const isTarget = targets.includes(idx);

      if (!isOrigin && !isTarget) {
        this.ui.addMessage("System", "Choose one of the highlighted squares (or click the piece again to cancel).");
        return;
      }
    }

    try {
      await this.api.notify(this.nick, this.password, this.gameId, idx);
    } catch (e) {
      this.ui.addMessage("System", `Invalid move: ${e.message}`);
    }
  }


  // --------- UPDATE HANDLER ---------

  handleUpdate(data) {
    if (!data || typeof data !== "object") return;
    if (data.error) {
      this.ui.addMessage("System", `Server: ${data.error}`);
      return;
    }

    if (typeof data.game === "string") this.gameId = data.game;
    if (typeof data.initial === "string") this.initial = data.initial;
    if (typeof data.turn === "string") this.turn = data.turn;
    if (typeof data.step === "string") this.step = data.step;
    if ("dice" in data) this.dice = data.dice;
    if ("mustPass" in data) this.mustPass = data.mustPass;
    if (Array.isArray(data.pieces)) this.pieces = data.pieces;
    if (Array.isArray(data.selected)) this.selected = data.selected;
    if ("cell" in data) this.lastCell = data.cell;
    if ("players" in data && data.players) this.players = data.players;
    if (typeof data.winner === "string" || data.winner === null) this.winner = data.winner;

    // Determine view rotation when we learn who is initial.
    if (this.initial) {
      this.viewRotated = (this.nick !== this.initial);
    }

    // Render whenever we have pieces or important state changes.
    this.render();

    // If game ended, close stream.
    if ("winner" in data) {
      if (typeof data.winner === "string") {
        this.statusOnce(`Game over. Winner: ${data.winner}`);
        this.closeStream();
      }
      if (data.winner === null) {
        this.statusOnce("Game ended (no winner)." );
        this.closeStream();
      }
    }
  }

  // --------- RENDER ---------

  render() {
    // Build a board matrix for UIManager
    const cols = this.size;
    const matrix = Array.from({ length: this.rows }, () => Array(cols).fill(null));

    if (Array.isArray(this.pieces)) {
      for (let i = 0; i < this.pieces.length; i++) {
        const p = this.pieces[i];
        if (!p) continue;

        const { r, c } = this.serverIndexToUI(i);
        const owner = this.isInitialColor(p) ? "B" : "G";

        const piece = new Piece(owner);

        // map server state to visuals
        if (p.reachedLastRow) piece.type = "final";
        else if (p.inMotion) piece.type = "moved";
        else piece.type = "initial";

        matrix[r][c] = piece;
      }
    }

    // Update current player highlight
    const currentPlayer = (this.turn && this.initial) ? (this.turn === this.initial ? "B" : "G") : "G";

    this.ui.clearHighlights(true);
    this.ui.renderBoard(matrix, currentPlayer, (r, c) => this.notifyByCoords(r, c));

    // Counts
    const counts = this.countPiecesFromMatrix(matrix);
    this.ui.updateCounts(counts.g, counts.b);

    // Dice UI
    if (this.dice && typeof this.dice.value === "number") {
      // show sticks symbol for 1..4 and 6
      const val = this.dice.value;
      const symbol = this.symbolForDice(val);
      this.ui.animateSticks(symbol, val, false);
    } else {
      // no dice currently
      this.ui.resultEl?.classList.remove("show");
    }

    // Enable/disable buttons (authoritative-ish, but server still checks)
    const myTurn = (this.turn === this.nick);
    const canRoll = myTurn && (this.dice === null || (this.dice && this.dice.keepPlaying));
    this.ui.setRollEnabled(!!canRoll);

    const canPass = myTurn && (this.mustPass === this.nick);
    this.ui.setSkipEnabled(!!canPass, () => this.pass());

    // Highlights de destinos válidos (só durante a escolha de destino/captura)
    if ((this.step === "to" || this.step === "take") && Array.isArray(this.selected) && this.selected.length > 0) {
      const targets = this.selected
        .map((idx) => this.serverIndexToUI(idx))
        .map(({ r, c }) => ({ r, c }));
      this.ui.highlightTargets(targets);
    }

    // Try to highlight origin when step is "to" or "take".
    const originIdx = (typeof this.lastCell === "number") ? this.lastCell : null;
    if ((this.step === "to" || this.step === "take") && originIdx !== null) {
      const { r, c } = this.serverIndexToUI(originIdx);
      this.ui.markSelected(r, c);
    }

    // Status message (no chat spam)
    if (!this.gameId) return;
    if (!this.players) {
      this.statusOnce("Online: waiting for pairing..." );
      return;
    }
    if (this.turn) {
      if (myTurn) {
        if (this.mustPass === this.nick) this.statusOnce("You must pass." );
        else if (this.dice === null) this.statusOnce("Your turn: roll the sticks." );
        else this.statusOnce(`Your turn: ${this.step || "play"}.`);
      } else {
        this.statusOnce(`Waiting for ${this.turn}...`);
      }
    }
  }

  statusOnce(msg) {
    if (!msg) return;
    if (msg === this._lastStatusMsg) return;
    this._lastStatusMsg = msg;
    this.ui.addMessage("System", msg);
  }

  countPiecesFromMatrix(matrix) {
    let g = 0, b = 0;
    for (const row of matrix) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.player === "G") g++;
        if (cell.player === "B") b++;
      }
    }
    return { g, b };
  }

  symbolForDice(value) {
    // matches the local UI symbols
    // 1..4 => number of upright sticks, 6 => all down (••••)
    if (value === 6) return "••••";
    if (value === 1) return "⎮•••";
    if (value === 2) return "⎮⎮••";
    if (value === 3) return "⎮⎮⎮•";
    if (value === 4) return "⎮⎮⎮⎮";
    return "—";
  }

  // --------- COLOR / ROLE MAPPING ---------

  isInitialColor(serverPieceObj) {
    // Map server piece colors into our Gold/Black by anchoring Gold to the `initial` player.
    if (!this.players || !this.initial) {
      // fallback: treat Blue as Gold
      return String(serverPieceObj?.color) === "Blue";
    }
    const initialColor = this.players[this.initial];
    return String(serverPieceObj?.color) === String(initialColor);
  }

  // --------- INDEX MAPPING ---------

  // Converte índice do servidor (0..4*size-1) para coordenadas UI (row 0 = topo)
  serverIndexToUI(idx) {
    const size = this.size;
    const rB = Math.floor(idx / size);   // linha a partir de baixo: 0..3
    const off = idx % size;              // offset dentro da linha

    // SERPENTE (como tu queres na vista do jogador):
    // fila de baixo e 3ª fila: esquerda -> direita
    // 2ª e 4ª fila: direita -> esquerda
    let r = 3 - rB;
    let c = (rB % 2 === 0) ? off : (size - 1 - off);

    // se o tabuleiro estiver rodado para o jogador não-inicial
    if (this.viewRotated) {
      r = 3 - r;
      c = (size - 1) - c;
    }
    return { r, c };
  }

  uiToServerIndex(r, c) {
    const size = this.size;

    // desfaz rotação (se estava rodado)
    if (this.viewRotated) {
      r = 3 - r;
      c = (size - 1) - c;
    }

    const rB = 3 - r;
    const off = (rB % 2 === 0) ? c : (size - 1 - c);
    return rB * size + off;
  }

}
