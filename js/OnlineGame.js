// js/OnlineGame.js
import { GROUP_ID, join, leave, roll, notify, passTurn, openUpdateStream } from "./ServerAPI.js";
import { TabGame } from "./TabGame.js"; 
import { Piece } from "./Piece.js"; 


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
    this.players = null; // Mapa Nick -> Color do Servidor

    // 1. Adição e Configuração do logicHelper (usa a classe TabGame para as regras)
    const dummyUi = {
        addMessage: () => {}, 
        updateCounts: () => {},
        refreshRollButton: () => {},
        setRollEnabled: () => {},
        modeSelect: { value: 'pvp_online' },
        aiLevelSelect: { value: 'easy' }, 
    };
    this.logicHelper = new TabGame(dummyUi); 
  }

  // 2. Criação de syncLogicHelper()
  syncLogicHelper() {
    if (!this.pieces || !this.currentTurn || !this.dice || !this.players) return;

    // Converte os dados simples do servidor para instâncias de Piece para que o TabGame
    // possa aplicar as regras de movimento (type/moved/wasOnLastRow).
    this.logicHelper.board = this.pieces.map((p, idx) => {
        if (!p) return null;
        
        const piece = new Piece(p.color === "Blue" ? "G" : "B"); 
        piece.moved = p.inMotion;
        piece.wasOnLastRow = p.reachedLastRow;
        
        if (p.reachedLastRow) piece.type = "final";
        else if (p.inMotion) piece.type = "moved";
        else piece.type = "initial";

        return piece;
    });

    const turnColor = this.players[this.currentTurn];
    this.logicHelper.currentPlayer = turnColor === "Blue" ? "G" : "B";
    this.logicHelper.currentRoll = this.dice.value;
    this.logicHelper.cols = this.size; 
  }
  
  // 3. Implementação de checkAnyValidMove()
  checkAnyValidMove() {
      const player = this.logicHelper.currentPlayer;
      const board = this.logicHelper.board;
      const roll = this.logicHelper.currentRoll;

      if (!roll) return false;

      for (let i = 0; i < board.length; i++) {
          const piece = board[i];
          if (!piece || piece.player !== player) continue;
          
          if (!this.logicHelper.canMovePiece(piece)) continue;

          const targets = this.logicHelper.validTargetsFrom(i);
          if (targets.length > 0) return true;
      }
      return false;
  }

  async start(cols) {
    this.size = cols;
    this.logicHelper.cols = cols; 
    this.logicHelper.init(cols, "Gold"); 

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

    this.eventSource = openUpdateStream(
      nick,
      this.gameId,
      (data) => this.handleUpdate(data),
      () => this.ui.addMessage("System", "Connection lost to server (update).")
    );

    this.ui.onThrow = () => this.handleRoll();
    this.ui.onQuit = () => this.handleLeave();
    this.ui.onPass = () => this.handlePass();
  }

  async handleRoll() {
    if (!this.canRoll()) return;

    const { nick, password } = this.ui.getCredentials();
    this.ui.addMessage("System", "Throwing sticks...");
    const res = await roll(nick, password, this.gameId);
    if (res.error) {
      this.ui.addMessage("System", `Roll error: ${res.error}`);
    }
  }

  quitGame() {
    this.handleLeave();
  }

  async handleLeave() {
    if (!this.gameId) return;
    const { nick, password } = this.ui.getCredentials();
    await leave(nick, password, this.gameId);
    this.cleanup();
    this.ui.addMessage("System", "Left online game.");
  }

  // 4. Lógica de handlePass() Corrigida
  async handlePass() {
    const credentials = this.ui.getCredentials();
    if (this.currentTurn !== credentials?.nick) {
        this.ui.addMessage("System", "Error: It's not your turn.");
        return;
    }

    this.syncLogicHelper();
    
    // Bloqueia se houver movimentos válidos (Regra do Tâb)
    if (this.logicHelper.currentRoll && this.checkAnyValidMove()) {
        this.ui.addMessage("System", "Error: You cannot skip your turn if you have valid moves available.");
        return;
    }
    
    // Validação se o servidor permite skip (mustPass)
    if (!this.canPass()) {
      this.ui.addMessage("System", "Cannot skip turn right now (server state does not require a skip).");
      return;
    }
    
    const { nick, password } = credentials;
    this.ui.addMessage("System", `${nick} is skipping turn...`);
    const res = await passTurn(nick, password, this.gameId);
    if (res.error) {
      this.ui.addMessage("System", `Pass error: ${res.error}`);
    }
  }


  // 5. Simplificação de handleCellClick()
  async handleCellClick(r, c) {
    const credentials = this.ui.getCredentials();
    if (this.currentTurn !== credentials?.nick) {
        this.ui.addMessage("System", "Move error: It's not your turn.");
        return;
    }
    if (!this.dice) {
        this.ui.addMessage("System", "Move error: Roll the sticks first!");
        return;
    }
    
    this.syncLogicHelper(); 

    const cellIndex = this.uiCoordToServerIndex(r, c);
    const { nick, password } = credentials;
    
    // --- STEP 'from' (Validação no Cliente) ---
    if (this.step === 'from') {
        const piece = this.logicHelper.board[cellIndex]; 
        const playerColor = this.players[nick];
        const isPlayerG = playerColor === "Blue"; 
        
        // Verifica se a peça pertence ao jogador e se a casa está ocupada
        const isPlayersPiece = piece && piece.player === (isPlayerG ? "G" : "B");
        if (!isPlayersPiece) {
            this.ui.clearHighlights(true);
            return;
        }
        
        // Validação da regra Tâb (só pode mover peças iniciais com roll=1)
        if (!this.logicHelper.canMovePiece(piece)) {
             this.ui.addMessage("System", `Move error: Must be a Tâb (1) roll to move initial pieces.`);
             return;
        }
        
        // Validação se existem alvos válidos para o roll atual
        const targets = this.logicHelper.validTargetsFrom(cellIndex);
        if (targets.length === 0) {
            this.ui.addMessage("System", `Move error: No valid moves with roll ${this.dice.value} from this piece.`);
            return;
        }

        // Se passar nas validações do cliente, notifica o servidor (para avançar para 'to')
        this.ui.addMessage("System", "Notifying server of piece selection...");
        const res = await notify(nick, password, this.gameId, cellIndex);
        if (res.error) {
            this.ui.addMessage("System", `Server Move error: ${res.error}`);
            this.ui.clearHighlights(true);
            return;
        }
    } 
    // --- STEP 'to' ---
    else if (this.step === 'to') {
        // Envia o destino. A validação completa do movimento é feita no servidor.
        this.ui.addMessage("System", "Notifying server of destination selection...");
        const res = await notify(nick, password, this.gameId, cellIndex);
        if (res.error) {
            this.ui.addMessage("System", `Server Move error: ${res.error}`);
            return;
        }
    }
  }
  
  refreshSkipButton() {
    const skipBtn = this.ui.skipBtn;
    if (!skipBtn) return;
    
    const canSkip = this.canPass();

    skipBtn.disabled = !canSkip;
    skipBtn.classList.toggle("enabled", canSkip);
  }


  // 6. Centralização do Highlight em handleUpdate()
  handleUpdate(data) {
        console.log("[UPDATE from server]", data);

        if (data.error) {
            this.ui.addMessage("System", `Server error: ${data.error}`);
            this.cleanup();
            return;
        }

        const previousTurn = this.currentTurn;

        // 1) Atualizar estado do jogo e renderizar
        if (data.pieces) {
            this.pieces = data.pieces;
            this.initialNick = data.initial ?? this.initialNick;
            this.players = data.players ?? this.players;
            this.renderBoardFromPieces();
        }

        // 2) Atualizar o estado do turno
        if (data.step !== undefined) {
            this.step = data.step;
        }
        if (data.turn !== undefined) {
            this.currentTurn = data.turn;
        }
        if (data.mustPass !== undefined) {
            this.mustPass = data.mustPass;
        }

        // 3) Lógica de Destaques Visuais (após o render)
        this.ui.clearHighlights(true); 

        if (data.selected && data.selected.length > 0) {
            
            this.syncLogicHelper();
            
            const selectedIndex = data.selected[0];
            const selectedCoord = this.serverIndexToUICoord(selectedIndex);
            
            const selectedUiIndex = selectedCoord.r * this.size + selectedCoord.c; 
            const selectedEl = this.ui.boardEl?.children[selectedUiIndex];
            
            // Destacar a peça selecionada
            if (selectedEl) {
                selectedEl.classList.add("selected");
            }

            // Destacar alvos
            if (this.step === 'to' || this.step === 'take') {
                // Usa as regras do TabGame para calcular os alvos, garantindo a precisão no cliente
                const targetsServerIndices = this.logicHelper.validTargetsFrom(selectedIndex);
                
                const uiTargets = targetsServerIndices.map(idx => this.serverIndexToUICoord(idx));
                
                this.ui.highlightTargets(uiTargets);
            }
        }


        // 4) Notificações de Jogada e Dado
        if (data.cell !== undefined) {
            this.ui.addMessage("System", `Move confirmed on server. Next action: ${this.step}.`);
        }

        if (data.dice !== undefined) {
            this.dice = data.dice;
            if (this.dice) {
                const rollValue = data.dice.value;
                const sticks = data.dice.stickValues;
                const upCount = sticks.filter(v => v).length;
                const symbols = ["••••", "⎮•••", "⎮⎮••", "⎮⎮⎮•", "⎮⎮⎮⎮"];
                const symbol = symbols[upCount];
                const repeat = data.dice.keepPlaying;

                this.ui.animateSticks(symbol, rollValue, repeat);
                this.ui.addMessage("System", `${this.currentTurn} rolled: ${rollValue}${repeat ? " (extra roll)" : ""}`);
            }
        }

        // 5) Mensagens de início de jogo / mudança de vez
        if (!previousTurn && this.currentTurn) {
            this.ui.addMessage("System", `Game started! First to play: ${this.currentTurn}.`);
        } else if (previousTurn && this.currentTurn && previousTurn !== this.currentTurn) {
            this.ui.addMessage("System", `It's now ${this.currentTurn}'s turn.`);
        }

        // 6) Fim de jogo
        if (data.winner !== undefined) {
            this.winner = data.winner;
            if (this.winner) {
                this.ui.addMessage("System", `Winner: ${this.winner} 🎉`);
            } else {
                this.ui.addMessage("System", "Game ended without a winner.");
            }
            this.cleanup();
        }

        // 7) Atualizar Botões (sempre no final)
        this.ui.refreshRollButton(this);
        this.refreshSkipButton();
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
      return false;
    }
    if (!this.gameId || !this.currentTurn || this.dice) {
      return false;
    }

    if (this.currentTurn !== creds.nick) {
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
    const size = this.size;
    const rowFromBottom = Math.floor(idx / size); 
    const colFromRight = idx % size;             

    const uiRow = 3 - rowFromBottom;             
    const uiCol = size - 1 - colFromRight;       

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

    let currentPlayer = "G"; 
    if (this.currentTurn && this.players) {
      const turnColor = this.players[this.currentTurn];
      if (turnColor === "Blue") {
        currentPlayer = "G";
      } else if (turnColor === "Red") {
        currentPlayer = "B";
      }
    }

    this.ui.renderBoard(matrix, currentPlayer, (r, c) => this.handleCellClick(r, c));
  }

}
