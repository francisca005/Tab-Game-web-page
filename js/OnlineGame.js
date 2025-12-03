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

    // FIX: Criar Logic Helper (TabGame) para validação de regras no cliente
    // Usamos um objeto UI dummy para que o helper não interaja com o DOM/Chat
    const dummyUi = {
        addMessage: () => {}, 
        updateCounts: () => {},
        refreshRollButton: () => {},
        setRollEnabled: () => {},
        modeSelect: { value: 'pvp_online' },
    };
    this.logicHelper = new TabGame(dummyUi); 

    // Estado interno para gerir a jogada em dois passos (seleção UI)
    this.selectedCell = null;      // índice do servidor da célula selecionada
    this.selectedUiCoord = null;   // {r, c} da célula selecionada
  }

  // FIX: Sincroniza o TabGame Helper com o estado do servidor
  syncLogicHelper() {
    if (!this.pieces || !this.currentTurn || !this.dice) return;

    // 1. Sincronizar Board (conversão de array de objetos simples para instâncias de Piece)
    this.logicHelper.board = this.pieces.map((p, idx) => {
        if (!p) return null;
        
        // Mapear de volta a estrutura de Piece para o TabGame.js
        const piece = new Piece(p.color === "Blue" ? "G" : "B");
        piece.moved = p.inMotion;
        piece.wasOnLastRow = p.reachedLastRow;
        
        // TabGame.js usa 'type' para CSS, mas os flags 'moved'/'wasOnLastRow' são essenciais para as regras
        if (p.reachedLastRow) piece.type = "final";
        else if (p.inMotion) piece.type = "moved";
        else piece.type = "initial";

        return piece;
    });

    // 2. Sincronizar Jogador Atual (precisa ser em G/B)
    const turnColor = this.players[this.currentTurn];
    this.logicHelper.currentPlayer = turnColor === "Blue" ? "G" : "B";
    
    // 3. Sincronizar o Roll
    this.logicHelper.currentRoll = this.dice.value;
    this.logicHelper.cols = this.size; 
  }

  async start(cols) {
    this.size = cols;
    this.logicHelper.cols = cols; 

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

  async handlePass() {
    // FIX: Sincronizar antes de validar a regra de Skip
    this.syncLogicHelper();
    
    // Verifica se existe algum movimento válido com o roll atual
    const hasValidMoves = this.logicHelper.validMovesExist();
    
    if (hasValidMoves) {
        this.ui.addMessage("System", "Error: You cannot skip your turn if you have valid moves available.");
        return;
    }
    
    if (!this.canPass()) {
      this.ui.addMessage("System", "Cannot skip turn right now.");
      return;
    }
    
    const { nick, password } = this.ui.getCredentials();
    this.ui.addMessage("System", `${nick} is skipping turn...`);
    const res = await passTurn(nick, password, this.gameId);
    if (res.error) {
      this.ui.addMessage("System", `Pass error: ${res.error}`);
    }
  }


  // FIX: Lógica de dois passos (origem -> destino)
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
    
    // Sincronizar o helper para usar as regras atuais antes de cada clique
    this.syncLogicHelper(); 

    const cellIndex = this.uiCoordToServerIndex(r, c);
    const { nick, password } = credentials;
    
    // --- STEP 'from' --- (Seleção da peça de origem)
    if (this.step === 'from') {
        const piece = this.logicHelper.board[cellIndex]; // Usar o helper para verificar a peça
        const playerColor = this.players[nick];
        
        // 1. Cliente-side validation (Tâb rule e Dono da Peça)
        const isPlayersPiece = piece && piece.player === (playerColor === "Blue" ? "G" : "B");
        if (!isPlayersPiece) {
            this.ui.addMessage("System", "Move error: Not your piece or cell is empty.");
            return;
        }
        
        // Utilizar a regra Tâb do TabGame.js
        if (!this.logicHelper.canMovePiece(piece)) {
             this.ui.addMessage("System", `Move error: Must be a Tâb (1) roll to move initial pieces.`);
             return;
        }
        
        // Calcular targets e só notificar se houver movimentos válidos
        const targets = this.logicHelper.validTargetsFrom(cellIndex);
        if (targets.length === 0) {
            this.ui.addMessage("System", `Move error: No valid moves with roll ${this.dice.value} from this piece.`);
            return;
        }

        // 2. Enviar a notificação para o servidor
        const res = await notify(nick, password, this.gameId, cellIndex);
        if (res.error) {
            this.ui.addMessage("System", `Server Move error: ${res.error}`);
            this.ui.clearHighlights(true);
            this.selectedCell = null;
            this.selectedUiCoord = null;
            return;
        }

        // 3. Se o servidor aceitou, atualizamos o estado UI e destacamos
        this.selectedCell = cellIndex;
        this.selectedUiCoord = {r, c};
        this.highlightSelection(r, c, true); 
        this.highlightTargets(targets); // Destacar os alvos
        this.ui.addMessage("System", "Piece selected. Choose destination.");
    } 
    // --- STEP 'to' --- (Seleção da peça de destino)
    else if (this.step === 'to') {
        // Validação rápida do cliente antes de enviar
        const validTargets = this.logicHelper.validTargetsFrom(this.selectedCell);
        const targetIsLocalValid = validTargets.some(idx => idx === cellIndex);

        if (!targetIsLocalValid) {
            this.ui.addMessage("System", "Move error: Invalid destination for selected piece.");
            return;
        }

        // 2. Enviar a notificação para o servidor
        const res = await notify(nick, password, this.gameId, cellIndex);
        if (res.error) {
            this.ui.addMessage("System", `Server Move error: ${res.error}`);
            return;
        }
        
        // 3. Se o servidor aceitou, limpamos a seleção (o servidor enviará a nova board no update)
        this.selectedCell = null;
        this.selectedUiCoord = null;
        this.ui.clearHighlights(true);
    }
  }
  
  // Função auxiliar para gerir o highlight da peça selecionada
  highlightSelection(r, c, isSelected) {
    const boardEl = this.ui.boardEl;
    if (!boardEl) return;
    const index = r * this.size + c;
    const el = boardEl.children[index];
    
    boardEl.querySelectorAll(".cell.selected").forEach(e => e.classList.remove("selected"));
    
    if (isSelected && el) {
        el.classList.add("selected");
    }
  }

  // Nova função para destacar alvos, usando a função adaptada do UIManager
  highlightTargets(targets) {
    // Converte os índices do servidor/helper para coordenadas {r, c} da UI
    const uiTargets = targets.map(idx => this.serverIndexToUICoord(idx));
    
    // O UIManager.js foi ajustado para receber targets como {r, c}
    this.ui.highlightTargets(uiTargets);
  }


  refreshSkipButton() {
    const skipBtn = this.ui.skipBtn;
    if (!skipBtn) return;
    
    const canSkip = this.canPass();

    skipBtn.disabled = !canSkip;
    skipBtn.classList.toggle("enabled", canSkip);
  }



  handleUpdate(data) {
        console.log("[UPDATE from server]", data);

        if (data.error) {
            this.ui.addMessage("System", `Server error: ${data.error}`);
            // Se houver um erro, é seguro fechar o canal SSE
            this.cleanup();
            return;
        }

        const previousTurn = this.currentTurn;

        // 1) Atualizar estado do jogo (pieces, initial, players)
        if (data.pieces) {
            this.pieces = data.pieces;
            this.initialNick = data.initial ?? this.initialNick;
            this.players = data.players ?? this.players;
            this.renderBoardFromPieces();
        }

        // 2) Atualizar o passo de movimento (step) e o estado do turno (turn/mustPass)
        if (data.step !== undefined) {
            this.step = data.step;
        }
        if (data.turn !== undefined) {
            this.currentTurn = data.turn;
        }
        if (data.mustPass !== undefined) {
            this.mustPass = data.mustPass;
        }

        // 3) Lógica de Destaques Visuais (Seleção/Alvos)
        // Limpamos sempre tudo antes de aplicar novos destaques
        this.ui.clearHighlights(true); 

        if (data.selected) {
            // Converte os índices 1D do servidor para coordenadas de UI {r, c}
            const uiCoords = data.selected.map(idx => this.serverIndexToUICoord(idx));

            // Aplica o destaque de seleção (A peça selecionada é geralmente o primeiro índice)
            if (uiCoords.length > 0) {
                const selectedCoord = uiCoords[0];
                const selectedIndex = selectedCoord.r * this.size + selectedCoord.c; // Índice 1D da UI
                
                const selectedEl = this.ui.boardEl.children[selectedIndex];
                if (selectedEl) {
                    selectedEl.classList.add("selected");
                }
            }
            
            // Aplica o destaque de alvos. Se o passo é 'to' ou 'take', os restantes elementos são alvos.
            if (this.step === 'to' || this.step === 'take') {
                const targets = uiCoords.slice(1);
                this.ui.highlightTargets(targets); // Assume que highlightTargets recebe [{r, c}, ...]
            }
        }

        // 4) Notificações de Jogada e Dado
        if (data.cell !== undefined) {
            this.ui.addMessage("System", `Move notified on cell ${data.cell}. Next step: ${this.step}.`);
        }

        if (data.dice !== undefined) {
            this.dice = data.dice;
            // Animação dos paus (seu código original, ligeiramente simplificado)
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
            this.cleanup(); // Fecha o EventSource
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
    
    // Garantir que a peça selecionada é re-destacada após o render
    if (this.selectedUiCoord) {
        this.highlightSelection(this.selectedUiCoord.r, this.selectedUiCoord.c, true);
    }
  }
}