type CellValue = "X" | "O" | "";

interface BoardProps {
  board: CellValue[];
  canPlay: boolean;
  winningLine: number[] | null;
  showTimer: boolean;
  turnSecondsLeft: number | null;
  onCellClick: (index: number) => void;
}

export function Board({ board, canPlay, winningLine, showTimer, turnSecondsLeft, onCellClick }: BoardProps) {
  return (
    <div className="space-y-3">
      {showTimer && (
        <p className="text-center text-sm font-medium text-amber-300">
          Turn timer: {Math.max(turnSecondsLeft ?? 0, 0)}s
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-zinc-900 p-3 shadow-xl">
        {board.map((value, index) => {
          const isWinningCell = Boolean(winningLine?.includes(index));
          return (
            <button
              key={index}
              type="button"
              disabled={!canPlay || value !== ""}
              onClick={() => onCellClick(index)}
              className={[
                "flex h-24 w-24 items-center justify-center rounded-xl border text-3xl font-bold transition",
                "sm:h-28 sm:w-28",
                value === "" ? "text-zinc-500" : "text-zinc-100",
                isWinningCell ? "border-emerald-400 bg-emerald-900/40" : "border-zinc-700 bg-zinc-800",
                !canPlay || value !== "" ? "cursor-not-allowed opacity-70" : "hover:border-indigo-400 hover:bg-zinc-700"
              ].join(" ")}
            >
              {value || "·"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
