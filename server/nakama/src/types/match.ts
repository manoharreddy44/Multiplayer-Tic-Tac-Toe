export type PlayerSymbol = "X" | "O";
export type CellValue = PlayerSymbol | "";
export type MatchStatus = "WAITING_FOR_PLAYERS" | "IN_PROGRESS" | "FINISHED";

export interface PlayerState {
  userId: string;
  username: string;
  symbol: PlayerSymbol;
  connected: boolean;
}

export interface MatchMove {
  index: number;
}

export interface MatchSnapshot {
  board: CellValue[];
  currentTurnUserId: string | null;
  status: MatchStatus;
  winnerUserId: string | null;
  winnerSymbol: PlayerSymbol | null;
  winningLine: number[] | null;
  reason: "NORMAL" | "OPPONENT_LEFT" | null;
  players: PlayerState[];
}

export interface TicTacToeMatchState {
  board: CellValue[];
  players: Record<string, PlayerState>;
  playerOrder: string[];
  currentTurnUserId: string | null;
  status: MatchStatus;
  winnerUserId: string | null;
  winnerSymbol: PlayerSymbol | null;
  winningLine: number[] | null;
  reason: "NORMAL" | "OPPONENT_LEFT" | null;
  emptyTicks: number;
}
