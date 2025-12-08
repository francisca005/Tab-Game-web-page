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
    
    // Estado do jogo (sincronizado com o servidor)
    this.currentTurn = null;
    this.pieces = [];
    this.step = null;      // "from", "to", "take"
    this.mustPass = false;
    this.dice = null;
    this.players = null;   // { nick1: "Blue", nick2: "Red" }
    this.initialPlayer = null; // Nick do jogador inicial (Blue)
    
    this.myNick = null;
    this.winner = null;
  }

  // Limpeza ao sair ou terminar
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
    this.cleanup(); // Garante estado limpo

    this.ui.addMessage("System", "🌐 Connecting to server...");

    try {
      // 1. Join Request
      const res = await join(GROUP_ID, creds.nick, creds.password, cols);

      if (res.error) {
        this.ui.addMessage("System", "❌ Join error: " + res.error);
        return;
      }

      this.gameId = res.game;
      this.ui.addMessage("System", `⏳ Waiting for opponent (Game ID: ${this.gameId.substring(0, 8)}...)`);
      this.ui.quitBtn.disabled = false;

      // 2. Open SSE Stream (Update loop)
      this.eventSource = openUpdateStream(
        creds.nick,
        this.gameId,
        (data) => this.handleUpdate(data),
        (err) => {
           console.error(err);
           // Não mostrar erro na UI a cada reconexão do browser, apenas se crítico
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

  // --- AÇÕES DO JOGADOR ---

  async handleRoll() {
    if (!this.gameId) return;
    const creds = this.ui.getCredentials();
    
    // Feedback imediato na UI
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
    // Só processa cliques se for o turno do jogador
    if (this.currentTurn !== this.myNick) {
      this.ui.addMessage("System", "⚠️ Not your turn.");
      return;
    }

    const creds = this.ui.getCredentials();
    
    // Converte coordenada UI (row, col) para índice do servidor (0..N)
    const serverIndex = this.uiCoordToServerIndex(row, col);

    console.log(`[Click] UI(${row},${col}) -> Server(${serverIndex}) | Step: ${this.step}`);

    try {
      const res = await notify(creds.nick, creds.password, this.gameId, serverIndex);
      if (res.error) {
        this.ui.addMessage("System", "❌ Move error: " + res.error);
      }
    } catch (e) {
      this.ui.addMessage("System", "❌ Network error: " + e.message);
    }
  }

  // --- TRATAMENTO DE ATUALIZAÇÕES (SSE) ---

  handleUpdate(data) {
    console.log("[Update]", data); // Debug útil

    if (data.error) {
      // Ignorar erro de "Invalid game reference" se já tivermos saído
      if (this.gameId) console.warn("Server Error:", data.error);
      return;
    }

    // 1. Atualizar Vencedor (Fim de Jogo)
    if (data.winner) {
      this.winner = data.winner;
      this.ui.addMessage("System", `🏆 GAME OVER! Winner: ${data.winner}`);
      
      if (window.recordGameResult) {
        // Contagem aproximada baseada nas peças recebidas
        const piecesLeft = (data.pieces || []).filter(p => p && p.color === this.players[data.winner]).length;
        window.recordGameResult(data.winner, piecesLeft);
      }
      
      this.cleanup();
      this.ui.quitBtn.disabled = true;
      return;
    }

    // 2. Atualizar Estado Básico
    if (data.initial) this.initialPlayer = data.initial;
    if (data.players) this.players = data.players;
    if (data.turn) this.currentTurn = data.turn;
    if (data.pieces) this.pieces = data.pieces;
    if (data.step) this.step = data.step;
    if (data.mustPass !== undefined) this.mustPass = data.mustPass;

    // 3. Jogadores Prontos?
    if (this.players && Object.keys(this.players).length === 2 && !this.gameStarted) {
        this.gameStarted = true;
        const opponent = Object.keys(this.players).find(p => p !== this.myNick);
        this.ui.addMessage("System", `⚔️ Game ON! Opponent: ${opponent}`);
        this.ui.addMessage("System", `🎨 You are: ${this.players[this.myNick] === "Blue" ? "GOLD (First)" : "BLACK"}`);
    }

    // 4. Processar Dado
    this.processDice(data.dice);

    // 5. Renderizar Tabuleiro
    this.renderBoard();

    // 6. Destaques (Selected) e Fase do Turno
    this.processHighlights(data.selected);

    // 7. Atualizar Botões (Roll/Skip)
    this.updateControls();

    // 8. Mensagem de estado
    this.updateStatusMessage();
  }

  processDice(diceData) {
    // O servidor manda null se o dado não tiver sido jogado ou já consumido
    this.dice = diceData; 
    
    if (diceData) {
      const val = diceData.value;
      const extra = diceData.keepPlaying;
      
      // Converte array de booleanos em string visual
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
    
    if (!selectedIndices || selectedIndices.length === 0) return;

    // Mapeia índices do servidor para coordenadas UI
    const uiCoords = selectedIndices.map(idx => this.serverIndexToUICoord(idx));

    if (this.step === "to") {
      // Se estamos na fase "to", o servidor manda [origem, destino1, destino2...]
      // O primeiro é a peça selecionada, os outros são alvos válidos.
      // Ou, se a especificação diz "selected positions are valid options", 
      // iluminamos todas como targets potenciais.
      
      // Vamos destacar a primeira como "selecionada" (origem)
      const origin = uiCoords[0];
      const originIdx = origin.r * this.size + origin.c;
      if (this.ui.boardEl.children[originIdx]) {
        this.ui.boardEl.children[originIdx].classList.add("selected");
      }

      // As restantes são targets
      const targets = uiCoords.slice(1);
      this.ui.highlightTargets(targets);

    } else if (this.step === "from") {
       // Apenas a última peça movida ou selecionada para feedback
       const last = uiCoords[uiCoords.length - 1];
       const idx = last.r * this.size + last.c;
       if (this.ui.boardEl.children[idx]) {
         this.ui.boardEl.children[idx].classList.add("selected");
       }
    }
  }

  updateControls() {
    const isMyTurn = (this.currentTurn === this.myNick);

    // Roll: Só pode jogar se for sua vez, dado for null (ou keepPlaying for true na lógica interna, 
    // mas o servidor envia dice=null quando espera novo roll?)
    // A especificação diz: "Dice: null - se o último dado já tiver sido usado (tem de ser lançado)"
    
    let canRoll = false;
    if (isMyTurn) {
        if (!this.dice) {
            // Se não há dado, pode lançar
            canRoll = true;
        } else if (this.dice.keepPlaying) {
             // Se keepPlaying é true, mas geralmente o servidor limpa o 'dice' se puder jogar de novo?
             // Depende da implementação exata, mas pelo spec:
             // "keepPlaying - true se puder voltar a lançar o dado"
             // O servidor deve aceitar roll.
             canRoll = true;
        }
        // Se step for "to", o jogador tem de mover, não pode rolar (a menos que keepPlaying do anterior?)
        // Mas a lógica do servidor rejeita ROLL se houver jogada válida.
        // Vamos confiar no 'mustPass' e no estado do dado.
        if (this.step === "to" || this.step === "take") canRoll = false; 
    }
    
    this.ui.setRollEnabled(canRoll);

    // Skip: Habilitado se 'mustPass' for true e for meu turno
    this.ui.setSkipEnabled(isMyTurn && this.mustPass);
  }

  updateStatusMessage() {
    if (this.currentTurn === this.myNick) {
       let msg = "🟢 Your Turn! ";
       if (!this.dice && this.step === "from") msg += "(Roll the sticks)";
       else if (this.step === "from") msg += "(Select a piece)";
       else if (this.step === "to") msg += "(Select destination)";
       else if (this.mustPass) msg += "(No moves - Please Skip)";
       this.ui.addMessage("System", msg);
    } else {
       this.ui.addMessage("System", `🔴 ${this.currentTurn}'s turn...`);
    }
  }

  // --- RENDERIZAÇÃO E COORDENADAS ---

  renderBoard() {
    // Matriz 4 x Cols para o UIManager
    const matrix = [];
    for(let r=0; r<4; r++) matrix.push(new Array(this.size).fill(null));

    let goldCount = 0;
    let blackCount = 0;

    // O Array do servidor tem 4 * size posições.
    // Index 0 = Canto Inferior Direito do Jogador Inicial.
    
    this.pieces.forEach((p, serverIdx) => {
      if (!p) return;

      // Converter objeto do servidor para formato visual
      // Server colors: "Blue" (Initial/Gold), "Red" (Opponent/Black)
      const playerCode = (p.color === "Blue") ? "G" : "B";
      
      let type = "initial";
      if (p.reachedLastRow) type = "final";
      else if (p.inMotion) type = "moved";
      
      // Contagem
      if (playerCode === "G") goldCount++; else blackCount++;

      // Mapear posição
      const { r, c } = this.serverIndexToUICoord(serverIdx);
      
      matrix[r][c] = { player: playerCode, type: type };
    });

    // Determina quem destacar (borda dourada ou preta)
    const currentPlayerSymbol = (this.players && this.players[this.currentTurn] === "Blue") ? "G" : "B";

    this.ui.renderBoard(matrix, currentPlayerSymbol, (r, c) => this.handleCellClick(r, c));
    this.ui.updateCounts(goldCount, blackCount);
  }

  // Conversão CRÍTICA: Server Index (0..N) <-> UI Matrix (Row 0..3, Col 0..Size-1)
  // Spec: "Position 0 corresponds to the bottom right corner, as seen by the initial player."
  // UI: Row 0 é Topo, Row 3 é Fundo. Col 0 é Esquerda, Col Max é Direita.
  // Logo, Index 0 = UI Row 3, UI Col (Size-1).
  // O array preenche da direita para a esquerda, de baixo para cima?
  // Geralmente em Tâb: Linha 1 (fundo) dir->esq, Linha 2 esq->dir... (serpente).
  // MAS a API trata como array linear flat. Vamos assumir preenchimento linear simples de linhas para renderização,
  // já que a lógica de "serpente" é regra de movimento do servidor, não de armazenamento do array.
  
  // Vamos assumir:
  // Indices 0..(size-1) => Linha do Jogador Inicial (Fundo/Row 3)
  // Indices size..(2*size-1) => Linha 2 (Row 2)
  // ...
  // Indices 3*size..(4*size-1) => Linha do Adversário (Topo/Row 0)
  
  serverIndexToUICoord(idx) {
    const rowFromBottom = Math.floor(idx / this.size); // 0 a 3
    const colIndex = idx % this.size; // 0 a size-1
    
    // UI Row 0 é o topo. RowFromBottom 0 é o fundo (UI 3).
    const uiRow = 3 - rowFromBottom;
    
    // Spec: "Position 0 corresponds to the bottom right".
    // Se idx=0 -> rowFromBottom=0. Queremos que seja o canto direito.
    // Se a UI desenha col 0 na esquerda, col (size-1) na direita.
    // Então idx 0 deve mapear para col (size-1).
    // idx 1 deve mapear para col (size-2)...
    
    const uiCol = (this.size - 1) - colIndex;

    return { r: uiRow, c: uiCol };
  }

  uiCoordToServerIndex(uiRow, uiCol) {
    // Inverso da função acima
    const rowFromBottom = 3 - uiRow;
    
    // uiCol = (size - 1) - colIndex => colIndex = (size - 1) - uiCol
    const colIndex = (this.size - 1) - uiCol;
    
    return (rowFromBottom * this.size) + colIndex;
  }
  
  // Se o servidor suportar "canRoll" via API (não explícito, mas útil para UI)
  canRoll() {
    return !this.ui.throwBtn.disabled;
  }
}