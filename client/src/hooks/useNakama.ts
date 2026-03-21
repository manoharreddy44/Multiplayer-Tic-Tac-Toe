import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client, LeaderboardRecord, Session, Socket } from "@heroiclabs/nakama-js";

type MatchmakerMatchedHandler = (matchId: string) => void;
type MatchDataHandler = (opCode: number, data: string) => void;
type PresenceEventHandler = () => void;
type QueueMode = "CLASSIC" | "TIMED";

const DEFAULT_SERVER_KEY = import.meta.env.VITE_NAKAMA_SERVER_KEY ?? "devkey";
const DEFAULT_HOST = import.meta.env.VITE_NAKAMA_HOST ?? "127.0.0.1";
const DEFAULT_PORT = import.meta.env.VITE_NAKAMA_PORT ?? "7350";
const DEFAULT_USE_SSL = (import.meta.env.VITE_NAKAMA_USE_SSL ?? "false") === "true";

interface UseNakamaResult {
  client: Client | null;
  session: Session | null;
  socket: Socket | null;
  isConnected: boolean;
  connectAndAuthenticate: (nickname: string) => Promise<Session>;
  addToMatchmaker: (mode: QueueMode, nickname: string) => Promise<string>;
  listWinsLeaderboard: (sessionOverride?: Session) => Promise<LeaderboardRecord[]>;
  disconnect: () => void;
  onMatchmakerMatched: (handler: MatchmakerMatchedHandler | null) => void;
  onMatchData: (handler: MatchDataHandler | null) => void;
  onDisconnected: (handler: PresenceEventHandler | null) => void;
}

export function useNakama(): UseNakamaResult {
  const [client] = useState(() => new Client(DEFAULT_SERVER_KEY, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USE_SSL));
  const [session, setSession] = useState<Session | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const onMatchmakerMatchedRef = useRef<MatchmakerMatchedHandler | null>(null);
  const onMatchDataRef = useRef<MatchDataHandler | null>(null);
  const onDisconnectedRef = useRef<PresenceEventHandler | null>(null);

  const wireSocketHandlers = useCallback((s: Socket) => {
    s.onmatchmakermatched = (matched: { match_id: string }) => {
      onMatchmakerMatchedRef.current?.(matched.match_id);
    };

    s.onmatchdata = (message: { op_code: number; data: Uint8Array | string }) => {
      const payload =
        typeof message.data === "string" ? message.data : new TextDecoder().decode(message.data);
      onMatchDataRef.current?.(message.op_code, payload);
    };

    s.ondisconnect = () => {
      setIsConnected(false);
      onDisconnectedRef.current?.();
    };
  }, []);

  const connectAndAuthenticate = useCallback(
    async (nickname: string): Promise<Session> => {
      const trimmedNickname = nickname.trim();
      if (!trimmedNickname) {
        throw new Error("Nickname is required.");
      }

      const customId = `player-${trimmedNickname.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
      // Avoid username uniqueness conflicts (HTTP 409) by authenticating with custom ID only.
      const newSession = await client.authenticateCustom(customId, true);
      const newSocket = client.createSocket(DEFAULT_USE_SSL, false);

      wireSocketHandlers(newSocket);
      await newSocket.connect(newSession, true);

      setSession(newSession);
      setSocket(newSocket);
      setIsConnected(true);
      return newSession;
    },
    [client, wireSocketHandlers]
  );

  const addToMatchmaker = useCallback(
    async (mode: QueueMode, nickname: string) => {
      if (!socket) {
        throw new Error("Socket is not connected.");
      }
      const trimmedNickname = nickname.trim();
      if (!trimmedNickname) {
        throw new Error("Nickname is required to join matchmaking.");
      }
      const isTimed = mode === "TIMED";
      const modeQuery = isTimed ? "+properties.timed:1" : "+properties.timed:0";
      const result = await socket.addMatchmaker(
        modeQuery,
        2,
        2,
        { mode: mode.toLowerCase(), nickname: trimmedNickname },
        { timed: isTimed ? 1 : 0 }
      );
      return result.ticket;
    },
    [socket]
  );

  const listWinsLeaderboard = useCallback(async (sessionOverride?: Session): Promise<LeaderboardRecord[]> => {
    const activeSession = sessionOverride ?? session;
    if (!activeSession) {
      throw new Error("Session not found.");
    }
    const response = await client.listLeaderboardRecords(activeSession, "ttt_wins", undefined, 10);
    return response.records ?? [];
  }, [client, session]);

  const disconnect = useCallback(() => {
    if (socket) {
      socket.disconnect(true);
    }
    setSocket(null);
    setSession(null);
    setIsConnected(false);
  }, [socket]);

  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect(true);
      }
    };
  }, [socket]);

  return useMemo(
    () => ({
      client,
      session,
      socket,
      isConnected,
      connectAndAuthenticate,
      addToMatchmaker,
      listWinsLeaderboard,
      disconnect,
      onMatchmakerMatched: (handler) => {
        onMatchmakerMatchedRef.current = handler;
      },
      onMatchData: (handler) => {
        onMatchDataRef.current = handler;
      },
      onDisconnected: (handler) => {
        onDisconnectedRef.current = handler;
      }
    }),
    [addToMatchmaker, client, connectAndAuthenticate, disconnect, isConnected, listWinsLeaderboard, session, socket]
  );
}
