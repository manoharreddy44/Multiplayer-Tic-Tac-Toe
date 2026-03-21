declare namespace nkruntime {
  interface Context {}

  interface Logger {
    info(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  }

  interface Presence {
    userId: string;
    username: string;
    sessionId: string;
    node: string;
  }

  interface MatchmakerResult {
    presence: Presence;
    properties?: Record<string, unknown>;
    stringProperties?: Record<string, string>;
    numericProperties?: Record<string, number>;
  }

  interface MatchMessage {
    opCode: number;
    sender: Presence;
    data: string | Uint8Array;
  }

  interface MatchDispatcher {
    broadcastMessage(opCode: number, data: string, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
  }

  interface Nakama {
    matchCreate(module: string, params?: Record<string, unknown>): string;
    binaryToString(data: Uint8Array): string;
    storageRead(objects: Array<{ collection: string; key: string; userId: string }>): Array<{ value: unknown }>;
    storageWrite(
      objects: Array<{
        collection: string;
        key: string;
        userId: string;
        value: unknown;
        permissionRead?: number;
        permissionWrite?: number;
      }>
    ): void;
    leaderboardCreate(
      id: string,
      authoritative: boolean,
      sortOrder: "asc" | "desc",
      operator: "best" | "set" | "incr" | "decr",
      resetSchedule?: string | null,
      metadata?: Record<string, unknown>,
      enableRanks?: boolean
    ): void;
    leaderboardRecordWrite(
      leaderboardId: string,
      ownerId: string,
      username?: string,
      score?: number,
      subscore?: number,
      metadata?: Record<string, unknown>
    ): void;
  }

  interface MatchInitResult<TState> {
    state: TState;
    tickRate: number;
    label: string;
  }

  interface MatchJoinAttemptResult<TState> {
    state: TState;
    accept: boolean;
    rejectMessage?: string;
  }

  interface MatchStateResult<TState> {
    state: TState;
  }

  interface MatchSignalResult<TState> {
    state: TState;
    data: string;
  }

  interface MatchHandler<TState> {
    matchInit(ctx: Context, logger: Logger, nk: Nakama, params: Record<string, unknown>): MatchInitResult<TState>;
    matchJoinAttempt(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      presence: Presence,
      metadata: Record<string, unknown>
    ): MatchJoinAttemptResult<TState>;
    matchJoin(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: TState, presences: Presence[]): MatchStateResult<TState>;
    matchLeave(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: TState, presences: Presence[]): MatchStateResult<TState>;
    matchLoop(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      messages: MatchMessage[]
    ): MatchStateResult<TState> | null;
    matchTerminate(
      ctx: Context,
      logger: Logger,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      graceSeconds: number
    ): MatchStateResult<TState>;
    matchSignal(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      data: string
    ): MatchSignalResult<TState>;
  }

  interface Initializer {
    registerMatch<TState>(name: string, handler: MatchHandler<TState>): void;
    registerMatchmakerMatched(handler: (ctx: Context, logger: Logger, nk: Nakama, entries: MatchmakerResult[]) => string): void;
  }
}
