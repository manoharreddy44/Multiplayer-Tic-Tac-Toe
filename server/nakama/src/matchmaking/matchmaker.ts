export function onMatchmakerMatched(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  entries: nkruntime.MatchmakerResult[]
): string {
  const userIds = entries.map((entry) => entry.presence.userId);
  logger.info("Matchmaker paired players=%v", userIds);

  return nk.matchCreate("tic_tac_toe_match", {
    matchedUserIds: userIds
  });
}
