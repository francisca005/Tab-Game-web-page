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
    this.step = null;         // 'from', 'to', etc. (Vindo do servidor)
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
      (error) => this.ui.addMessage("System", "Connection lost to server (update). " + error)
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
    const creds = this.ui.getCredentials();
    
    // 1. VERIFICAÇÃO DE TURNO
    if (this.currentTurn !== creds?.nick) {
        this.ui.addMessage("System", "It's not your turn to move.");
        return;
    }

    // 2. VERIFICAÇÃO DE DADO ROLADO (CRÍTICO para evitar 400 antes do roll)
    if (this.dice === null || this.dice === undefined) {
        this.ui.addMessage("System", "You must roll the sticks first!");
        return;
    }
    
    // 3. ENVIAR NOTIFICAÇÃO (Seleção/Destino)
    const cellIndex = this.uiCoordToServerIndex(r, c);
    const { nick, password } = creds;
    
    console.log(`[DEBUG NOTIFY] Enviando cellIndex: ${cellIndex}. STEP: ${this.step}`);

    const res = await notify(nick, password, this.gameId, cellIndex);

    if (res.error) {
      this.ui.addMessage("System", `Move error: ${res.error}`);
      // Limpa os destaques para que o jogador tente outra seleção após o erro 400
      this.ui.clearHighlights(true);
    }
  }

  handleUpdate(data) {
    console.log("[UPDATE from server]", data);

    if (data.error) {
      this.ui.addMessage("System", `Server error: ${data.error}`);
      return;
    }

    const previousDice = this.dice;
    const previousTurn = this.currentTurn;

    // 1) Atualizar estado: peças, turno, step e dado
    if (data.pieces) {
      this.pieces = data.pieces;
      this.initialNick = data.initial ?? this.initialNick;
      this.players = data.players ?? this.players;

      this.renderBoardFromPieces();
    }
    
    if (data.turn !== undefined) {
      this.currentTurn = data.turn;
    }
    if (data.mustPass !== undefined) {
      this.mustPass = data.mustPass;
      // LIGAÇÃO CRÍTICA 1: Habilita/Desabilita o botão 'Passar'
      this.ui.setSkipEnabled(this.canPass()); 
    }
    if (data.dice !== undefined) {
      this.dice = data.dice;
    }
    if (data.step !== undefined) {
      this.step = data.step;
      this.ui.clearHighlights(false); 
    }
    
    // 2) Animação do Dado e Mensagem (CORREÇÃO [OBJECT OBJECT])
    if (this.dice !== previousDice && this.dice !== null && this.dice !== undefined) {
      
      const diceValue = Number(this.dice); 
      
      const symbols = ["••••", "⎮•••", "⎮⎮••", "⎮⎮⎮•", "⎮⎮⎮⎮"];
      const upCount = (diceValue === 6) ? 0 : diceValue; 
      const symbol = symbols[upCount]; 
      
      // O valor enviado para a UI é o número, resolvendo o erro visual
      this.ui.animateSticks(symbol, diceValue, false);
      this.ui.addMessage("System", `Sticks rolled: ${diceValue}`); 
    }

    // 3) Mensagens de início de jogo / mudança de vez
    if (!previousTurn && this.currentTurn) {
      this.ui.addMessage("System", `Game started! First to play: ${this.currentTurn}.`);
    } else if (previousTurn && this.currentTurn && previousTurn !== this.currentTurn) {
      this.ui.addMessage("System", `It's now ${this.currentTurn}'s turn.`);
    }

    // 4) LIGAÇÃO CRÍTICA 2: Atualização do botão Rolar
    this.ui.refreshRollButtonOnline(this.canRoll());


    // 5) Fim de jogo
    if (data.winner !== undefined) {
      this.winner = data.winner;
      if (this.winner) {
        this.ui.addMessage("System", `Winner: ${this.winner}`);
      } else {
        this.ui.addMessage("System", "Game ended without a winner.");
      }
      this.cleanup();
    }
  }


  cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.gameId = null;
    
    // Desativar botões da UI após cleanup
    this.ui.setRollEnabled(false);
    this.ui.setSkipEnabled(false);
  }

  canRoll() {
    const creds = this.ui.getCredentials();
    if (!creds || !this.gameId || !this.currentTurn) {
        return false;
    }

    const isMyTurn = this.currentTurn === creds.nick;
    const diceNotRolled = this.dice === null || this.dice === undefined;
    
    if (isMyTurn && !diceNotRolled) {
        this.ui.addMessage("System", "You already rolled the sticks this turn.");
    }

    return isMyTurn && diceNotRolled;
  }


  canPass() {
    const creds = this.ui.getCredentials();
    if (!creds || !this.gameId) return false;
    return this.currentTurn === creds.nick && this.mustPass === creds.nick;
  }

  // === MAPEAMENTO PIECES[] -> MATRIZ PARA UI ===

  serverIndexToUICoord(idx) {
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

    const matrix = Array.from({ length: 4 }, () => Array(this.size).fill(null));

    this.pieces.forEach((p, idx) => {
      if (!p) return;
      const { r, c } = this.serverIndexToUICoord(idx);

      const player = p.color === "Blue" ? "G" : "B"; 
      matrix[r][c] = { player, type: p.reachedLastRow ? "final" : (p.inMotion ? "moved" : "initial") };
    });

    this.ui.renderBoard(matrix, this.currentTurn, (r, c) => this.handleCellClick(r, c));
  }
}


