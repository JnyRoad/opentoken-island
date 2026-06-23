const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSummary, rowsFromPayload, summarizeRows } = require("../lib/summary");

test("summarizeRows uses the latest date and aggregates raw token counts by tool", () => {
  const rows = rowsFromPayload({
    rows: [
      { date: "2026-06-22", tool: "codex", input: 100, output: 50 },
      { date: "2026-06-23", tool: "codex", input: 200, output: 50, cache_read: 25 },
      { date: "2026-06-23", tool: "gemini", input: 70, output: 30, normalized: 120 },
    ],
  });

  assert.deepEqual(summarizeRows(rows), {
    date: "2026-06-23",
    total: 375,
    normalized: 120,
    byTool: {
      codex: 275,
      gemini: 100,
    },
    rowCount: 2,
  });
});

test("buildSummary preserves UI data contract for leaderboard-backed state", () => {
  const summary = buildSummary({
    lastUpload: {
      capturedAt: "2026-06-23T12:00:00.000Z",
      summary: {
        date: "2026-06-23",
        total: 375,
        byTool: { codex: 275, gemini: 100 },
      },
      upstream: {
        status: 200,
        json: { accepted: 1 },
      },
    },
    leaderboard: {
      updatedAt: "2026-06-23T12:00:01.000Z",
      own: {
        userId: "u1",
        rank: 2,
        score: 375,
        byTool: { codex: 275, gemini: 100 },
      },
      previous: { rank: 1, name: "Alice", score: 400 },
      next: { rank: 3, name: "Bob", score: 100 },
      gapToPrevious: 26,
      leadOverNext: 275,
      rankDelta: 1,
    },
  });

  assert.equal(summary.waiting, false);
  assert.equal(summary.source, "leaderboard");
  assert.equal(summary.rankLabel, "#2");
  assert.equal(summary.gapToPreviousLabel, "26");
  assert.equal(summary.leadOverNextLabel, "275");
  assert.equal(summary.upstream.accepted, 1);
  assert.deepEqual(summary.tools.map((tool) => [tool.name, tool.valueLabel]), [
    ["codex", "275"],
    ["gemini", "100"],
  ]);
  assert.equal(summary.game.mainTool.label, "Codex");
  assert.equal(summary.game.quests[0].done, false);
  assert.equal(summary.game.badges.some((badge) => badge.title === "Rank Climber" && badge.unlocked), true);
});
