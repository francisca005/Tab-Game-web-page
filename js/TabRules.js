// js/TabRules.js
// Motor de regras "puro" para o Tâb (sem UI / servidor)

export class TabRules {
  constructor(rows = 4, cols = 9) {
    this.rows = rows;
    this.cols = cols;
  }

  // Permite mudar o tamanho do tabuleiro (4 x cols)
  setSize(rows, cols) {
    this.rows = rows;
    this.cols = cols;
  }

  // Espelhamento vertical (para tratar o caminho do ponto de vista de Gold)
  mirrorIndex(idx) {
    return this.rows * this.cols - 1 - idx;
  }

  // Caminho em serpente (mesma lógica do TabGame)
  getBoardPath() {
    const path = [];
    for (let r = 0; r < this.rows; r++) {
      if (r % 2 === 0) {
        for (let c = this.cols - 1; c >= 0; c--) {
          path.push(r * this.cols + c);
        }
      } else {
        for (let c = 0; c < this.cols; c++) {
          path.push(r * this.cols + c);
        }
      }
    }
    return path;
  }

  // Bifurcação: 3ª → 4ª fila com alternativa para 2ª (espelho)
  getSpecialMoves(curIdx, nextIdx) {
    const specials = [];
    const rCur = Math.floor(curIdx / this.cols);
    const rNxt = Math.floor(nextIdx / this.cols);
    const cCur = curIdx % this.cols;

    // Apenas a bifurcação correta: 3ª - 4ª fila, alternativa para 2ª (espelho)
    if (rCur === 2 && rNxt === 3) {
      const rr = 1; // 2ª fila (0-based)
      const cc = cCur; // mesma coluna (espelho)
      specials.push(rr * this.cols + cc);
    }

    return specials;
  }

  // Próximas posições possíveis num passo
  computeNextPositions(idx) {
    const path = this.getBoardPath();

    // índice de tabuleiro -> posição no path
    const idxToPathPos = new Map();
    for (let i = 0; i < path.length; i++) {
      idxToPathPos.set(path[i], i);
    }

    const p = idxToPathPos.get(idx);
    if (p == null) return [];

    const result = [];

    if (p + 1 < path.length) {
      // Passo normal + bifurcação (se existir)
      const cur = path[p];
      const nxt = path[p + 1];
      result.push(nxt, ...this.getSpecialMoves(cur, nxt));
    } else {
      // Última casa do path (fim da 4ª fila) → pode "descer" para a 3ª fila
      const cur = path[p];
      const rCur = Math.floor(cur / this.cols);
      if (rCur === 3) { // 4ª fila (0-based)
        const cCur = cur % this.cols;
        const aboveIdx = 2 * this.cols + cCur; // (r=2, mesma coluna)
        result.push(aboveIdx);
      }
    }

    return [...new Set(result)];
  }

  // Avançar 'steps' passos a partir de startIdx, considerando bifurcações
  advanceVariants(startIdx, steps) {
    let frontier = [startIdx];
    for (let i = 0; i < steps; i++) {
      const next = [];
      for (const pos of frontier) {
        next.push(...this.computeNextPositions(pos));
      }
      frontier = [...new Set(next)];
    }
    return frontier;
  }

  /**
   * Regra do "primeiro movimento só com 1".
   *
   * board: array de células -> { player: "G"|"B" } ou null
   * player: "G" ou "B"
   * roll: valor atual dos paus
   * idx: índice da célula onde está a peça
   */
  canMovePiece(board, player, roll, idx) {
    if (!roll || roll <= 0) return false;
    const piece = board[idx];
    if (!piece || piece.player !== player) return false;

    const row = Math.floor(idx / this.cols);
    const playerStartRow = player === "G" ? 0 : this.rows - 1;
    const isInitial = row === playerStartRow; // nunca saiu da linha inicial

    // Peça inicial só mexe com 1, as restantes mexem com qualquer valor
    return roll === 1 || !isInitial;
  }

  /**
   * Destinos válidos a partir de idx, dado o roll.
   * NÃO usa histórico (wasOnLastRow), porque no modo online não o temos.
   * Regras aplicadas:
   *  - movimento em serpente + bifurcação
   *  - não pode cair em casa ocupada pela mesma cor
   *  - nunca voltar à fila inicial depois de a deixar
   *  - só pode entrar na fila final quando a fila inicial estiver vazia
   */
  validTargetsFrom(board, player, roll, idx) {
    if (!roll || roll <= 0) return [];

    const mirror = this.mirrorIndex.bind(this);

    // Converter para o espaço Gold se for Black
    let start = idx;
    if (player === "B") start = mirror(start);

    // Avança exatamente 'roll' passos no caminho
    const destsGold = this.advanceVariants(start, roll);

    // Voltar ao espaço real se for Black
    const dests = player === "B" ? destsGold.map(mirror) : destsGold;

    const playerStartRow = player === "G" ? 0 : this.rows - 1;
    const playerFinalRow = player === "G" ? this.rows - 1 : 0;
    const rowFrom = Math.floor(idx / this.cols);

    return dests.filter((i) => {
      const p = board[i];
      const rowTo = Math.floor(i / this.cols);

      // (1) Não pode cair em casa ocupada pela mesma cor
      if (p && p.player === player) return false;

      // (2) Nunca voltar à fila inicial depois de a deixar
      if (rowTo === playerStartRow && rowFrom !== playerStartRow) {
        return false;
      }

      // (3) Só pode ENTRAR na fila FINAL se a fila INICIAL estiver vazia
      if (rowTo === playerFinalRow) {
        const hasStartPieces = board
          .slice(playerStartRow * this.cols, (playerStartRow + 1) * this.cols)
          .some((cell) => cell && cell.player === player);
        if (hasStartPieces) return false;
      }

      return true;
    });
  }
}
