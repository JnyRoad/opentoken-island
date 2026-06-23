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

test("findOwnEntry prefers userId match then falls back to score+byTool", () => {
  const entries = [
    { userId: "u1", score: 100, byTool: { codex: 100 } },
    { userId: "u2", score: 200, byTool: { codex: 200 } },
  ];
  assert.equal(findOwnEntry(entries, { total: 999, byTool: {} }, "u2").userId, "u2");
  const byShape = findOwnEntry(entries, { total: 100, byTool: { codex: 100 } }, "");
  assert.equal(byShape.userId, "u1");
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

test("computeLeaderboard returns null when own not found", () => {
  const entries = [{ userId: "x", rank: 1, score: 9, name: "X" }];
  assert.equal(computeLeaderboard(entries, { total: 1, byTool: {} }, null, "nobody"), null);
});

test("buildSummary waiting state when no upload", () => {
  const s = buildSummary({ lastUpload: null, leaderboard: null });
  assert.equal(s.waiting, true);
  assert.equal(s.source, "waiting");
  assert.equal(s.totalLabel, "--");
});

test("buildSummary uses leaderboard source when own present", () => {
  const s = buildSummary({
    lastUpload: { summary: { date: "2026-06-23", total: 200, byTool: { codex: 200 } }, upstream: { json: { accepted: 1 }, status: 200 } },
    leaderboard: { own: { rank: 2, score: 200, byTool: { codex: 200 } }, gapToPrevious: 5, leadOverNext: 10, rankDelta: 1, updatedAt: "t" },
  });
  assert.equal(s.source, "leaderboard");
  assert.equal(s.rank, 2);
  assert.equal(s.total, 200);
  assert.equal(s.upstream.accepted, 1);
});
