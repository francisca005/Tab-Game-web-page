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
    
    // Estado do jogo
    this.currentTurn = null;
    this.pieces = [];
    this.step = null;
    this.mustPass = false;
    this.dice = null;
    this.players = null;
    this.initialPlayer = null;
    
    this.myNick = null;
    this.winner = null;
    this.gameStarted = false;
  }

  cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.gameId = null;
    this.currentTurn = null;
    this.pieces = [];
    this.step = null;
    this.mustPass = false;
    this.dice = null;
    this.players = null;
    this.initialPlayer = null;
    this.winner = null;
    this.gameStarted = false;
    this.ui.clearHighlights(true);
  }

  async start(cols) {
    this.size = cols;
    const creds = this.ui.getCredentials();
    
    if (!creds) {
      this.ui.addMessage("System", "⚠️ You must log in first.");
      return;
    }

    this.myNick = creds.nick;
    this.cleanup();

    this.ui.addMessage("System", "🌐 Connecting to server...");

    try {
      const res = await join(GROUP_ID, creds.nick, creds.password, cols);

      if (res.error) {
        this.ui.addMessage("System", "❌ Join error: " + res.error);
        return;
      }

      this.gameId = res.game;
      this.ui.addMessage("System", `⏳ Waiting for opponent (Game ID: ${this.gameId.substring(0, 8)}...)`);
      this.ui.quitBtn.disabled = false;

      this.eventSource = openUpdateStream(
        creds.nick,
        this.gameId,
        (data) => this.handleUpdate(data),
        (err) => {
           console.error("SSE Error:", err);
        }
      );

    } catch (e) {
      this.ui.addMessage("System", "❌ Network error: " + e.message);
    }
  }

  async quitGame() {
    if (!this.gameId) return;

    const creds = this.ui.getCredentials();
    if (creds) {
      try {
        await leave(creds.nick, creds.password, this.gameId);
        this.ui.addMessage("System", "🏳️ You left the game.");
      } catch (e) {
        console.error(e);
      }
    }
    this.cleanup();
    this.ui.quitBtn.disabled = true;
    this.ui.setRollEnabled(false);
    this.ui.setSkipEnabled(false);
  }

  // --- AÇÕES ---

  async handleRoll() {
    if (!this.gameId) return;
    const creds = this.ui.getCredentials();
    
    this.ui.addMessage("System", "🎲 Rolling...");
    
    try {
      const res = await roll(creds.nick, creds.password, this.gameId);
      if (res.error) this.ui.addMessage("System", "❌ " + res.error);
    } catch (e) {
      this.ui.addMessage("System", "❌ Roll error: " + e.message);
    }
  }

  async handlePass() {
    if (!this.gameId) return;
    const creds = this.ui.getCredentials();
    
    this.ui.addMessage("System", "⏭️ Passing turn...");

    try {
      const res = await passTurn(creds.nick, creds.password, this.gameId);
      if (res.error) this.ui.addMessage("System", "❌ " + res.error);
    } catch (e) {
      this.ui.addMessage("System", "❌ Pass error: " + e.message);
    }
  }

  async handleCellClick(row, col) {
    if (this.currentTurn !== this.myNick) {
      this.ui.addMessage("System", "⚠️ Not your turn.");
      return;
    }

    const creds = this.ui.getCredentials();
    const serverIndex = this.uiCoordToServerIndex(row, col);

    // Debug para verificar se o clique corresponde ao índice esperado
    // console.log(`[Click] UI(${row},${col}) -> Server(${serverIndex})`);

    try {
      const res = await notify(creds.nick, creds.password, this.gameId, serverIndex);
      if (res.error) {
        this.ui.addMessage("System", "❌ Move error: " + res.error);
      }
    } catch (e) {
      this.ui.addMessage("System", "❌ Network error: " + e.message);
    }
  }

  // --- UPDATE LOOP ---

  handleUpdate(data) {
    if (data.error) {
      if (this.gameId) console.warn("Server Error:", data.error);
      return;
    }

    // Vencedor
    if (data.winner) {
      this.winner = data.winner;
      this.ui.addMessage("System", `🏆 GAME OVER! Winner: ${data.winner}`);
      
      if (window.recordGameResult) {
        const myColor = this.players ? this.players[this.winner] : null;
        const piecesLeft = myColor ? (data.pieces || []).filter(p => p && p.color === myColor).length : 0;
        window.recordGameResult(data.winner, piecesLeft);
      }
      
      this.cleanup();
      this.ui.quitBtn.disabled = true;
      return;
    }

    // Estado Básico
    if (data.initial) this.initialPlayer = data.initial;
    if (data.players) this.players = data.players;
    if (data.turn) this.currentTurn = data.turn;
    if (data.pieces) this.pieces = data.pieces;
    if (data.step) this.step = data.step;
    if (data.mustPass !== undefined) this.mustPass = !!data.mustPass;

    // Mensagem de Início
    if (this.players && Object.keys(this.players).length === 2 && !this.gameStarted) {
        this.gameStarted = true;
        const opponent = Object.keys(this.players).find(p => p !== this.myNick);
        this.ui.addMessage("System", `⚔️ Game ON! Opponent: ${opponent}`);
        
        const myColor = this.players[this.myNick];
        const colorName = myColor === "Blue" ? "GOLD (Starts First)" : "BLACK";
        this.ui.addMessage("System", `🎨 You are: ${colorName}`);
    }

    // Processamento
    this.processDice(data.dice);
    this.renderBoard();
    this.processHighlights(data.selected);
    this.updateControls();
    this.updateStatusMessage();
  }

  processDice(diceData) {
    this.dice = diceData; 
    
    if (diceData) {
      const val = diceData.value;
      const extra = diceData.keepPlaying;
      
      let symbol = "⎮⎮⎮⎮";
      if (diceData.stickValues) {
        const upCount = diceData.stickValues.filter(b => b === true).length;
        const symbols = ["••••", "⎮•••", "⎮⎮••", "⎮⎮⎮•", "⎮⎮⎮⎮"];
        symbol = symbols[upCount] || symbol;
      }
      this.ui.animateSticks(symbol, val, extra);
    }
  }

  processHighlights(selectedIndices) {
    this.ui.clearHighlights(true);
    
    if (!selectedIndices || !Array.isArray(selectedIndices) || selectedIndices.length === 0) return;

    const uiCoords = selectedIndices.map(idx => this.serverIndexToUICoord(idx));

    if (this.step === "to") {
      if (uiCoords.length > 0) {
        const origin = uiCoords[0];
        const originIdx = origin.r * this.size + origin.c;
        if (this.ui.boardEl.children[originIdx]) {
          this.ui.boardEl.children[originIdx].classList.add("selected");
        }
      }
      if (uiCoords.length > 1) {
        const targets = uiCoords.slice(1);
        this.ui.highlightTargets(targets);
      }
    } else {
       uiCoords.forEach(({r, c}) => {
         const idx = r * this.size + c;
         if (this.ui.boardEl.children[idx]) {
           this.ui.boardEl.children[idx].classList.add("selected");
         }
       });
    }
  }

  updateControls() {
    const isMyTurn = (this.currentTurn === this.myNick);
    
    let canRoll = false;
    if (isMyTurn) {
        if (!this.dice || this.dice.keepPlaying) {
             if (this.step !== "to" && this.step !== "take") {
                 canRoll = true;
             }
        }
    }
    
    this.ui.setRollEnabled(canRoll);
    this.ui.setSkipEnabled(isMyTurn && this.mustPass);
  }

  updateStatusMessage() {
    // Pode adicionar lógica aqui para mensagens de status persistentes
  }

  renderBoard() {
    if (!this.pieces) return;

    const matrix = [];
    for(let r=0; r<4; r++) matrix.push(new Array(this.size).fill(null));

    let goldCount = 0;
    let blackCount = 0;

    this.pieces.forEach((p, serverIdx) => {
      if (!p) return;

      const playerCode = (p.color === "Blue") ? "G" : "B";
      
      let type = "initial";
      if (p.reachedLastRow) type = "final";
      else if (p.inMotion) type = "moved";
      
      if (playerCode === "G") goldCount++; else blackCount++;

      const { r, c } = this.serverIndexToUICoord(serverIdx);
      
      if (matrix[r] && matrix[r][c] !== undefined) {
          matrix[r][c] = { player: playerCode, type: type };
      }
    });

    const currentPlayerSymbol = (this.players && this.players[this.currentTurn] === "Blue") ? "G" : "B";
    this.ui.renderBoard(matrix, currentPlayerSymbol, (r, c) => this.handleCellClick(r, c));
    this.ui.updateCounts(goldCount, blackCount);
  }

  // === CORREÇÃO DO MAPEAMENTO (Ziguezague) ===
  
  // A lógica de "serpente" implica que linhas pares e ímpares fluem em direções opostas.
  // Servidor Row 0 (Bottom/Fundo) -> UI Row 3
  // Servidor Row 3 (Top/Topo) -> UI Row 0

  serverIndexToUICoord(idx) {
    const serverRow = Math.floor(idx / this.size);
    const serverCol = idx % this.size;
    
    // Inverte a linha: Servidor 0 é Fundo, UI 0 é Topo
    const uiRow = 3 - serverRow; 
    
    let uiCol;
    
    // Aplica o Ziguezague:
    // Se a linha do servidor for PAR (0 ou 2), inverte a coluna (Direita -> Esquerda visualmente)
    // Se for ÍMPAR (1 ou 3), mantém a coluna (Esquerda -> Direita visualmente)
    if (serverRow % 2 === 0) {
      uiCol = (this.size - 1) - serverCol;
    } else {
      uiCol = serverCol;
    }

    return { r: uiRow, c: uiCol };
  }

  uiCoordToServerIndex(uiRow, uiCol) {
    // Inverso da linha
    const serverRow = 3 - uiRow;
    
    let serverCol;
    
    // Inverso do Ziguezague
    if (serverRow % 2 === 0) {
      serverCol = (this.size - 1) - uiCol;
    } else {
      serverCol = uiCol;
    }
    
    return (serverRow * this.size) + serverCol;
  }
}