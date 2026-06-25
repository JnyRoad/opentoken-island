const LEADERBOARD_ENTRY_LIMIT = 200;
const LEADERBOARD_ENDPOINT = "https://scys.com/tokenrank/api/subapp/leaderboard";

function buildLeaderboardEndpoint(userId = "") {
  const endpoint = new URL(process.env.OPENTOKEN_LEADERBOARD_URL || LEADERBOARD_ENDPOINT);
  endpoint.searchParams.set("board", "total");
  endpoint.searchParams.set("range", "today");
  endpoint.searchParams.set("limit", String(LEADERBOARD_ENTRY_LIMIT));

  const confirmedUserId = String(userId || "").trim();
  if (confirmedUserId) endpoint.searchParams.set("me", confirmedUserId);

  return endpoint.toString();
}

module.exports = { buildLeaderboardEndpoint, LEADERBOARD_ENTRY_LIMIT };
