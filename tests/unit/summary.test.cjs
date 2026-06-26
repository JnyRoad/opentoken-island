const test = require("node:test");
const assert = require("assert");
const {
  rowsFromPayload, rawTokens, summarizeRows, toolsFromMap,
  sameToolBreakdown, findOwnEntry, computeLeaderboard, buildSummary,
} = require("../../lib/summary");

test("rowsFromPayload handles array/rows/records/garbage", () => {
  assert.deepEqual(rowsFromPayload([1, 2]), [1, 2]);
  assert.deepEqual(rowsFromPayload({ rows: [3] }), [3]);
  assert.deepEqual(rowsFromPayload({ records: [4] }), [4]);
  assert.deepEqual(rowsFromPayload(null), []);
  assert.deepEqual(rowsFromPayload({ nope: 1 }), []);
});

test("rawTokens sums the four token fields", () => {
  assert.equal(rawTokens({ input: 1, output: 2, cache_read: 3, cache_write: 4 }), 10);
  assert.equal(rawTokens({ input: 5 }), 5);
});

test("summarizeRows picks latest date by default and aggregates byTool", () => {
  const rows = [
    { date: "2026-06-22", tool: "codex", input: 100, normalized: 10 },
    { date: "2026-06-23", tool: "codex", input: 200, normalized: 20 },
    { date: "2026-06-23", tool: "claude-code", output: 50, normalized: 5 },
  ];
  const s = summarizeRows(rows);
  assert.equal(s.date, "2026-06-23");
  assert.equal(s.byTool.codex, 200);
  assert.equal(s.byTool["claude-code"], 50);
  assert.equal(s.normalizedByTool.codex, 20);
  assert.equal(s.normalizedByTool["claude-code"], 5);
  assert.equal(s.total, 250);
  assert.equal(s.normalized, 25);
  assert.equal(s.rowCount, 2);
});

test("summarizeRows honors preferredDate when present", () => {
  const rows = [
    { date: "2026-06-22", tool: "codex", input: 100 },
    { date: "2026-06-23", tool: "codex", input: 200 },
  ];
  assert.equal(summarizeRows(rows, "2026-06-22").date, "2026-06-22");
});

test("toolsFromMap uses exact total share percentage and floors only bar width", () => {
  const map = { a: 100, b: 50, c: 25, d: 12, e: 6, f: 3, g: 1 };
  const tools = toolsFromMap(map);
  assert.equal(tools.length, 6);
  assert.equal(tools[0].pct, 51);
  assert.equal(tools[0].barPct, 51);
  assert.equal(tools[1].pct, 25);
  assert.equal(tools[5].pct, 2);
  assert.equal(tools[5].barPct, 4);
});

test("findOwnEntry prefers userId among entries that match the current score and tools", () => {
  const entries = [
    { userId: "u1", rank: 1, score: 100, byTool: { codex: 100 } },
    { userId: "u2", rank: 2, score: 200, byTool: { codex: 200 } },
  ];
  assert.equal(findOwnEntry(entries, { total: 200, byTool: { codex: 200 } }, "u2").userId, "u2");
  assert.equal(findOwnEntry(entries, { total: 999, byTool: {} }, "u2"), null);
  const byShape = findOwnEntry(entries, { total: 100, byTool: { codex: 100 } }, "");
  assert.equal(byShape.userId, "u1");
});

test("findOwnEntry matches leaderboard raw score and tool breakdown", () => {
  const entries = [
    { userId: "u1", rank: 1, score: 100, byTool: { codex: 90, "claude-code": 10 } },
    { userId: "u2", rank: 2, score: 938_786_946, byTool: { codex: 601_085_857, "claude-code": 337_701_089 } },
  ];
  const own = findOwnEntry(entries, {
    total: 938_786_946,
    normalized: 40_284_724,
    byTool: { codex: 601_085_857, "claude-code": 337_701_089 },
    normalizedByTool: { codex: 32_482_095, "claude-code": 7_802_629 },
  }, "");
  assert.equal(own.userId, "u2");
});

test("findOwnEntry matches the public leaderboard raw token score, not normalized score", () => {
  const entries = [
    {
      userId: "6466517",
      rank: 1,
      score: 373_124_040,
      byTool: { codex: 334_160_936, "claude-code": 38_963_104 },
    },
  ];
  const own = findOwnEntry(entries, {
    total: 373_124_040,
    normalized: 13_168_274,
    byTool: { codex: 334_160_936, "claude-code": 38_963_104 },
    normalizedByTool: { codex: 11_725_147, "claude-code": 1_443_127 },
  }, "");
  assert.equal(own.userId, "6466517");
});

test("computeLeaderboard derives rank neighbors, gap and lead", () => {
  const entries = [
    { userId: "a", rank: 1, score: 300, name: "A" },
    { userId: "me", rank: 2, score: 200, name: "Me" },
    { userId: "c", rank: 3, score: 100, name: "C" },
  ];
  const board = computeLeaderboard(entries, { total: 200, byTool: {} }, 4, "me");
  assert.equal(board.own.userId, "me");
  assert.equal(board.previous.userId, "a");
  assert.equal(board.next.userId, "c");
  assert.equal(board.gapToPrevious, 300 - 200 + 1);
  assert.equal(board.leadOverNext, 200 - 100);
  assert.equal(board.rankDelta, 4 - 2);
});

test("computeLeaderboard estimates rank from raw token score when own is not found", () => {
  const entries = [
    { userId: "a", rank: 1, score: 300, name: "A" },
    { userId: "b", rank: 2, score: 100, name: "B" },
  ];
  const board = computeLeaderboard(entries, { total: 200, normalized: 9999, byTool: { codex: 200 } }, null, "nobody");
  assert.equal(board.estimated, true);
  assert.equal(board.own.estimated, true);
  assert.equal(board.own.rank, 2);
  assert.equal(board.previous.userId, "a");
  assert.equal(board.next.userId, "b");
  assert.equal(board.gapToPrevious, 101);
  assert.equal(board.leadOverNext, 100);
});

test("computeLeaderboard confirms rank 1 when public leaderboard score equals raw total", () => {
  const entries = [
    {
      userId: "6466517",
      rank: 1,
      score: 373_124_040,
      name: "旅途",
      byTool: { codex: 334_160_936, "claude-code": 38_963_104 },
    },
    { userId: "7183445", rank: 2, score: 154_809_210, name: "早早" },
  ];
  const board = computeLeaderboard(entries, {
    total: 373_124_040,
    normalized: 13_168_274,
    byTool: { codex: 334_160_936, "claude-code": 38_963_104 },
    normalizedByTool: { codex: 11_725_147, "claude-code": 1_443_127 },
  }, null, "");
  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 1);
  assert.equal(board.own.score, 373_124_040);
  assert.equal(board.next.userId, "7183445");
});

test("computeLeaderboard confirms rank from validated myRank when own entry is outside entries", () => {
  const entries = [
    { userId: "above", rank: 5, score: 500, name: "Above", byTool: { codex: 500 } },
    { userId: "below", rank: 7, score: 400, name: "Below", byTool: { codex: 400 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 450,
    byTool: { codex: 450 },
  }, null, "6466517", {
    myRank: { rank: 6, score: 450 },
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.userId, "6466517");
  assert.equal(board.own.rank, 6);
  assert.equal(board.own.score, 450);
  assert.equal(board.own.estimated, undefined);
  assert.equal(board.previous.userId, "above");
  assert.equal(board.next.userId, "below");
});

test("computeLeaderboard can trust a higher myRank score when the caller opts in", () => {
  const board = computeLeaderboard([], {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    myRank: { rank: 250, score: 120 },
    allowHigherMyRankScore: true,
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.userId, "6466517");
  assert.equal(board.own.rank, 250);
  assert.equal(board.own.score, 120);
  assert.equal(board.previous, null);
  assert.equal(board.next, null);
});

test("computeLeaderboard can trust a higher userId-matched leaderboard entry when the caller opts in", () => {
  const entries = [
    { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
    { userId: "6466517", rank: 95, score: 120, byTool: { codex: 100, "claude-code": 20 } },
    { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    allowHigherUserIdScore: true,
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 95);
  assert.equal(board.own.score, 120);
  assert.equal(board.previous.rank, 94);
  assert.equal(board.next.rank, 96);
});

test("computeLeaderboard rejects non-finite myRank scores", () => {
  const board = computeLeaderboard([], {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    myRank: { rank: 95, score: Infinity },
    allowHigherMyRankScore: true,
  });

  assert.equal(board, null);
});

test("computeLeaderboard rejects non-finite ranks in user-matched entries", () => {
  const board = computeLeaderboard([
    { userId: "6466517", rank: "Infinity", score: 120, byTool: { codex: 120 } },
  ], {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    allowHigherUserIdScore: true,
  });

  assert.equal(board, null);
});

test("computeLeaderboard rejects non-finite scores in estimated entries", () => {
  const board = computeLeaderboard([
    { userId: "bad", rank: 1, score: "Infinity", byTool: { codex: 999 } },
  ], {
    total: 100,
    byTool: { codex: 100 },
  }, null, "");

  assert.equal(board, null);
});

test("computeLeaderboard rejects non-finite summary totals", () => {
  const board = computeLeaderboard([
    { userId: "leader", rank: 1, score: 300, byTool: { codex: 300 } },
    { userId: "next", rank: 2, score: 100, byTool: { codex: 100 } },
  ], {
    total: Infinity,
    byTool: { codex: Infinity },
  }, null, "");

  assert.equal(board, null);
});

test("computeLeaderboard rejects matched entries without ranks", () => {
  const board = computeLeaderboard([
    { userId: "6466517", score: 120, byTool: { codex: 120 } },
  ], {
    total: 120,
    byTool: { codex: 120 },
  }, null, "6466517", {
    allowHigherUserIdScore: true,
  });

  assert.equal(board, null);
});

test("computeLeaderboard ignores non-finite scores in rank neighbors", () => {
  const board = computeLeaderboard([
    { userId: "previous", rank: 1, score: "Infinity", byTool: { codex: 999 } },
    { userId: "6466517", rank: 2, score: 120, byTool: { codex: 120 } },
    { userId: "next", rank: 3, score: "NaN", byTool: { codex: 1 } },
  ], {
    total: 120,
    byTool: { codex: 120 },
  }, null, "6466517");

  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 2);
  assert.equal(board.previous, null);
  assert.equal(board.next, null);
  assert.equal(board.gapToPrevious, null);
  assert.equal(board.leadOverNext, null);
});

test("computeLeaderboard does not treat non-adjacent entries as rank neighbors", () => {
  const entries = [
    { userId: "leader", rank: 1, score: 1000, name: "Leader", byTool: { codex: 1000 } },
    { userId: "6466517", rank: 114, score: 100, name: "You", byTool: { codex: 100 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    myRank: { rank: 114, score: 100 },
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 114);
  assert.equal(board.previous, null);
  assert.equal(board.next, null);
  assert.equal(board.gapToPrevious, null);
  assert.equal(board.leadOverNext, null);
});

test("computeLeaderboard derives neighbors for myRank after the first 100 entries", () => {
  const entries = Array.from({ length: 200 }, (_, index) => ({
    userId: `u${index + 1}`,
    rank: index + 1,
    score: 300_000_000 - index * 1_000_000,
    name: `User ${index + 1}`,
  }));
  const board = computeLeaderboard(entries, {
    total: 187_000_000,
    byTool: { codex: 187_000_000 },
  }, null, "6466517", {
    limit: 200,
    myRank: { rank: 114, score: 187_000_000 },
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 114);
  assert.equal(board.previous.rank, 113);
  assert.equal(board.next.rank, 115);
  assert.equal(board.gapToPrevious, 1_000_001);
  assert.equal(board.leadOverNext, 1_000_000);
});

test("computeLeaderboard prefers validated myRank over same-score entry with another user id", () => {
  const entries = [
    { userId: "collision", rank: 8, score: 450, name: "Collision", byTool: { codex: 450 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 450,
    byTool: { codex: 450 },
  }, null, "6466517", {
    limit: 100,
    myRank: { rank: 250, score: 450 },
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.userId, "6466517");
  assert.equal(board.own.rank, 250);
  assert.equal(board.next, null);
});

test("computeLeaderboard ignores stale myRank when its score differs from the upload summary", () => {
  const board = computeLeaderboard([], {
    total: 450,
    byTool: { codex: 450 },
  }, null, "6466517", {
    myRank: { rank: 6, score: 449 },
  });

  assert.equal(board, null);
});

test("computeLeaderboard does not borrow top entry as next when myRank is outside fetched entries", () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    userId: `u${index + 1}`,
    rank: index + 1,
    score: 1000 - index,
    name: `User ${index + 1}`,
  }));
  const board = computeLeaderboard(entries, {
    total: 100,
    byTool: { codex: 100 },
  }, null, "6466517", {
    limit: 100,
    myRank: { rank: 250, score: 100 },
  });

  assert.equal(board.estimated, false);
  assert.equal(board.own.rank, 250);
  assert.equal(board.previous, null);
  assert.equal(board.next, null);
  assert.equal(board.gapToPrevious, null);
  assert.equal(board.leadOverNext, null);
});

test("computeLeaderboard does not confirm a stale cached user id when score changed", () => {
  const entries = [
    { userId: "me", rank: 4, score: 100, name: "Me", byTool: { codex: 100 } },
    { userId: "a", rank: 1, score: 300, name: "A", byTool: { codex: 300 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 200,
    normalized: 9999,
    byTool: { codex: 200 },
  }, null, "me");
  assert.equal(board.estimated, true);
  assert.equal(board.own.estimated, true);
  assert.equal(board.own.score, 200);
  assert.notEqual(board.own.userId, "me");
});

test("computeLeaderboard does not estimate a rank from an empty leaderboard", () => {
  const board = computeLeaderboard([], {
    total: 200,
    normalized: 9999,
    byTool: { codex: 200 },
  }, null, "nobody");
  assert.equal(board, null);
});

test("computeLeaderboard does not estimate a precise rank beyond a truncated leaderboard", () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    userId: `u${index + 1}`,
    rank: index + 1,
    score: 1000 - index,
    name: `User ${index + 1}`,
    byTool: { codex: 1000 - index },
  }));
  const board = computeLeaderboard(entries, {
    total: 100,
    normalized: 100,
    normalizedByTool: { codex: 100 },
  }, null, "", { limit: 100 });
  assert.equal(board, null);
});

test("computeLeaderboard rank 1 has no previous and zero gap", () => {
  const entries = [
    { userId: "me", rank: 1, score: 300, name: "Me" },
    { userId: "b", rank: 2, score: 100, name: "B" },
  ];
  const board = computeLeaderboard(entries, { total: 300, byTool: {} }, 1, "me");
  assert.equal(board.previous, null);
  assert.equal(board.gapToPrevious, 0);
  assert.equal(board.leadOverNext, 200);
});

test("summarizeRows on empty rows yields zeros and empty date", () => {
  const s = summarizeRows([]);
  assert.equal(s.date, "");
  assert.equal(s.total, 0);
  assert.equal(s.rowCount, 0);
  assert.deepEqual(s.byTool, {});
  assert.deepEqual(s.normalizedByTool, {});
});

test("toolsFromMap on empty map returns []", () => {
  assert.deepEqual(toolsFromMap({}), []);
  assert.deepEqual(toolsFromMap(null), []);
});

test("buildSummary uses upload source when no leaderboard own", () => {
  const s = buildSummary({
    lastUpload: { summary: { date: "2026-06-23", total: 50, normalized: 10, byTool: { codex: 50 }, normalizedByTool: { codex: 10 } }, capturedAt: "c" },
    leaderboard: null,
  });
  assert.equal(s.source, "upload");
  assert.equal(s.waiting, false);
  assert.equal(s.total, 50);
  assert.equal(s.rank, null);
  assert.equal(s.totalLabel, "50");
});

test("buildSummary marks locally estimated leaderboard ranks", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-23",
        total: 938_786_946,
        normalized: 40_284_724,
        byTool: { codex: 601_085_857, "claude-code": 337_701_089 },
        normalizedByTool: { codex: 32_482_095, "claude-code": 7_802_629 },
      },
      upstream: { json: { accepted: 1 }, status: 200 },
    },
    leaderboard: {
      uploadId: "upload-1",
      updatedAt: "2026-06-23T12:00:01.000Z",
      estimated: true,
      own: {
        rank: 1,
        score: 938_786_946,
        byTool: { codex: 601_085_857, "claude-code": 337_701_089 },
        estimated: true,
      },
      previous: null,
      next: { rank: 2, name: "Alice", score: 300_000_000 },
      gapToPrevious: 0,
      leadOverNext: 638_786_946,
      rankDelta: 0,
    },
  });
  assert.equal(s.source, "leaderboard-estimate");
  assert.equal(s.rankEstimated, true);
  assert.equal(s.rankLabel, "#1");
  assert.equal(s.total, 938_786_946);
  assert.equal(s.leaderboardScore, 938_786_946);
  assert.match(s.game.quests[0].title, /预计/);
});

test("buildSummary ignores leaderboard snapshots from a previous upload", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "new-upload",
      capturedAt: "2026-06-23T12:00:00.000Z",
      summary: {
        date: "2026-06-23",
        total: 200,
        normalized: 200,
        byTool: { codex: 200 },
        normalizedByTool: { codex: 200 },
      },
    },
    leaderboard: {
      uploadId: "old-upload",
      updatedAt: "2026-06-23T11:59:00.000Z",
      own: { userId: "me", rank: 1, score: 100, byTool: { codex: 100 } },
      gapToPrevious: 0,
      leadOverNext: 50,
      rankDelta: 0,
    },
  });
  assert.equal(s.source, "upload");
  assert.equal(s.rank, null);
  assert.equal(s.rankEstimated, false);
  assert.equal(s.total, 200);
});

test("buildSummary waiting state when no upload", () => {
  const s = buildSummary({ lastUpload: null, leaderboard: null });
  assert.equal(s.waiting, true);
  assert.equal(s.source, "waiting");
  assert.equal(s.totalLabel, "--");
});

test("buildSummary uses leaderboard source when own present", () => {
  const s = buildSummary({
    lastUpload: { uploadId: "upload-1", summary: { date: "2026-06-23", total: 200, byTool: { codex: 200 } }, upstream: { json: { accepted: 1 }, status: 200 } },
    leaderboard: { uploadId: "upload-1", own: { rank: 2, score: 200, byTool: { codex: 200 } }, gapToPrevious: 5, leadOverNext: 10, rankDelta: 1, updatedAt: "t" },
  });
  assert.equal(s.source, "leaderboard");
  assert.equal(s.rank, 2);
  assert.equal(s.rankDeltaLabel, "+1");
  assert.equal(s.total, 200);
  assert.equal(s.upstream.accepted, 1);
});

test("buildSummary uses leaderboard raw score and tool breakdown when platform data is richer", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-26",
        total: 257_246_635,
        normalized: 16_287_019,
        byTool: { codex: 257_246_635 },
      },
      upstream: { json: { accepted: 1 }, status: 200 },
    },
    leaderboard: {
      uploadId: "upload-1",
      updatedAt: "2026-06-26T03:21:36.492Z",
      own: {
        rank: 27,
        score: 258_675_610,
        byTool: {
          codex: 251_406_752,
          "claude-code": 7_268_858,
        },
      },
      gapToPrevious: 5_032_602,
      leadOverNext: 7_712_300,
      rankDelta: 0,
    },
  });

  assert.equal(s.source, "leaderboard");
  assert.equal(s.total, 258_675_610);
  assert.equal(s.leaderboardScore, 258_675_610);
  assert.deepEqual(s.tools.map((tool) => [tool.name, tool.value]), [
    ["codex", 251_406_752],
    ["claude-code", 7_268_858],
  ]);
  assert.deepEqual(s.tools.map((tool) => [tool.name, tool.pct]), [
    ["codex", 97],
    ["claude-code", 3],
  ]);
  assert.deepEqual(s.tools.map((tool) => [tool.name, tool.barPct]), [
    ["codex", 97],
    ["claude-code", 4],
  ]);
  assert.equal(s.game.mainTool.shareLabel, "97%");
  assert.equal(s.game.badges.find((badge) => badge.title === "主力工具").detail, "Codex 97%");
});

test("buildSummary ignores invalid leaderboard own values and falls back to upload summary", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-26",
        total: 100,
        normalized: 10,
        byTool: { codex: 100 },
      },
    },
    leaderboard: {
      uploadId: "upload-1",
      own: {
        rank: 2,
        score: "Infinity",
        byTool: null,
        estimated: true,
      },
      estimated: true,
      gapToPrevious: 1,
      leadOverNext: 1,
      rankDelta: 7,
    },
  });

  assert.equal(s.source, "upload");
  assert.equal(s.total, 100);
  assert.equal(s.leaderboardScore, 10);
  assert.equal(s.rank, null);
  assert.equal(s.rankEstimated, false);
  assert.equal(s.rankDelta, null);
  assert.equal(s.rankDeltaLabel, "--");
  assert.equal(s.gapToPrevious, null);
  assert.equal(s.leadOverNext, null);
  assert.equal(s.report.title, "等待排名");
  assert.equal(s.report.metric, "#--");
  assert.deepEqual(s.tools.map((tool) => [tool.name, tool.value, tool.pct]), [
    ["codex", 100, 100],
  ]);
});

test("buildSummary rejects leaderboard own entries with invalid rank", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-26",
        total: 100,
        normalized: 10,
        byTool: { codex: 100 },
      },
    },
    leaderboard: {
      uploadId: "upload-1",
      own: {
        rank: "Infinity",
        score: 120,
        byTool: { codex: 120 },
      },
      gapToPrevious: 1,
      leadOverNext: 1,
      rankDelta: 7,
    },
  });

  assert.equal(s.source, "upload");
  assert.equal(s.total, 100);
  assert.equal(s.rank, null);
  assert.equal(s.rankLabel, "#--");
  assert.equal(s.report.metric, "#--");
});

test("buildSummary clamps invalid leaderboard delta and gaps instead of leaking Infinity", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-26",
        total: 100,
        normalized: 10,
        byTool: { codex: 100 },
      },
    },
    leaderboard: {
      uploadId: "upload-1",
      own: {
        rank: 2,
        score: 120,
        byTool: { codex: 120 },
      },
      gapToPrevious: "Infinity",
      leadOverNext: "NaN",
      rankDelta: "Infinity",
    },
  });

  assert.equal(s.source, "leaderboard");
  assert.equal(s.rank, 2);
  assert.equal(s.total, 120);
  assert.equal(s.rankDelta, null);
  assert.equal(s.rankDeltaLabel, "--");
  assert.equal(s.gapToPrevious, null);
  assert.equal(s.leadOverNext, null);
  assert.doesNotMatch(s.report.title, /Infinity/);
  assert.doesNotMatch(s.report.copy, /Infinity/);
});

test("buildSummary does not pass neighbors with invalid metrics into game quests", () => {
  const chasing = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: {
        date: "2026-06-26",
        total: 100,
        byTool: { codex: 100 },
      },
    },
    leaderboard: {
      uploadId: "upload-1",
      own: {
        rank: 2,
        score: 120,
        byTool: { codex: 120 },
      },
      previous: { rank: 1, name: "Alice", score: 200 },
      gapToPrevious: "Infinity",
      leadOverNext: 10,
      rankDelta: 0,
    },
  });

  assert.equal(chasing.game.quests[0].detail, "等待榜单排名");
  assert.doesNotMatch(chasing.game.quests[0].detail, /Alice|0/);

  const king = buildSummary({
    lastUpload: {
      uploadId: "upload-2",
      summary: {
        date: "2026-06-26",
        total: 200,
        byTool: { codex: 200 },
      },
    },
    leaderboard: {
      uploadId: "upload-2",
      own: {
        rank: 1,
        score: 200,
        byTool: { codex: 200 },
      },
      next: { rank: 2, name: "Bob", score: 100 },
      gapToPrevious: 0,
      leadOverNext: "NaN",
      rankDelta: 0,
    },
  });

  assert.equal(king.game.quests[0].detail, "已确认今日总榜第 1");
  assert.doesNotMatch(king.game.quests[0].detail, /Bob|0/);
});

test("buildSummary labels unknown leaderboard gaps as unavailable instead of zero", () => {
  const s = buildSummary({
    lastUpload: {
      uploadId: "upload-1",
      summary: { date: "2026-06-25", total: 100, byTool: { codex: 100 } },
      upstream: { json: { accepted: 1 }, status: 200 },
    },
    leaderboard: {
      uploadId: "upload-1",
      own: { rank: 250, score: 100, byTool: { codex: 100 } },
      previous: null,
      next: null,
      gapToPrevious: null,
      leadOverNext: null,
      rankDelta: 0,
      updatedAt: "t",
    },
  });

  assert.equal(s.source, "leaderboard");
  assert.equal(s.rankLabel, "#250");
  assert.equal(s.gapToPrevious, null);
  assert.equal(s.gapToPreviousLabel, "--");
  assert.equal(s.leadOverNext, null);
  assert.equal(s.leadOverNextLabel, "--");
});
