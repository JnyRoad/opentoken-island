const LEADERBOARD_ENTRY_LIMIT = 200;
const LEADERBOARD_RANK_ONLY_LIMIT = 1;
const LEADERBOARD_ENDPOINT = "https://scys.com/tokenrank/api/subapp/leaderboard";

function leaderboardLimit(limit) {
  const requestedLimit = Number(limit || LEADERBOARD_ENTRY_LIMIT);
  return Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : LEADERBOARD_ENTRY_LIMIT;
}

function buildLeaderboardEndpoint(userId = "", { limit = LEADERBOARD_ENTRY_LIMIT } = {}) {
  const endpoint = new URL(process.env.OPENTOKEN_LEADERBOARD_URL || LEADERBOARD_ENDPOINT);
  endpoint.searchParams.set("board", "total");
  endpoint.searchParams.set("range", "today");
  endpoint.searchParams.set("limit", String(leaderboardLimit(limit)));

  const confirmedUserId = String(userId || "").trim();
  if (confirmedUserId) endpoint.searchParams.set("me", confirmedUserId);

  return endpoint.toString();
}

module.exports = { buildLeaderboardEndpoint, LEADERBOARD_ENTRY_LIMIT, LEADERBOARD_RANK_ONLY_LIMIT };
