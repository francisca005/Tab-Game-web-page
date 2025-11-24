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
      (error) => this.ui.addMessage("System", "Connection lost to server (update). " + error) // Melhoria do log de erro
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
    // Adicionar verificação de turno antes de tentar notificar
    const creds = this.ui.getCredentials();
    if (this.currentTurn !== creds?.nick) {
        this.ui.addMessage("System", "It's not your turn to move.");
        return;
    }
    
    // converte (r, c) para índice no array pieces do servidor
    const cellIndex = this.uiCoordToServerIndex(r, c);
    const { nick, password } = creds;
    
    // Debug
    console.log(`[DEBUG NOTIFY] Enviando cellIndex: ${cellIndex}`);

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

    const previousDice = this.dice;
    const previousTurn = this.currentTurn;
    const creds = this.ui.getCredentials();

    // 1) Atualizar peças / estado do tabuleiro, se vierem
    if (data.pieces) {
      this.pieces = data.pieces;
      this.initialNick = data.initial ?? this.initialNick;
      this.step = data.step ?? this.step;
      this.players = data.players ?? this.players;

      this.renderBoardFromPieces();
    }

    // 2) Atualizar infos de turno / dado / mustPass
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
    
    // 3) Animação do Dado e Mensagem
    if (this.dice !== previousDice && this.dice !== null && this.dice !== undefined) {
      // Valor do dado (1 a 6)
      const symbols = ["••••", "⎮•••", "⎮⎮••", "⎮⎮⎮•", "⎮⎮⎮⎮"];
      // Servidor devolve 1 a 6. 6 paus = 0 pontos (símbolo symbols[0]).
      const upCount = (this.dice === 6) ? 0 : this.dice; 
      const symbol = symbols[upCount]; 
      
      this.ui.animateSticks(symbol, this.dice, false);
      this.ui.addMessage("System", `Sticks rolled: ${this.dice}`);
    }

    // 4) Mensagens de início de jogo / mudança de vez
    if (!previousTurn && this.currentTurn) {
      this.ui.addMessage("System", `Game started! First to play: ${this.currentTurn}.`);
    } else if (previousTurn && this.currentTurn && previousTurn !== this.currentTurn) {
      this.ui.addMessage("System", `It's now ${this.currentTurn}'s turn.`);
    }

    // 5) LIGAÇÃO CRÍTICA 2: Atualização do botão Rolar
    this.ui.refreshRollButtonOnline(this.canRoll());


    // 6) Fim de jogo
    if (data.winner !== undefined) {
      this.winner = data.winner;
      if (this.winner) {
        this.ui.addMessage("System", `Winner: ${this.winner}`);
      } else {
        this.ui.addMessage("System", "Game ended without a winner.");
      }
      this.cleanup(); // fecha o EventSource e desativa botões
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

    // O jogador só pode rolar se for a sua vez E o dado ainda não tiver sido rolado.
    const isMyTurn = this.currentTurn === creds.nick;
    const diceNotRolled = this.dice === null || this.dice === undefined;
    
    if (isMyTurn && !diceNotRolled) {
        // Adicionar mensagem para evitar cliques desnecessários
        this.ui.addMessage("System", "You already rolled the dice this turn.");
    }

    // Retorna true se for a minha vez E o dado ainda não foi rolado
    return isMyTurn && diceNotRolled;
  }


  canPass() {
    const creds = this.ui.getCredentials();
    // Só posso passar se: 
    // 1. Estiver autenticado e no jogo.
    // 2. For a minha vez.
    // 3. O servidor tiver enviado que eu SOU O OBRIGADO a passar (mustPass)
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
      // Nota: Para o Tâb, "Gold" (G) é geralmente o jogador inicial ou de baixo. 
      // Assumindo que "Blue" é "Gold" (G) e "Red" é "Black" (B) para consistência visual.
      const player = p.color === "Blue" ? "G" : "B"; 
      matrix[r][c] = { player, type: p.reachedLastRow ? "final" : (p.inMotion ? "moved" : "initial") };
    });

    // currentPlayer: quem tem a vez
    // Fallback simples para a cor, assumindo que o nick do jogador Gold/Blue é o inicial
    let currentPlayer = "G"; 
    
    // Tentativa de obter a cor correta do nick se os dados de 'players' vierem no update.
    // Se não vierem, a cor ativa da barra de estado não é crítica, mas o tabuleiro é.
    const creds = this.ui.getCredentials();
    if (this.currentTurn && creds) {
        if (this.currentTurn === creds.nick) {
            // Se for a minha vez, a cor deve ser a do meu nick. 
            // O servidor não fornece o mapeamento nick -> cor, mas podemos assumir.
            // Para simplicidade, vamos manter o foco no nick.
        }
    }


    this.ui.renderBoard(matrix, this.currentTurn, (r, c) => this.handleCellClick(r, c));
  }
}

