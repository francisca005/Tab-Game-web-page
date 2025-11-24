// js/OnlineGame.js
import { GROUP_ID, join, leave, roll, notify, passTurn, openUpdateStream } from "./ServerAPI.js";


export class OnlineGame {
  constructor(ui) {
    this.ui = ui;
    this.size = 9;
    this.gameId = null;
    this.eventSource = null;
    this.currentTurn = null;  // nick com vez
    this.initialNick = null;  // quem começou
    this.pieces = null;
    this.step = null;
    this.mustPass = null;
    this.dice = null;
    this.winner = null;
  }

  async start(cols) {
    this.size = cols;

    const creds = this.ui.getCredentials();
    if (!creds) {
      this.ui.addMessage("System", "You must log in before starting an online game.");
      return;
    }

    const { nick, password } = creds;
    this.ui.addMessage("System", "Joining online game...");

    const res = await join(GROUP_ID, nick, password, cols);
    if (res.error) {
      this.ui.addMessage("System", `Join error: ${res.error}`);
      return;
    }

    this.gameId = res.game;
    this.ui.addMessage("System", `Joined game ${this.gameId}. Waiting for opponent...`);

    // Abre o canal update
    this.eventSource = openUpdateStream(
      nick,
      this.gameId,
      (data) => this.handleUpdate(data),
      () => this.ui.addMessage("System", "Connection lost to server (update).")
    );

    // Botões
    this.ui.onThrow = () => this.handleRoll();
    this.ui.onQuit = () => this.handleLeave();
    this.ui.onPass = () => this.handlePass();
  }

  async handleRoll() {
    if (!this.canRoll()) return;

    const { nick, password } = this.ui.getCredentials();
    const res = await roll(nick, password, this.gameId);
    if (res.error) {
      this.ui.addMessage("System", `Roll error: ${res.error}`);
    }
    // resultado vem no update
  }

  async handleLeave() {
    if (!this.gameId) return;
    const { nick, password } = this.ui.getCredentials();
    await leave(nick, password, this.gameId);
    this.cleanup();
    this.ui.addMessage("System", "Left online game.");
  }

  async handlePass() {
    if (!this.canPass()) return;
    const { nick, password } = this.ui.getCredentials();
    const res = await passTurn(nick, password, this.gameId);
    if (res.error) {
      this.ui.addMessage("System", `Pass error: ${res.error}`);
    }
  }

  async handleCellClick(r, c) {
    // converte (r, c) para índice no array pieces do servidor
    const cellIndex = this.uiCoordToServerIndex(r, c);
    const { nick, password } = this.ui.getCredentials();
    const res = await notify(nick, password, this.gameId, cellIndex);
    if (res.error) {
      this.ui.addMessage("System", `Move error: ${res.error}`);
    }
  }

  handleUpdate(data) {
    console.log("[UPDATE from server]", data);

    if (data.error) {
      this.ui.addMessage("System", `Server error: ${data.error}`);
      return;
    }

    const previousTurn = this.currentTurn;

    // 1) Atualizar peças / estado do tabuleiro, se vierem
    if (data.pieces) {
      this.pieces = data.pieces;
      this.initialNick = data.initial ?? this.initialNick;
      this.step = data.step ?? this.step;
      this.players = data.players ?? this.players;

      this.renderBoardFromPieces();
    }

    // 2) Atualizar infos de turno / dado / mustPass, mesmo que venha sem "pieces"
    if (data.turn !== undefined) {
      this.currentTurn = data.turn;
    }
    if (data.mustPass !== undefined) {
      this.mustPass = data.mustPass;
    }
    if (data.dice !== undefined) {
      this.dice = data.dice;
    }

    // 3) Mensagens de início de jogo / mudança de vez
    if (!previousTurn && this.currentTurn) {
      this.ui.addMessage("System", `Game started! First to play: ${this.currentTurn}.`);
    } else if (previousTurn && this.currentTurn && previousTurn !== this.currentTurn) {
      this.ui.addMessage("System", `It's now ${this.currentTurn}'s turn.`);
    }

    // 4) Fim de jogo
    if (data.winner !== undefined) {
      this.winner = data.winner;
      if (this.winner) {
        this.ui.addMessage("System", `Winner: ${this.winner}`);
      } else {
        this.ui.addMessage("System", "Game ended without a winner.");
      }
      this.cleanup(); // fecha o EventSource
    }
  }


  cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.gameId = null;
  }

  canRoll() {
    const creds = this.ui.getCredentials();
    if (!creds) {
      this.ui.addMessage("System", "You must log in before playing online.");
      return false;
    }

    if (!this.gameId) {
      this.ui.addMessage("System", "No active online game (gameId missing).");
      return false;
    }

    // Ainda não recebemos info do servidor sobre quem tem a vez
    if (!this.currentTurn) {
      this.ui.addMessage("System", "Waiting for opponent / game start (no turn yet).");
      return false;
    }

    if (this.currentTurn !== creds.nick) {
      this.ui.addMessage("System", `It's not your turn, it's ${this.currentTurn}'s turn.`);
      return false;
    }

    // Servidor só deixa rolar quando dice é null
    if (this.dice !== null && this.dice !== undefined) {
      this.ui.addMessage("System", "You already rolled the dice this turn.");
      return false;
    }

    return true;
  }


  canPass() {
    const creds = this.ui.getCredentials();
    if (!creds || !this.gameId) return false;
    return this.currentTurn === creds.nick && this.mustPass === creds.nick;
  }

  // === MAPEAMENTO PIECES[] -> MATRIZ PARA UI ===

  serverIndexToUICoord(idx) {
    // server: 0 = canto inferior direito, visto pelo inicial
    const size = this.size;
    const rowFromBottom = Math.floor(idx / size); // 0 = bottom row
    const colFromRight = idx % size;             // 0 = rightmost col

    const uiRow = 3 - rowFromBottom;             // 0 = top row
    const uiCol = size - 1 - colFromRight;       // 0 = leftmost

    return { r: uiRow, c: uiCol };
  }

  uiCoordToServerIndex(r, c) {
    const size = this.size;
    const rowFromBottom = 3 - r;
    const colFromRight = size - 1 - c;
    return rowFromBottom * size + colFromRight;
  }

  renderBoardFromPieces() {
    if (!this.pieces) return;

    // cria matriz 4 x size com as mesmas estruturas que TabGame usa
    const matrix = Array.from({ length: 4 }, () => Array(this.size).fill(null));

    this.pieces.forEach((p, idx) => {
      if (!p) return;
      const { r, c } = this.serverIndexToUICoord(idx);

      // adaptamos color "Blue"/"Red" para "G"/"B"
      const player = p.color === "Blue" ? "G" : "B";
      matrix[r][c] = { player, type: p.reachedLastRow ? "final" : (p.inMotion ? "moved" : "initial") };
    });

    // currentPlayer: quem tem a vez → color
    let currentPlayer = "G";
    if (this.currentTurn && this.pieces) {
      // ver cor pelo objeto players, se vier no update
      // fallback: usa initial como "G" e adversário como "B"
      // (podes melhorar isto mais tarde)
    }

    this.ui.renderBoard(matrix, currentPlayer, (r, c) => this.handleCellClick(r, c));
  }
}
