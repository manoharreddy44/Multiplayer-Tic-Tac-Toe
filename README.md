# Multiplayer Tic-Tac-Toe (Server-Authoritative)

Production-style multiplayer Tic-Tac-Toe built with Nakama runtime + React (Vite), optimized for mobile-first play and reviewer-friendly setup.

## Architecture (Server-Authoritative)

Game state authority lives entirely on Nakama. Clients never decide legal moves or winners.

Flow:

1. Client authenticates using `authenticateCustom`.
2. Client selects queue mode (`Classic` or `Timed`) and enters Nakama matchmaker.
3. Nakama `matchmaker matched` callback creates an authoritative match.
4. Clients send only move intent (`OpCode 1`, `{ index }`).
5. Match handler validates:
   - player turn
   - payload/index bounds
   - cell occupancy
   - match status
6. Server mutates board, computes winner/draw/timeout/disconnect outcomes.
7. Server broadcasts authoritative snapshot (`OpCode 2`) to both players.

Why cheating is prevented:

- Client cannot force board updates directly.
- Out-of-turn and invalid cell moves are rejected by runtime.
- Winner computation and end-state transitions happen only on server.
- Leaderboard writes and streak resets happen only on server after match end.

## Architecture Decisions

- **Authoritative outcomes:** win/loss/draw/timeout are derived only in runtime logic, never in React state.
- **Authoritative ranking updates:** leaderboard score and streak changes are persisted only from backend result finalization.
- **Mode-safe matchmaking:** matchmaker properties are used to pair only players in the same mode bucket (`classic` vs `timed`).
- **Timed mode integrity:** timeout forfeits are evaluated against server time (`turnDeadlineAtMs`), not client timers.

## Tech Stack Justification

- **React + Vite (frontend):**
  - fast iteration and startup
  - minimal bundle/tooling overhead
  - smooth mobile-first UI development
- **Nakama (backend):**
  - built-in auth, realtime sockets, matchmaking, authoritative matches
  - proven multiplayer backend primitives
  - easy local deployment via Docker

## Repository Layout

- `server/nakama`: authoritative Nakama runtime (match logic, timer, leaderboard writes)
- `client`: Vite React app (auth, matchmaking UI, board, realtime state sync)
- `infra`: Nakama config
- `docker-compose.yml`: Postgres + Nakama local stack

## Setup (Under 5 Minutes)

### 1) Start backend

From repo root:

```bash
docker compose up -d
```

Check:

```bash
docker compose ps
docker compose logs -f nakama
```

### 2) Build runtime module

```bash
cd server/nakama
npm install
npm run build
```

Restart Nakama once after build:

```bash
cd ../..
docker compose restart nakama
```

### 3) Start frontend

```bash
cd client
npm install
npm run dev
```

Optional env override:

```bash
cp .env.example .env
```

## How To Test (Two Browser Windows)

1. Open app URL in **Window A** and **Window B**.
2. Enter different nicknames and continue.
3. Select a mode (`Classic` or `Timed (30s)`) and click **Find Match** in both windows.
4. Verify both join the same game and board syncs.
5. Verify server-authoritative rules:
   - out-of-turn click does not apply
   - occupied cell click does not apply
   - valid move updates both clients
6. Verify end states:
   - win and draw detection
   - close one window mid-game -> other player wins by disconnect
   - wait >30s without moving on turn -> timeout forfeit
7. Click **Play Again** and re-queue.
8. Open leaderboard panel in lobby and verify wins update after completed games.

## Bonus Features Implemented

- **Leaderboard system (Nakama API):**
  - wins leaderboard: `ttt_wins`
  - current streak leaderboard: `ttt_win_streak`
  - persistent per-player stats in storage (`ttt_player_stats/summary`)
- **Turn timer (30 seconds):**
  - current player forfeits on timeout
  - opponent wins with reason `TURN_TIMEOUT`
  - result persisted to leaderboards/streak storage
- **Mode-aware matchmaking:**
  - `Classic` and `Timed` matchmaking pools are separated using matchmaker properties

## Assignment Notes

`ARCHITECTUE.md` contains deeper architecture and design details for review.
