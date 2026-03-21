# Multiplayer Tic-Tac-Toe (Nakama + React)

This repository is structured for a server-authoritative multiplayer Tic-Tac-Toe game.

## Project layout

- `server/nakama`: Nakama TypeScript runtime modules (authoritative match + matchmaking hook).
- `client`: React (Vite) frontend (to be expanded next).
- `infra`: Local infrastructure configs for Nakama.
- `docker-compose.yml`: Local Postgres + Nakama stack.

## Local server runtime build

1. Install dependencies:
   - `cd server/nakama`
   - `npm install`
2. Build TypeScript runtime:
   - `npm run build`
3. Start local infrastructure (from repository root):
   - `docker compose up -d`

Nakama loads compiled runtime modules from `server/nakama/build`.
