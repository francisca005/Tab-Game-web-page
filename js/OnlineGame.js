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
    this.group = Number.isInteger(opts.group) ? opts.group : 99;
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
    this.mustPass = null;  // null | nick | true
    this.pieces = null;    // array len 4*size
    this.selected = null;  // array of indices
    this.lastCell = null;  // number index or object
    this.winner = null;    // string | null | (never undefined)

    // View preference: rotate board for the non-initial player.
    this.viewRotated = false;

    // prevent chat spam
    this._lastStatusMsg = "";

    // roll gating (kept, but not relied on for server rules)
    this._awaitingMove = false;
    this._lastRollKeepPlaying = false;
    this._extraRollReady = false;

    this.handleUpdate = this.handleUpdate.bind(this);
  }

  // --------- AUTH ---------

  async login(nick, password) {
    await this.api.register(String(nick), String(password));
    this.nick = String(nick);
    this.password = String(password);
  }

  isLoggedIn() {
    return !!(this.nick && this.password);
  }

  // --------- GAME LIFECYCLE ---------

  resetStateForNewGame(size) {
    this.closeStream();

    this.gameId = null;
    this.size = size;

    this.players = null;
    this.initial = null;
    this.turn = null;
    this.step = null;
    this.dice = null;
    this.mustPass = null;
    this.pieces = null;
    this.selected = null;
    this.lastCell = null;
    this.winner = null;

    this.viewRotated = false;
    this._lastStatusMsg = "";

    this._awaitingMove = false;
    this._lastRollKeepPlaying = false;
    this._extraRollReady = false;
  }

  async start(size) {
    if (!this.isLoggedIn()) throw new Error("Login required (nick/password)");

    // ✅ IMPORTANT: se já tinhas um jogo, faz leave ANTES de resetar o gameId
    if (this.gameId) {
      try { await this.api.leave(this.nick, this.password, this.gameId); }
      catch { /* ignore */ }
    }

    this.resetStateForNewGame(size);
    this.ui.resetGameUI();

    this.ui.addMessage("System", `Online: joining group ${this.group} (size ${size})...`);

    const { game } = await this.api.join(this.group, this.nick, this.password, size);
    this.gameId = game;
    this.ui.addMessage("System", `Online: joined game ${game}. Waiting for opponent / updates...`);

    this.closeStream();
    this.eventSource = this.api.openUpdateStream(
      this.gameId,
      this.nick,
      this.handleUpdate,
      (err) => {
        console.error("SSE error", err);
        this.ui.addMessage("System", "Online: connection error (update stream).");
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
      this.winner = null;
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
    if (this.winner !== null) return;

    if (this.turn && this.turn !== this.nick) {
      this.statusOnce("Wait for opponents play");
      return;
    }
    if (this.step === "to" || this.step === "take") return;

    try {
      return await this.api.roll(this.nick, this.password, this.gameId);
    } catch (e) {
      this.ui.addMessage("System", e.message || String(e));
    }
  }

  async pass() {
    if (!this.gameId) return;
    if (this.winner !== null) return;

    if (this.turn && this.turn !== this.nick) {
      this.statusOnce("Wait for opponents play");
      return;
    }

    const mustSkip = (this.mustPass === this.nick || this.mustPass === true);
    if (!mustSkip) return;

    try {
      return await this.api.pass(this.nick, this.password, this.gameId);
    } catch (e) {
      const msg = (e.message || "").toLowerCase().includes("not your turn")
        ? "Wait for opponents play"
        : (e.message || String(e));
      this.ui.addMessage("System", msg);
    }
  }

  async notifyByCoords(r, c) {
    if (!this.gameId) return;
    if (this.winner !== null) return;

    // Só podes jogar na tua vez
    if (this.turn && this.turn !== this.nick) {
      this.ui.addMessage("System", "Not your turn.");
      return;
    }

    const isChoosingDestination = (this.step === "to" || this.step === "take");
    if (this.dice === null && !isChoosingDestination) {
      this.ui.addMessage("System", "Roll the sticks first!");
      return;
    }

    const idx = this.uiToServerIndex(r, c);

    // Se estás a escolher destino/captura, só aceita origem ou destinos válidos
    if (isChoosingDestination) {
      let origin = null;
      if (typeof this.lastCell === "number") origin = this.lastCell;
      else if (this.lastCell && typeof this.lastCell === "object" && typeof this.lastCell.square === "number") origin = this.lastCell.square;

      const targets = Array.isArray(this.selected) ? this.selected : [];
      const isOrigin = (origin !== null && idx === origin);
      const isTarget = targets.includes(idx);

      if (!isOrigin && !isTarget) {
        this.ui.addMessage("System", "Choose one of the valid squares.");
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

    // Segurança extra: se o servidor incluir game e não for o atual, ignora
    if (typeof data.game === "string" && this.gameId && data.game !== this.gameId) return;

    const prevTurn = this.turn;
    const nextTurn = (typeof data.turn === "string") ? data.turn : this.turn;
    const turnChanged = (prevTurn && nextTurn && prevTurn !== nextTurn);

    // aplica updates base
    if (typeof data.game === "string") this.gameId = data.game;
    if (typeof data.initial === "string") this.initial = data.initial;
    if (typeof data.turn === "string") this.turn = data.turn;
    if (typeof data.step === "string") this.step = data.step;

    // se mudou o turno, limpa estado "stale"
    if (turnChanged) {
      this.mustPass = null;
      this.selected = null;
      this.lastCell = null;

      if (!("step" in data)) this.step = "from";
      if (!("dice" in data)) this.dice = null;

      this._awaitingMove = false;
      this._lastRollKeepPlaying = false;
      this._extraRollReady = false;
    }

    // dice updates
    if ("dice" in data) {
      this.dice = data.dice;
      if (this.dice && typeof this.dice.value === "number") {
        this._awaitingMove = true;
        this._lastRollKeepPlaying = !!this.dice.keepPlaying;
        this._extraRollReady = false;
      }
    }

    if ("mustPass" in data) this.mustPass = data.mustPass;
    if (Array.isArray(data.pieces)) this.pieces = data.pieces;
    if (Array.isArray(data.selected)) this.selected = data.selected;
    if ("cell" in data) this.lastCell = data.cell;
    if ("players" in data && data.players) this.players = data.players;
    if (typeof data.winner === "string" || data.winner === null) this.winner = data.winner;

    if (this.initial) {
      this.viewRotated = (this.nick !== this.initial);
    }

    const isChoosingDestination = (this.step === "to" || this.step === "take");
    if (("dice" in data) && data.dice === null && !isChoosingDestination) {
      if (this._awaitingMove) {
        this._awaitingMove = false;
        this._extraRollReady = (this._lastRollKeepPlaying && this.turn === this.nick);
      }
    }

    this.render();

    // ✅ se o jogo acabou, trava tudo e fecha stream
    if ("winner" in data) {
      if (typeof data.winner === "string" || data.winner === null) {

        if (typeof data.winner === "string") {
          const stillHasPieces = Array.isArray(this.pieces) && this.pieces.some(p => p !== null);
          this.statusOnce(`Game ended. Winner: ${data.winner}`);
        } else {
          this.statusOnce("Game ended.");
        }

        // bloqueia UI/estado para evitar cliques mortos e erros
        this.ui.setRollEnabled(false);
        this.ui.setSkipEnabled(false);
        this.step = "from";
        this.dice = null;
        this.mustPass = null;
        this.selected = null;
        this.lastCell = null;

        this.closeStream();
      }
    }
  }

  // --------- RENDER ---------

  render() {
    const cols = this.size;
    const matrix = Array.from({ length: this.rows }, () => Array(cols).fill(null));

    // --- build matrix from server pieces ---
    if (Array.isArray(this.pieces)) {
      for (let i = 0; i < this.pieces.length; i++) {
        const p = this.pieces[i];
        if (!p) continue;

        const { r, c } = this.serverIndexToUI(i);
        const owner = this.isInitialColor(p) ? "B" : "G";

        const piece = new Piece(owner);

        // ✅ reachedLastRow do servidor (às vezes falha em casos raros)
        const reachedFromServer = (p.reachedLastRow === true);

        // ✅ fallback robusto: inferir "final" pela posição no array do servidor
        // rB = linha no referencial do servidor, a partir de baixo: 0..3
        const rB = Math.floor(i / cols);

        // peça pertence ao jogador initial?
        const belongsToInitial = this.isInitialColor(p);

        // se já se moveu e está na "linha do adversário", então é final
        // - initial chega à linha 3
        // - não-initial chega à linha 0
        const inferredReached =
          !!p.inMotion && (
            (belongsToInitial && rB === 3) ||
            (!belongsToInitial && rB === 0)
          );

        const reached = reachedFromServer || inferredReached;

        if (reached) piece.type = "final";
        else if (p.inMotion) piece.type = "moved";
        else piece.type = "initial";

        matrix[r][c] = piece;

        // (opcional) debug do caso raro:
        // if (inferredReached && !reachedFromServer) {
        //   console.log("[inferred final]", { i, rB, belongsToInitial, p });
        // }
      }
    }

    const currentPlayer = (this.turn && this.initial)
      ? (this.turn === this.initial ? "B" : "G")
      : "G";

    // --- draw board ---
    this.ui.clearHighlights(true);
    this.ui.renderBoard(matrix, currentPlayer, (r, c) => this.notifyByCoords(r, c));

    // --- counts ---
    const counts = this.countPiecesFromMatrix(matrix);
    this.ui.updateCounts(counts.g, counts.b);

    // --- dice UI ---
    if (this.dice && typeof this.dice.value === "number") {
      const val = this.dice.value;
      const symbol = this.symbolForDice(val);
      this.ui.animateSticks(symbol, val, false);
    } else {
      this.ui.resultEl?.classList.remove("show");
    }

    // -------- Buttons logic --------
    const myTurn = (this.turn === this.nick);
    const isChoosingDestination = (this.step === "to" || this.step === "take");
    const mustSkip = (this.mustPass === this.nick || this.mustPass === true);

    // se o jogo acabou -> botões desligados (mas o tabuleiro continua visível)
    if (this.winner !== null && this.winner !== undefined) {
      this.ui.setRollEnabled(false);
      this.ui.setSkipEnabled(false);
      return;
    }

    const myServerColor = (this.players && this.nick) ? this.players[this.nick] : null;
    const noPieceMovedYet = !!(
      Array.isArray(this.pieces) &&
      myServerColor &&
      !this.pieces.some(pp => pp && pp.color === myServerColor && pp.inMotion)
    );

    const canImmediateRerollStart =
      !!(this.dice &&
        this.dice.keepPlaying &&
        noPieceMovedYet &&
        (this.dice.value === 4 || this.dice.value === 6));

    const canRerollNow =
      !!(this.dice && this.dice.keepPlaying && (
        canImmediateRerollStart ||
        mustSkip ||
        this.dice.value === 6
      ));

    const canRoll =
      myTurn &&
      !isChoosingDestination &&
      (this.dice === null || canRerollNow) &&
      (
        !mustSkip || canRerollNow   // ✅ se mustSkip mas posso reroll, deixa lançar
      );

    this.ui.setRollEnabled(!!canRoll);

    // Skip só quando o servidor obriga E não podes relançar
    const canPass = myTurn && mustSkip && !isChoosingDestination && !canRerollNow;
    this.ui.setSkipEnabled(!!canPass, () => this.pass());


    // Highlights
    if ((this.step === "to" || this.step === "take") && Array.isArray(this.selected) && this.selected.length > 0) {
      const targets = this.selected
        .map((idx) => this.serverIndexToUI(idx))
        .map(({ r, c }) => ({ r, c }));
      this.ui.highlightTargets(targets);
    }

    let originIdx = null;
    if (typeof this.lastCell === "number") originIdx = this.lastCell;
    else if (this.lastCell && typeof this.lastCell === "object" && typeof this.lastCell.square === "number") originIdx = this.lastCell.square;

    if ((this.step === "to" || this.step === "take") && originIdx !== null) {
      const { r, c } = this.serverIndexToUI(originIdx);
      this.ui.markSelected(r, c);
    }

    // Status (as 4 mensagens simples)
    if (!this.gameId) return;

    if (!myTurn) {
      this.statusOnce("Wait for opponents play");
      return;
    }
    // ✅ se podes relançar, a mensagem correta é lançar novamente (não skip)
    if (this.dice === null || canRerollNow) {
      this.statusOnce("Your turn. Throw the sticks");
      return;
    }

    if (mustSkip) {
      this.statusOnce("No available moves. You must skip turn.");
      return;
    }

    this.statusOnce(`Move a piece ${this.dice.value} spaces`);
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
    if (value === 6) return "••••";
    if (value === 1) return "⎮•••";
    if (value === 2) return "⎮⎮••";
    if (value === 3) return "⎮⎮⎮•";
    if (value === 4) return "⎮⎮⎮⎮";
    return "—";
  }

  // --------- COLOR / ROLE MAPPING ---------

  isInitialColor(serverPieceObj) {
    if (!this.players || !this.initial) {
      return String(serverPieceObj?.color) === "Blue";
    }
    const initialColor = this.players[this.initial];
    return String(serverPieceObj?.color) === String(initialColor);
  }

  // --------- INDEX MAPPING ---------

  serverIndexToUI(idx) {
    const size = this.size;
    const rB = Math.floor(idx / size);
    const off = idx % size;

    let r = 3 - rB;
    let c = (rB % 2 === 0) ? off : (size - 1 - off);

    if (this.viewRotated) {
      r = 3 - r;
      c = (size - 1) - c;
    }
    return { r, c };
  }

  uiToServerIndex(r, c) {
    const size = this.size;

    if (this.viewRotated) {
      r = 3 - r;
      c = (size - 1) - c;
    }

    const rB = 3 - r;
    const off = (rB % 2 === 0) ? c : (size - 1 - c);
    return rB * size + off;
  }
}
