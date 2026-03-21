import {
  CellValue,
  MatchSnapshot,
  PlayerState,
  PlayerSymbol,
  TicTacToeMatchState
} from "../types/match";

const WINNING_LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

export const MOVE_OPCODE = 1;
export const STATE_OPCODE = 2;
export const ERROR_OPCODE = 99;

export function createInitialState(): TicTacToeMatchState {
  return {
    board: new Array(9).fill(""),
    players: {},
    playerOrder: [],
    currentTurnUserId: null,
    status: "WAITING_FOR_PLAYERS",
    winnerUserId: null,
    winnerSymbol: null,
    winningLine: null,
    reason: null,
    emptyTicks: 0
  };
}

export function buildSnapshot(state: TicTacToeMatchState): MatchSnapshot {
  const players: PlayerState[] = state.playerOrder
    .map((userId) => state.players[userId])
    .filter((player): player is PlayerState => Boolean(player));

  return {
    board: state.board,
    currentTurnUserId: state.currentTurnUserId,
    status: state.status,
    winnerUserId: state.winnerUserId,
    winnerSymbol: state.winnerSymbol,
    winningLine: state.winningLine,
    reason: state.reason,
    players
  };
}

export function assignSymbol(playerCount: number): PlayerSymbol {
  return playerCount === 0 ? "X" : "O";
}

export function checkWinner(board: CellValue[]): { symbol: PlayerSymbol; line: number[] } | null {
  for (var i = 0; i < WINNING_LINES.length; i++) {
    var line = WINNING_LINES[i];
    var a = board[line[0]];
    var b = board[line[1]];
    var c = board[line[2]];
    if (a !== "" && a === b && b === c) {
      return { symbol: a, line: line };
    }
  }

  return null;
}

export function isBoardFull(board: CellValue[]): boolean {
  return board.every((cell) => cell !== "");
}
