/// <reference path="./nakama-runtime.d.ts" />

type PlayerSymbol = "X" | "O";
type CellValue = PlayerSymbol | "";
type MatchStatus = "WAITING_FOR_PLAYERS" | "IN_PROGRESS" | "FINISHED";
type MatchEndReason = "NORMAL" | "OPPONENT_LEFT" | "TURN_TIMEOUT" | null;
type MatchMode = "CLASSIC" | "TIMED";

interface PlayerState {
  userId: string;
  username: string;
  symbol: PlayerSymbol;
  connected: boolean;
}

interface MatchMove {
  index: number;
}

interface TicTacToeMatchState {
  board: CellValue[];
  players: Record<string, PlayerState>;
  playerOrder: string[];
  currentTurnUserId: string | null;
  status: MatchStatus;
  winnerUserId: string | null;
  winnerSymbol: PlayerSymbol | null;
  winningLine: number[] | null;
  reason: MatchEndReason;
  emptyTicks: number;
  turnDeadlineAtMs: number | null;
  resultsPersisted: boolean;
  matchMode: MatchMode;
  lastTimerBroadcastSec: number | null;
  playerDisplayNames: Record<string, string>;
}

interface PlayerStats {
  wins: number;
  currentStreak: number;
  bestStreak: number;
}

var WINNING_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
var MOVE_OPCODE = 1;
var STATE_OPCODE = 2;
var ERROR_OPCODE = 99;
var TICK_RATE = 5;
var MAX_EMPTY_TICKS = TICK_RATE * 20;
var TURN_TIMEOUT_MS = 30000;
var STATS_COLLECTION = "ttt_player_stats";
var STATS_KEY = "summary";
var WINS_LEADERBOARD = "ttt_wins";
var STREAK_LEADERBOARD = "ttt_win_streak";

function sanitizeMode(rawMode: unknown): MatchMode {
  if (rawMode === "TIMED" || rawMode === "timed" || rawMode === 1 || rawMode === "1" || rawMode === true) return "TIMED";
  return "CLASSIC";
}

function extractEntryMode(entry: nkruntime.MatchmakerResult): MatchMode {
  var fromPropertiesMode = sanitizeMode(entry.properties?.mode);
  if (fromPropertiesMode === "TIMED") return "TIMED";
  var fromStringPropsMode = sanitizeMode(entry.stringProperties?.mode);
  if (fromStringPropsMode === "TIMED") return "TIMED";
  var fromPropertiesTimed = sanitizeMode(entry.properties?.timed);
  if (fromPropertiesTimed === "TIMED") return "TIMED";
  var fromNumericPropsTimed = sanitizeMode(entry.numericProperties?.timed);
  if (fromNumericPropsTimed === "TIMED") return "TIMED";
  return "CLASSIC";
}

function extractEntryNickname(entry: nkruntime.MatchmakerResult): string {
  var fromStringProps = entry.stringProperties?.nickname;
  if (fromStringProps && fromStringProps.trim()) return fromStringProps.trim();

  var fromProperties = entry.properties?.nickname;
  if (typeof fromProperties === "string" && fromProperties.trim()) return fromProperties.trim();

  return entry.presence.username;
}

function createInitialState(mode: MatchMode, playerDisplayNames?: Record<string, string>): TicTacToeMatchState {
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
    emptyTicks: 0,
    turnDeadlineAtMs: null,
    resultsPersisted: false,
    matchMode: mode,
    lastTimerBroadcastSec: null,
    playerDisplayNames: playerDisplayNames ?? {}
  };
}

function assignSymbol(playerCount: number): PlayerSymbol {
  return playerCount === 0 ? "X" : "O";
}

function checkWinner(board: CellValue[]): { symbol: PlayerSymbol; line: number[] } | null {
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

function isBoardFull(board: CellValue[]): boolean {
  return board.every(function (cell) { return cell !== ""; });
}

function buildSnapshot(state: TicTacToeMatchState) {
  var players: PlayerState[] = state.playerOrder
    .map(function (userId) { return state.players[userId]; })
    .filter(function (player): player is PlayerState { return Boolean(player); });

  return {
    board: state.board,
    currentTurnUserId: state.currentTurnUserId,
    status: state.status,
    winnerUserId: state.winnerUserId,
    winnerSymbol: state.winnerSymbol,
    winningLine: state.winningLine,
    reason: state.reason,
    players: players,
    matchMode: state.matchMode,
    turnDeadlineAtMs: state.turnDeadlineAtMs
  };
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: TicTacToeMatchState, presences?: nkruntime.Presence[]): void {
  dispatcher.broadcastMessage(STATE_OPCODE, JSON.stringify(buildSnapshot(state)), presences);
}

function sendError(dispatcher: nkruntime.MatchDispatcher, presence: nkruntime.Presence, reason: string): void {
  dispatcher.broadcastMessage(ERROR_OPCODE, JSON.stringify({ error: reason }), [presence]);
}

function parseMove(nk: nkruntime.Nakama, messageData: string | Uint8Array): MatchMove | null {
  try {
    var text = typeof messageData === "string" ? messageData : nk.binaryToString(messageData);
    return JSON.parse(text) as MatchMove;
  } catch (_err) {
    return null;
  }
}

function updateTurnDeadline(state: TicTacToeMatchState): void {
  if (state.matchMode === "TIMED" && state.status === "IN_PROGRESS" && state.currentTurnUserId) {
    state.turnDeadlineAtMs = Date.now() + TURN_TIMEOUT_MS;
    state.lastTimerBroadcastSec = null;
    return;
  }
  state.turnDeadlineAtMs = null;
  state.lastTimerBroadcastSec = null;
}

function readStats(nk: nkruntime.Nakama, userId: string): PlayerStats {
  var records = nk.storageRead([{ collection: STATS_COLLECTION, key: STATS_KEY, userId: userId }]);
  if (!records || records.length === 0) {
    return { wins: 0, currentStreak: 0, bestStreak: 0 };
  }

  try {
    var rawValue = records[0].value;
    var parsed = (typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue) as Partial<PlayerStats>;
    return {
      wins: parsed.wins ?? 0,
      currentStreak: parsed.currentStreak ?? 0,
      bestStreak: parsed.bestStreak ?? 0
    };
  } catch (_err) {
    return { wins: 0, currentStreak: 0, bestStreak: 0 };
  }
}

function writeStats(
  nk: nkruntime.Nakama,
  userId: string,
  stats: PlayerStats
): void {
  nk.storageWrite([{
    collection: STATS_COLLECTION,
    key: STATS_KEY,
    userId: userId,
    value: {
      wins: stats.wins,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak
    },
    permissionRead: 1,
    permissionWrite: 0
  }]);
}

function resetPlayerStreak(nk: nkruntime.Nakama, userId: string): void {
  var stats = readStats(nk, userId);
  stats.currentStreak = 0;
  writeStats(nk, userId, stats);
  nk.leaderboardRecordWrite(STREAK_LEADERBOARD, userId, undefined, 0, 0, {});
}

function persistMatchResults(logger: nkruntime.Logger, nk: nkruntime.Nakama, state: TicTacToeMatchState): void {
  if (state.status !== "FINISHED" || state.resultsPersisted) {
    return;
  }
  state.resultsPersisted = true;

  if (!state.winnerUserId) {
    state.playerOrder.forEach(function (userId) {
      resetPlayerStreak(nk, userId);
    });
    logger.info("Draw result persisted. Both streaks reset.");
    return;
  }

  var winner = state.players[state.winnerUserId];
  if (!winner) {
    return;
  }

  var winnerStats = readStats(nk, winner.userId);
  winnerStats.wins += 1;
  winnerStats.currentStreak += 1;
  if (winnerStats.currentStreak > winnerStats.bestStreak) {
    winnerStats.bestStreak = winnerStats.currentStreak;
  }
  writeStats(nk, winner.userId, winnerStats);
  nk.leaderboardRecordWrite(WINS_LEADERBOARD, winner.userId, winner.username, winnerStats.wins, 0, {
    reason: state.reason,
    username: winner.username
  });
  nk.leaderboardRecordWrite(STREAK_LEADERBOARD, winner.userId, winner.username, winnerStats.currentStreak, 0, {
    bestStreak: winnerStats.bestStreak,
    username: winner.username
  });

  state.playerOrder.forEach(function (userId) {
    if (userId !== winner.userId) {
      resetPlayerStreak(nk, userId);
    }
  });

  logger.info("Persisted result winner=%s reason=%s wins=%v streak=%v", winner.userId, state.reason ?? "UNKNOWN", winnerStats.wins, winnerStats.currentStreak);
}

function matchInit(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, params: Record<string, unknown>) {
  var mode = sanitizeMode(params.matchMode);
  var displayNames = (params.playerDisplayNames as Record<string, string> | undefined) ?? {};
  return { state: createInitialState(mode, displayNames), tickRate: TICK_RATE, label: "tic-tac-toe:" + mode.toLowerCase() };
}

function matchJoinAttempt(
  _ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, presence: nkruntime.Presence, _metadata: Record<string, unknown>
) {
  var knownPlayer = Boolean(state.players[presence.userId]);
  var hasRoom = state.playerOrder.length < 2;
  var accept = knownPlayer || hasRoom;
  return { state: state, accept: accept, rejectMessage: accept ? undefined : "Match is full." };
}

function matchJoin(
  _ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, presences: nkruntime.Presence[]
) {
  presences.forEach(function (presence) {
    var existing = state.players[presence.userId];
    if (existing) {
      existing.connected = true;
      var reconnectName = state.playerDisplayNames[presence.userId];
      existing.username = reconnectName && reconnectName.trim() ? reconnectName.trim() : existing.username;
      return;
    }
    if (state.playerOrder.length >= 2) return;
    var symbol = assignSymbol(state.playerOrder.length);
    var mappedName = state.playerDisplayNames[presence.userId];
    state.players[presence.userId] = { userId: presence.userId, username: presence.username, symbol: symbol, connected: true };
    if (mappedName && mappedName.trim()) {
      state.players[presence.userId].username = mappedName.trim();
    }
    state.playerOrder.push(presence.userId);
    logger.info("Player joined match userId=%s symbol=%s", presence.userId, symbol);
  });

  if (state.playerOrder.length === 2 && state.status === "WAITING_FOR_PLAYERS") {
    state.status = "IN_PROGRESS";
    state.currentTurnUserId = state.playerOrder[0];
    state.reason = null;
    updateTurnDeadline(state);
  }

  state.emptyTicks = 0;
  broadcastState(dispatcher, state);
  return { state: state };
}

function matchLeave(
  _ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, presences: nkruntime.Presence[]
) {
  presences.forEach(function (presence) {
    var p = state.players[presence.userId];
    if (p) {
      p.connected = false;
      logger.info("Player disconnected userId=%s", presence.userId);
    }
  });

  if (state.status === "IN_PROGRESS") {
    var connected = state.playerOrder.map(function (userId) { return state.players[userId]; }).filter(function (p) { return Boolean(p && p.connected); });
    if (connected.length === 1) {
      state.status = "FINISHED";
      state.winnerUserId = connected[0].userId;
      state.winnerSymbol = connected[0].symbol;
      state.winningLine = null;
      state.reason = "OPPONENT_LEFT";
      state.currentTurnUserId = null;
      updateTurnDeadline(state);
    }
  }

  persistMatchResults(logger, nk, state);
  broadcastState(dispatcher, state);
  return { state: state };
}

function matchLoop(
  _ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, messages: nkruntime.MatchMessage[]
) {
  var noConnectedPlayers = state.playerOrder.every(function (userId) {
    var p = state.players[userId];
    return !p || !p.connected;
  });
  if (noConnectedPlayers) {
    state.emptyTicks += 1;
    if (state.emptyTicks >= MAX_EMPTY_TICKS) {
      logger.info("Stopping empty match due to no active players.");
      return null;
    }
  } else {
    state.emptyTicks = 0;
  }

  if (
    state.matchMode === "TIMED" &&
    state.status === "IN_PROGRESS" &&
    state.currentTurnUserId &&
    state.turnDeadlineAtMs !== null &&
    Date.now() > state.turnDeadlineAtMs
  ) {
    var timedOutUserId = state.currentTurnUserId;
    var winnerUserId = state.playerOrder.find(function (userId) {
      var player = state.players[userId];
      return userId !== timedOutUserId && Boolean(player && player.connected);
    }) || null;

    state.status = "FINISHED";
    state.winnerUserId = winnerUserId;
    state.winnerSymbol = winnerUserId ? state.players[winnerUserId].symbol : null;
    state.winningLine = null;
    state.reason = "TURN_TIMEOUT";
    state.currentTurnUserId = null;
    updateTurnDeadline(state);
    persistMatchResults(logger, nk, state);
    logger.info("Turn timeout: forfeited userId=%s winner=%s", timedOutUserId, winnerUserId ?? "NONE");
    broadcastState(dispatcher, state);
    return { state: state };
  }

  if (state.matchMode === "TIMED" && state.status === "IN_PROGRESS" && state.turnDeadlineAtMs !== null) {
    var remainingMs = Math.max(0, state.turnDeadlineAtMs - Date.now());
    var remainingSec = Math.ceil(remainingMs / 1000);
    if (state.lastTimerBroadcastSec !== remainingSec) {
      state.lastTimerBroadcastSec = remainingSec;
      broadcastState(dispatcher, state);
    }
  }

  messages.forEach(function (message) {
    if (message.opCode !== MOVE_OPCODE) return;
    if (state.status !== "IN_PROGRESS") return sendError(dispatcher, message.sender, "Match is not active.");
    if (message.sender.userId !== state.currentTurnUserId) return sendError(dispatcher, message.sender, "Not your turn.");

    var move = parseMove(nk, message.data);
    if (!move || !Number.isInteger(move.index) || move.index < 0 || move.index > 8) return sendError(dispatcher, message.sender, "Invalid move payload.");
    if (state.board[move.index] !== "") return sendError(dispatcher, message.sender, "Cell already occupied.");

    var player = state.players[message.sender.userId];
    if (!player) return sendError(dispatcher, message.sender, "Player not registered in this match.");

    state.board[move.index] = player.symbol;
    var winner = checkWinner(state.board);
    if (winner) {
      state.status = "FINISHED";
      state.winnerUserId = player.userId;
      state.winnerSymbol = winner.symbol;
      state.winningLine = winner.line;
      state.currentTurnUserId = null;
      state.reason = "NORMAL";
      updateTurnDeadline(state);
    } else if (isBoardFull(state.board)) {
      state.status = "FINISHED";
      state.winnerUserId = null;
      state.winnerSymbol = null;
      state.winningLine = null;
      state.currentTurnUserId = null;
      state.reason = "NORMAL";
      updateTurnDeadline(state);
    } else {
      state.currentTurnUserId = state.playerOrder.find(function (userId: string) { return userId !== message.sender.userId; }) || null;
      updateTurnDeadline(state);
    }

    persistMatchResults(logger, nk, state);
    broadcastState(dispatcher, state);
  });

  return { state: state };
}

function matchTerminate(
  _ctx: nkruntime.Context, _logger: nkruntime.Logger, dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, _graceSeconds: number
) {
  broadcastState(dispatcher, state);
  return { state: state };
}

function matchSignal(
  _ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher,
  _tick: number, state: TicTacToeMatchState, data: string
) {
  return { state: state, data: data };
}

function onMatchmakerMatched(
  _ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, entries: nkruntime.MatchmakerResult[]
): string {
  var userIds = entries.map(function (entry) { return entry.presence.userId; });
  var playerDisplayNames: Record<string, string> = {};
  entries.forEach(function (entry) {
    playerDisplayNames[entry.presence.userId] = extractEntryNickname(entry);
  });
  var requestedMode = extractEntryMode(entries[0]);
  var hasMixedModes = entries.some(function (entry) {
    return extractEntryMode(entry) !== requestedMode;
  });
  if (hasMixedModes) {
    logger.error("Mixed matchmaking modes detected in matched entries. Falling back to CLASSIC.");
    requestedMode = "CLASSIC";
  }
  logger.info("Matchmaker paired players=%v mode=%s names=%v", userIds, requestedMode, playerDisplayNames);
  return nk.matchCreate("tic_tac_toe_match", {
    matchedUserIds: userIds,
    matchMode: requestedMode,
    playerDisplayNames: playerDisplayNames
  });
}

function InitModule(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void {
  _nk.leaderboardCreate(WINS_LEADERBOARD, true, "desc", "best", null, { mode: "wins" }, true);
  _nk.leaderboardCreate(STREAK_LEADERBOARD, true, "desc", "best", null, { mode: "streak" }, true);
  initializer.registerMatch("tic_tac_toe_match", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });
  initializer.registerMatchmakerMatched(onMatchmakerMatched);
  logger.info("Tic-Tac-Toe Nakama runtime initialized.");
}
