const test = require("node:test");
const assert = require("node:assert/strict");

const { buildLeaderboardEndpoint, LEADERBOARD_ENTRY_LIMIT } = require("../../lib/leaderboard-endpoint");

test("buildLeaderboardEndpoint fetches the top 100 leaderboard entries", () => {
  const endpoint = new URL(buildLeaderboardEndpoint(""));

  assert.equal(endpoint.origin, "https://scys.com");
  assert.equal(endpoint.pathname, "/tokenrank/api/subapp/leaderboard");
  assert.equal(endpoint.searchParams.get("board"), "total");
  assert.equal(endpoint.searchParams.get("range"), "today");
  assert.equal(endpoint.searchParams.get("limit"), String(LEADERBOARD_ENTRY_LIMIT));
  assert.equal(LEADERBOARD_ENTRY_LIMIT, 100);
  assert.equal(endpoint.searchParams.has("me"), false);
});

test("buildLeaderboardEndpoint includes me when a confirmed user id is known", () => {
  const endpoint = new URL(buildLeaderboardEndpoint("6466517"));

  assert.equal(endpoint.searchParams.get("me"), "6466517");
  assert.equal(endpoint.searchParams.get("limit"), "100");
});
