import { assignSymbol, buildSnapshot, checkWinner, createInitialState, ERROR_OPCODE, isBoardFull, MOVE_OPCODE, STATE_OPCODE } from "./logic";
import { MatchMove, TicTacToeMatchState } from "../types/match";

const TICK_RATE = 5;
const MAX_EMPTY_TICKS = TICK_RATE * 20;

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: TicTacToeMatchState, presences?: nkruntime.Presence[]): void {
  dispatcher.broadcastMessage(STATE_OPCODE, JSON.stringify(buildSnapshot(state)), presences);
}

function sendError(dispatcher: nkruntime.MatchDispatcher, presence: nkruntime.Presence, reason: string): void {
  dispatcher.broadcastMessage(ERROR_OPCODE, JSON.stringify({ error: reason }), [presence]);
}

function parseMove(nk: nkruntime.Nakama, messageData: string | Uint8Array): MatchMove | null {
  try {
    const text = typeof messageData === "string" ? messageData : nk.binaryToString(messageData);
    return JSON.parse(text) as MatchMove;
  } catch (_err) {
    return null;
  }
}

export const ticTacToeMatch: nkruntime.MatchHandler<TicTacToeMatchState> = {
  matchInit: function (_ctx, _logger, _nk, _params) {
    return {
      state: createInitialState(),
      tickRate: TICK_RATE,
      label: "tic-tac-toe"
    };
  },

  matchJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
    const knownPlayer = Boolean(state.players[presence.userId]);
    const hasRoom = state.playerOrder.length < 2;
    const accept = knownPlayer || hasRoom;

    return {
      state: state,
      accept: accept,
      rejectMessage: accept ? undefined : "Match is full."
    };
  },

  matchJoin: function (_ctx, logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
      const existing = state.players[presence.userId];
      if (existing) {
        existing.connected = true;
        existing.username = presence.username;
        continue;
      }

      if (state.playerOrder.length >= 2) {
        continue;
      }

      const symbol = assignSymbol(state.playerOrder.length);
      state.players[presence.userId] = {
        userId: presence.userId,
        username: presence.username,
        symbol: symbol,
        connected: true
      };
      state.playerOrder.push(presence.userId);
      logger.info("Player joined match userId=%s symbol=%s", presence.userId, symbol);
    }

    if (state.playerOrder.length === 2 && state.status === "WAITING_FOR_PLAYERS") {
      state.status = "IN_PROGRESS";
      state.currentTurnUserId = state.playerOrder[0];
      state.reason = null;
      logger.info("Match started with players=%v", state.playerOrder);
    }

    state.emptyTicks = 0;
    broadcastState(dispatcher, state);
    return { state: state };
  },

  matchLeave: function (_ctx, logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
      const player = state.players[presence.userId];
      if (player) {
        player.connected = false;
        logger.info("Player disconnected userId=%s", presence.userId);
      }
    }

    if (state.status === "IN_PROGRESS") {
      const connectedPlayers = state.playerOrder
        .map((userId) => state.players[userId])
        .filter((player) => Boolean(player && player.connected));

      if (connectedPlayers.length === 1) {
        state.status = "FINISHED";
        state.winnerUserId = connectedPlayers[0].userId;
        state.winnerSymbol = connectedPlayers[0].symbol;
        state.winningLine = null;
        state.reason = "OPPONENT_LEFT";
        state.currentTurnUserId = null;
        logger.info("Match ended due to disconnect winner=%s", connectedPlayers[0].userId);
      }
    }

    broadcastState(dispatcher, state);
    return { state: state };
  },

  matchLoop: function (_ctx, logger, nk, dispatcher, _tick, state, messages) {
    if (state.playerOrder.every((userId) => !state.players[userId]?.connected)) {
      state.emptyTicks += 1;
      if (state.emptyTicks >= MAX_EMPTY_TICKS) {
        logger.info("Stopping empty match due to no active players.");
        return null;
      }
    } else {
      state.emptyTicks = 0;
    }

    for (const message of messages) {
      if (message.opCode !== MOVE_OPCODE) {
        continue;
      }

      if (state.status !== "IN_PROGRESS") {
        sendError(dispatcher, message.sender, "Match is not active.");
        continue;
      }

      if (message.sender.userId !== state.currentTurnUserId) {
        sendError(dispatcher, message.sender, "Not your turn.");
        continue;
      }

      const move = parseMove(nk, message.data);
      if (!move || !Number.isInteger(move.index) || move.index < 0 || move.index > 8) {
        sendError(dispatcher, message.sender, "Invalid move payload.");
        continue;
      }

      if (state.board[move.index] !== "") {
        sendError(dispatcher, message.sender, "Cell already occupied.");
        continue;
      }

      const player = state.players[message.sender.userId];
      if (!player) {
        sendError(dispatcher, message.sender, "Player not registered in this match.");
        continue;
      }

      state.board[move.index] = player.symbol;

      const winner = checkWinner(state.board);
      if (winner) {
        state.status = "FINISHED";
        state.winnerUserId = player.userId;
        state.winnerSymbol = winner.symbol;
        state.winningLine = winner.line;
        state.currentTurnUserId = null;
        state.reason = "NORMAL";
      } else if (isBoardFull(state.board)) {
        state.status = "FINISHED";
        state.winnerUserId = null;
        state.winnerSymbol = null;
        state.winningLine = null;
        state.currentTurnUserId = null;
        state.reason = "NORMAL";
      } else {
        const nextUserId = state.playerOrder.find((userId) => userId !== message.sender.userId) || null;
        state.currentTurnUserId = nextUserId;
      }

      logger.debug("Accepted move userId=%s index=%v", message.sender.userId, move.index);
      broadcastState(dispatcher, state);
    }

    return { state: state };
  },

  matchTerminate: function (_ctx, _logger, dispatcher, _tick, state, _graceSeconds) {
    broadcastState(dispatcher, state);
    return { state: state };
  },

  matchSignal: function (_ctx, _logger, _nk, _dispatcher, _tick, state, data) {
    return {
      state: state,
      data: data
    };
  }
};
