import { onMatchmakerMatched } from "./matchmaking/matchmaker";
import { ticTacToeMatch } from "./matches/ticTacToeMatch";

function InitModule(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void {
  initializer.registerMatch("tic_tac_toe_match", ticTacToeMatch);
  initializer.registerMatchmakerMatched(onMatchmakerMatched);
  logger.info("Tic-Tac-Toe Nakama module loaded.");
}

export { InitModule };
