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

test("toolsFromMap caps at 6 and floors pct at 4", () => {
  const map = { a: 100, b: 50, c: 25, d: 12, e: 6, f: 3, g: 1 };
  const tools = toolsFromMap(map);
  assert.equal(tools.length, 6);
  assert.equal(tools[0].pct, 100);
  assert.ok(tools[5].pct >= 4);
});

test("findOwnEntry prefers userId among entries that match the current score and tools", () => {
  const entries = [
    { userId: "u1", score: 100, byTool: { codex: 100 } },
    { userId: "u2", score: 200, byTool: { codex: 200 } },
  ];
  assert.equal(findOwnEntry(entries, { total: 200, byTool: { codex: 200 } }, "u2").userId, "u2");
  assert.equal(findOwnEntry(entries, { total: 999, byTool: {} }, "u2"), null);
  const byShape = findOwnEntry(entries, { total: 100, byTool: { codex: 100 } }, "");
  assert.equal(byShape.userId, "u1");
});

test("findOwnEntry matches leaderboard normalized score and tool breakdown", () => {
  const entries = [
    { userId: "u1", score: 100, byTool: { codex: 90, "claude-code": 10 } },
    { userId: "u2", score: 40_284_724, byTool: { codex: 32_482_095, "claude-code": 7_802_629 } },
  ];
  const own = findOwnEntry(entries, {
    total: 938_786_946,
    normalized: 40_284_724,
    byTool: { codex: 601_085_857, "claude-code": 337_701_089 },
    normalizedByTool: { codex: 32_482_095, "claude-code": 7_802_629 },
  }, "");
  assert.equal(own.userId, "u2");
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

test("computeLeaderboard estimates rank from normalized score when own is not found", () => {
  const entries = [
    { userId: "a", rank: 1, score: 300, name: "A" },
    { userId: "b", rank: 2, score: 100, name: "B" },
  ];
  const board = computeLeaderboard(entries, { total: 9999, normalized: 200, normalizedByTool: { codex: 200 } }, null, "nobody");
  assert.equal(board.estimated, true);
  assert.equal(board.own.estimated, true);
  assert.equal(board.own.rank, 2);
  assert.equal(board.previous.userId, "a");
  assert.equal(board.next.userId, "b");
  assert.equal(board.gapToPrevious, 101);
  assert.equal(board.leadOverNext, 100);
});

test("computeLeaderboard does not confirm a stale cached user id when score changed", () => {
  const entries = [
    { userId: "me", rank: 4, score: 100, name: "Me", byTool: { codex: 100 } },
    { userId: "a", rank: 1, score: 300, name: "A", byTool: { codex: 300 } },
  ];
  const board = computeLeaderboard(entries, {
    total: 9999,
    normalized: 200,
    normalizedByTool: { codex: 200 },
  }, null, "me");
  assert.equal(board.estimated, true);
  assert.equal(board.own.estimated, true);
  assert.equal(board.own.score, 200);
  assert.notEqual(board.own.userId, "me");
});

test("computeLeaderboard does not estimate a rank from an empty leaderboard", () => {
  const board = computeLeaderboard([], {
    total: 9999,
    normalized: 200,
    normalizedByTool: { codex: 200 },
  }, null, "nobody");
  assert.equal(board, null);
});

test("computeLeaderboard does not estimate a precise rank beyond a truncated leaderboard", () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({
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
  }, null, "", { limit: 500 });
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
        score: 40_284_724,
        byTool: { codex: 32_482_095, "claude-code": 7_802_629 },
        estimated: true,
      },
      previous: null,
      next: { rank: 2, name: "Alice", score: 3_000_000 },
      gapToPrevious: 0,
      leadOverNext: 37_284_724,
      rankDelta: 0,
    },
  });
  assert.equal(s.source, "leaderboard-estimate");
  assert.equal(s.rankEstimated, true);
  assert.equal(s.rankLabel, "#1");
  assert.equal(s.total, 938_786_946);
  assert.equal(s.leaderboardScore, 40_284_724);
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
  assert.equal(s.total, 200);
  assert.equal(s.upstream.accepted, 1);
});
