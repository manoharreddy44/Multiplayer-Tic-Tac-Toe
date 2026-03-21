# ARCHITECTUE

## Overview

This project implements a multiplayer Tic-Tac-Toe game where Nakama is the source of truth for all gameplay transitions. The frontend acts as a thin client that sends player intent and renders authoritative snapshots.

## Server-Authoritative Design

### Match lifecycle

- Matchmaker pairs exactly 2 players.
- Runtime callback creates authoritative match (`tic_tac_toe_match`).
- Match state lives in Nakama memory during match execution.

### State machine

- `WAITING_FOR_PLAYERS`
- `IN_PROGRESS`
- `FINISHED`

The state includes board cells, turn owner, players, winner metadata, end reason, and timeout metadata.

### Anti-cheat model

The client can only submit move intents (`OpCode 1`). The runtime validates each move against:

- active match status
- sender is current turn owner
- index is in [0..8]
- target cell is empty

If any check fails, the move is rejected and the board remains unchanged.

### Result computation

Runtime computes all terminal conditions:

- 3-in-a-row winner
- full-board draw
- opponent disconnected
- turn timeout (30s forfeit)

The server then broadcasts updated snapshots (`OpCode 2`) to both players.

## Bonus Feature: Leaderboards

### Why this approach

Nakama leaderboard primitives give ranking and retrieval support without custom ranking infrastructure.

### Implemented boards

- `ttt_wins`: cumulative wins per player
- `ttt_win_streak`: current win streak per player

### Persistence model

Per-player aggregate stats are stored in Nakama storage:

- collection: `ttt_player_stats`
- key: `summary`

Stored payload:

- `wins`
- `currentStreak`
- `bestStreak`

At match completion:

- winner: wins +1, streak +1, update both leaderboards
- losers: current streak reset to 0
- draw: both streaks reset to 0

## Bonus Feature: Turn Timer

### Behavior

- timer starts when match enters `IN_PROGRESS`
- timer resets after each valid move
- if no move within 30s from current player:
  - current player forfeits
  - opponent wins
  - match reason set to `TURN_TIMEOUT`
  - results persisted

### Why server-side timer

A client-side timer is not trustworthy and can be manipulated. Server-side timing ensures fairness and deterministic enforcement.

## Frontend Responsibilities

The frontend intentionally remains simple:

- authenticate user (`authenticateCustom`)
- enqueue into matchmaker
- submit move intents
- render authoritative snapshots
- display terminal states and allow replay flow

No client-side winner engine is used as a source of truth.

## Performance and DX rationale

- Vite enables fast local iteration and quick reviewer setup.
- React provides predictable component composition for UI states.
- Nakama removes need for bespoke websocket/matchmaking infra.

## Files of interest

- `server/nakama/src/runtime.ts`: authoritative game runtime, timeout, result persistence
- `client/src/App.tsx`: matchmaking + authoritative state rendering
- `client/src/hooks/useNakama.ts`: Nakama client/session/socket lifecycle
- `client/src/components/Board.tsx`: board UI
