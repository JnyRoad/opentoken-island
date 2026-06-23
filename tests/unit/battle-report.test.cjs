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

test("buildGame computes today target progress from total", () => {
  const game = buildGame({
    total: 30_000_000, rank: 5, rankDelta: 0,
    byTool: { codex: 30_000_000 }, previous: { name: "A", score: 31_000_000 },
    next: null, gap: 1_000_001, lead: 0, accepted: 0,
  });
  assert.equal(game.level, 2);
  assert.equal(game.levelTitle, "今日进度");
  assert.equal(game.xpMax, 300_000_000);
  assert.equal(game.xp, 30_000_000);
  assert.equal(game.xpPct, 10);
  assert.equal(game.xpLabel, "3000.0万 / 3.00亿");
});

test("buildGame uses clear Chinese labels instead of game badge jargon", () => {
  const game = buildGame({
    total: 373_124_040, rank: 1, rankDelta: 0,
    byTool: { codex: 334_160_936, "claude-code": 38_963_104 }, previous: null,
    next: { name: "早早", score: 154_809_210 }, gap: 0, lead: 218_314_830, accepted: 145,
  });
  assert.equal(game.levelTitle, "今日进度");
  assert.equal(game.badges[0].title, "总榜排名");
  assert.equal(game.badges[0].detail, "第 1 名");
  assert.equal(game.badges[1].title, "今日目标");
  assert.equal(game.badges[2].title, "主力工具");
  assert.equal(game.badges[3].title, "上传状态");
  assert.ok(game.badges.every((badge) => !/King|High|Output|Main|Climber/.test(badge.title)));
});

test("buildGame king branch sets crown quest done", () => {
  const game = buildGame({
    total: 350_000_000, rank: 1, rankDelta: 0,
    byTool: { codex: 350_000_000 }, previous: null,
    next: { name: "Rival", score: 100_000_000 }, gap: 0, lead: 250_000_000, accepted: 3,
  });
  assert.equal(game.quests[0].icon, "crown");
  assert.equal(game.quests[0].done, true);
  assert.equal(game.badges[0].unlocked, true);
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
