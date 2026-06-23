const test = require("node:test");
const assert = require("assert");
const { rankedTools, buildGame } = require("../../lib/battle-report");

test("rankedTools sorts desc and computes share", () => {
  const ranked = rankedTools({ codex: 30, "claude-code": 70 }, 100);
  assert.equal(ranked[0].name, "claude-code");
  assert.equal(ranked[0].share, 0.7);
  assert.equal(ranked[1].name, "codex");
});

test("rankedTools with total 0 yields share 0 (no divide-by-zero)", () => {
  const ranked = rankedTools({ codex: 0, gemini: 0 }, 0);
  assert.equal(ranked[0].share, 0);
  assert.ok(Number.isFinite(ranked[0].share));
});

test("buildGame computes level and xp from total", () => {
  const game = buildGame({
    total: 30_000_000, rank: 5, rankDelta: 0,
    byTool: { codex: 30_000_000 }, previous: { name: "A", score: 31_000_000 },
    next: null, gap: 1_000_001, lead: 0, accepted: 0,
  });
  // level = floor(30M / 25M) + 1 = 2
  assert.equal(game.level, 2);
  assert.equal(game.xpMax, 25_000_000);
  assert.equal(game.xp, 30_000_000 % 25_000_000);
});

test("buildGame king branch sets crown quest done", () => {
  const game = buildGame({
    total: 350_000_000, rank: 1, rankDelta: 0,
    byTool: { codex: 350_000_000 }, previous: null,
    next: { name: "Rival", score: 100_000_000 }, gap: 0, lead: 250_000_000, accepted: 3,
  });
  assert.equal(game.quests[0].icon, "crown");
  assert.equal(game.quests[0].done, true);
  assert.equal(game.badges[0].unlocked, true); // King Mode
  assert.equal(game.sync.accepted, 3);
  assert.equal(game.sync.done, true);
});

test("buildGame climber branch when not rank 1", () => {
  const game = buildGame({
    total: 10_000_000, rank: 4, rankDelta: 2,
    byTool: { codex: 10_000_000 }, previous: { name: "Ahead", score: 12_000_000 },
    next: null, gap: 2_000_001, lead: 0, accepted: 0,
  });
  assert.equal(game.quests[0].icon, "trending-up");
  assert.equal(game.quests[0].done, false);
  assert.equal(game.sync.done, false);
});
