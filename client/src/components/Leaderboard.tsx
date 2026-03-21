export interface LeaderboardRow {
  rank: number;
  username: string;
  score: number;
}

interface LeaderboardProps {
  rows: LeaderboardRow[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function Leaderboard({ rows, isLoading, onRefresh }: LeaderboardProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Global Top 10 (Wins)</h3>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>
      <div className="space-y-1 text-sm">
        {rows.length === 0 && !isLoading && <p className="text-zinc-500">No leaderboard records yet.</p>}
        {rows.map((row) => (
          <div key={`${row.rank}-${row.username}`} className="flex items-center justify-between rounded-md bg-zinc-800 px-3 py-2">
            <span className="text-zinc-200">#{row.rank} {row.username}</span>
            <span className="font-semibold text-emerald-300">{row.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
