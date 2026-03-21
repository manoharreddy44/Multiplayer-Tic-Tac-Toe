import { useCallback, useEffect, useMemo, useState } from "react";
import { Board } from "./components/Board";
import { Leaderboard, LeaderboardRow } from "./components/Leaderboard";
import { useNakama } from "./hooks/useNakama";

type PlayerSymbol = "X" | "O";
type CellValue = PlayerSymbol | "";
type MatchStatus = "WAITING_FOR_PLAYERS" | "IN_PROGRESS" | "FINISHED";
type EndReason = "NORMAL" | "OPPONENT_LEFT" | "TURN_TIMEOUT" | null;
type MatchMode = "CLASSIC" | "TIMED";

interface PlayerState {
  userId: string;
  username: string;
  symbol: PlayerSymbol;
  connected: boolean;
}

interface MatchSnapshot {
  board: CellValue[];
  currentTurnUserId: string | null;
  status: MatchStatus;
  winnerUserId: string | null;
  winnerSymbol: PlayerSymbol | null;
  winningLine: number[] | null;
  reason: EndReason;
  players: PlayerState[];
  matchMode: MatchMode;
  turnDeadlineAtMs: number | null;
}

const MOVE_OPCODE = 1;
const STATE_OPCODE = 2;
const ERROR_OPCODE = 99;

const EMPTY_SNAPSHOT: MatchSnapshot = {
  board: Array(9).fill(""),
  currentTurnUserId: null,
  status: "WAITING_FOR_PLAYERS",
  winnerUserId: null,
  winnerSymbol: null,
  winningLine: null,
  reason: null,
  players: [],
  matchMode: "CLASSIC",
  turnDeadlineAtMs: null
};

type ScreenState = "AUTH" | "LOBBY" | "FINDING_MATCH" | "IN_GAME";

export default function App() {
  const [nickname, setNickname] = useState("");
  const [screen, setScreen] = useState<ScreenState>("AUTH");
  const [ticket, setTicket] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot>(EMPTY_SNAPSHOT);
  const [selectedMode, setSelectedMode] = useState<MatchMode>("CLASSIC");
  const [isJoiningMatch, setIsJoiningMatch] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("Welcome.");
  const [errorText, setErrorText] = useState<string | null>(null);

  const nakama = useNakama();

  useEffect(() => {
    nakama.onMatchData((opCode, payload) => {
      if (opCode === STATE_OPCODE) {
        const nextState = JSON.parse(payload) as MatchSnapshot;
        setSnapshot(nextState);
        setSelectedMode(nextState.matchMode);
        setErrorText(null);
        setScreen("IN_GAME");
      }

      if (opCode === ERROR_OPCODE) {
        const parsed = JSON.parse(payload) as { error?: string };
        setErrorText(parsed.error ?? "Unknown server error.");
      }
    });

    nakama.onMatchmakerMatched(async (newMatchId) => {
      if (!nakama.socket) {
        return;
      }
      try {
        setIsJoiningMatch(true);
        // Ticket is consumed once the server emits a match.
        setTicket(null);
        await nakama.socket.joinMatch(newMatchId);
        setMatchId(newMatchId);
        setScreen("IN_GAME");
        setStatusText("Opponent found. Match started.");
        setErrorText(null);
      } catch (err) {
        setErrorText((err as Error).message);
        setScreen("LOBBY");
      } finally {
        setIsJoiningMatch(false);
      }
    });

    nakama.onDisconnected(() => {
      setStatusText("Socket disconnected.");
      setScreen("AUTH");
      setTicket(null);
      setMatchId(null);
      setSnapshot(EMPTY_SNAPSHOT);
    });

    return () => {
      nakama.onMatchData(null);
      nakama.onMatchmakerMatched(null);
      nakama.onDisconnected(null);
    };
  }, [nakama]);

  const authenticate = useCallback(async () => {
    try {
      setErrorText(null);
      const freshSession = await nakama.connectAndAuthenticate(nickname);
      setScreen("LOBBY");
      setStatusText("Authenticated. Ready to find a match.");
      setIsLeaderboardLoading(true);
      const records = await nakama.listWinsLeaderboard(freshSession);
      setLeaderboardRows(
        records.map((record, index) => ({
          rank: Number(record.rank ?? index + 1),
          username: ((record.metadata as { username?: string } | undefined)?.username ?? record.owner_id ?? "Unknown"),
          score: Number(record.score ?? 0)
        }))
      );
    } catch (err) {
      setErrorText((err as Error).message);
    } finally {
      setIsLeaderboardLoading(false);
    }
  }, [nakama, nickname]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      setIsLeaderboardLoading(true);
      const records = await nakama.listWinsLeaderboard();
      setLeaderboardRows(
        records.map((record, index) => ({
          rank: Number(record.rank ?? index + 1),
          username: ((record.metadata as { username?: string } | undefined)?.username ?? record.owner_id ?? "Unknown"),
          score: Number(record.score ?? 0)
        }))
      );
    } catch (err) {
      setErrorText((err as Error).message);
    } finally {
      setIsLeaderboardLoading(false);
    }
  }, [nakama]);

  const findMatch = useCallback(async () => {
    if (!nakama.socket) {
      setErrorText("Socket is not connected.");
      return;
    }

    try {
      setErrorText(null);
      setScreen("FINDING_MATCH");
      setStatusText(`Finding a random player (${selectedMode.toLowerCase()})...`);
      const newTicket = await nakama.addToMatchmaker(selectedMode, nickname);
      setTicket(newTicket);
    } catch (err) {
      setScreen("LOBBY");
      setErrorText((err as Error).message);
    }
  }, [nakama, nickname, selectedMode]);

  const sendMove = useCallback(
    async (index: number) => {
      if (!nakama.socket || !matchId) {
        return;
      }

      try {
        await nakama.socket.sendMatchState(matchId, MOVE_OPCODE, JSON.stringify({ index }));
      } catch (err) {
        setErrorText((err as Error).message);
      }
    },
    [matchId, nakama.socket]
  );

  const playAgain = useCallback(async () => {
    const cleanupTasks: Promise<unknown>[] = [];

    if (nakama.socket && ticket) {
      cleanupTasks.push(nakama.socket.removeMatchmaker(ticket));
    }
    if (nakama.socket && matchId) {
      cleanupTasks.push(nakama.socket.leaveMatch(matchId));
    }

    // Always reset UI state even if cleanup calls fail server-side.
    setTicket(null);
    setMatchId(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setScreen("LOBBY");
    setStatusText("Ready for another match.");
    setErrorText(null);

    if (cleanupTasks.length > 0) {
      const results = await Promise.allSettled(cleanupTasks);
      const failed = results.find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        setErrorText("Started a new round, but cleanup had a warning.");
      }
    }
    await refreshLeaderboard();
  }, [matchId, nakama.socket, refreshLeaderboard, ticket]);

  useEffect(() => {
    if (snapshot.matchMode !== "TIMED" || snapshot.status !== "IN_PROGRESS" || !snapshot.turnDeadlineAtMs) {
      setTurnSecondsLeft(null);
      return;
    }

    const update = () => {
      const ms = snapshot.turnDeadlineAtMs ? snapshot.turnDeadlineAtMs - Date.now() : 0;
      setTurnSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    update();

    const intervalId = window.setInterval(update, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot.matchMode, snapshot.status, snapshot.turnDeadlineAtMs]);

  const me = useMemo(
    () => snapshot.players.find((player) => player.userId === nakama.session?.user_id) ?? null,
    [nakama.session?.user_id, snapshot.players]
  );

  const opponent = useMemo(
    () => snapshot.players.find((player) => player.userId !== nakama.session?.user_id) ?? null,
    [nakama.session?.user_id, snapshot.players]
  );

  const isMyTurn = snapshot.currentTurnUserId === nakama.session?.user_id;
  const isGameFinished = snapshot.status === "FINISHED";

  const gameStatus = useMemo(() => {
    if (isJoiningMatch) return "Joining match...";
    if (screen === "FINDING_MATCH") return "Finding a random player...";
    if (!matchId) return statusText;
    if (snapshot.status === "WAITING_FOR_PLAYERS") return "Waiting for opponent...";
    if (snapshot.status === "IN_PROGRESS") return isMyTurn ? "Your turn" : "Opponent's turn";
    if (snapshot.reason === "OPPONENT_LEFT") return "Opponent disconnected. You win!";
    if (snapshot.reason === "TURN_TIMEOUT" && snapshot.winnerUserId === nakama.session?.user_id) return "Opponent timed out. You win!";
    if (snapshot.reason === "TURN_TIMEOUT" && snapshot.winnerUserId && snapshot.winnerUserId !== nakama.session?.user_id) return "You timed out. You lose.";
    if (snapshot.winnerUserId && snapshot.winnerUserId === nakama.session?.user_id) return "Winner!";
    if (snapshot.winnerUserId && snapshot.winnerUserId !== nakama.session?.user_id) return "You lost.";
    return "Draw.";
  }, [isJoiningMatch, isMyTurn, matchId, nakama.session?.user_id, screen, snapshot, statusText]);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100">
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">
        <h1 className="text-center text-2xl font-bold tracking-tight">Tic-Tac-Toe</h1>
        <p className="text-center text-sm text-zinc-400">{gameStatus}</p>
        {errorText && <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{errorText}</p>}

        {screen === "AUTH" && (
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-lg font-semibold">Who are you?</h2>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter nickname"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={authenticate}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
            >
              Continue
            </button>
          </div>
        )}

        {screen !== "AUTH" && screen !== "IN_GAME" && (
          <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm text-zinc-400">Connected as {nickname || nakama.session?.username || "Player"}.</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedMode("CLASSIC")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  selectedMode === "CLASSIC" ? "bg-indigo-600 text-white" : "border border-zinc-700 text-zinc-300"
                }`}
              >
                Classic
              </button>
              <button
                type="button"
                onClick={() => setSelectedMode("TIMED")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  selectedMode === "TIMED" ? "bg-indigo-600 text-white" : "border border-zinc-700 text-zinc-300"
                }`}
              >
                Timed (30s)
              </button>
            </div>
            <button
              type="button"
              onClick={findMatch}
              disabled={!nakama.isConnected || screen === "FINDING_MATCH"}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {screen === "FINDING_MATCH" ? "Finding a random player..." : "Find Match"}
            </button>
            <Leaderboard rows={leaderboardRows} isLoading={isLeaderboardLoading} onRefresh={refreshLeaderboard} />
          </div>
        )}

        {screen === "IN_GAME" && (
          <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between text-sm text-zinc-300">
              <span>You: {me?.symbol ?? "-"}</span>
              <span>{opponent ? `Opponent: ${opponent.username} (${opponent.symbol})` : "Waiting opponent..."}</span>
            </div>

            <div className="flex justify-center">
              <Board
                board={snapshot.board}
                canPlay={Boolean(isMyTurn && !isGameFinished)}
                winningLine={snapshot.winningLine}
                showTimer={snapshot.matchMode === "TIMED" && snapshot.status === "IN_PROGRESS"}
                turnSecondsLeft={turnSecondsLeft}
                onCellClick={sendMove}
              />
            </div>

            {isGameFinished && (
              <button
                type="button"
                onClick={playAgain}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
              >
                Play Again
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
