// 实时战报（buildBattleReport）的单元测试。
//
// 战报是「把 leaderboard 的 gap/lead/rankDelta 翻译成一条可展示的灵动岛推送」的纯逻辑。
//
// 覆盖维度：
//   1. 五类战报各自的命中分支（overtaken / defense / soon / climb / default）
//   2. 优先级（同时满足多条时谁胜出）：overtaken > defense > soon > climb > default
//   3. 边界：无 own、own.score 为 0（防止除零误报）、rank=1（无上一名）

const test = require("node:test");
const assert = require("assert");
const { buildBattleReport, NEAR_THRESHOLD } = require("../../lib/island-report");

// 阈值约定：相对比例 5%。测试用的数值都围绕它构造「近 / 远」两种距离。
test("NEAR_THRESHOLD 临近阈值应为 5%", () => {
  assert.equal(NEAR_THRESHOLD, 0.05);
});

// 1) 被反超：rankDelta < 0 是最高优先级（损失厌恶）。
//    关键约束：不能指名「上一名」就是反超你的人——排名下降可能由多人/新用户造成，
//    当前 previous 未必是肇事者，所以文案只陈述「掉了几名」，不点名。
test("rankDelta<0 命中 overtaken，且不点名上一名", () => {
  const report = buildBattleReport({
    own: { rank: 8, score: 50_000_000, name: "我" },
    previous: { name: "李四", score: 51_000_000 },
    next: { name: "王五", score: 49_000_000 },
    gapToPrevious: 1_000_001,
    leadOverNext: 1_000_000,
    rankDelta: -3,
  });
  assert.equal(report.type, "overtaken");
  assert.ok(report.title.includes("3"), "标题应含掉名数 3");
  assert.ok(
    !report.title.includes("李四") && !report.copy.includes("李四"),
    "不得把上一名指认为反超者"
  );
  assert.equal(report.metric, "#8");
});

// 2) 防守预警：还没被反超，但领先下一名很薄（lead/own < 阈值）。
//    用 leadOverNext，是「将失去」版的损失厌恶，比真被反超更早触发。
test("leadOverNext 占比低命中 defense，并点名追兵", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 130_000_000 },
    next: { name: "王五", score: 98_000_000 },
    gapToPrevious: 30_000_000, // 30%，远，不触发 soon
    leadOverNext: 2_000_000, // 2%，近，触发 defense
    rankDelta: 0,
  });
  assert.equal(report.type, "defense");
  assert.ok(report.title.includes("王五"), "防守预警应点名身后的追兵");
  assert.ok(report.copy.includes("200.0万"), "副文案应含领先差 200.0万");
});

// 3) 临近超越：距上一名很近（gap/own < 阈值）。这里点名是可靠的——
//    previous 确实排在你前面、是你正要追的人。
test("gapToPrevious 占比低命中 soon，并点名上一名", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 103_200_000 },
    next: { name: "王五", score: 50_000_000 },
    gapToPrevious: 3_200_000, // 3.2%，近 → soon
    leadOverNext: 50_000_000, // 50%，远，不触发 defense
    rankDelta: 0,
  });
  assert.equal(report.type, "soon");
  assert.ok(report.title.includes("张三"), "临近超越应点名上一名");
  assert.ok(report.title.includes("320.0万"), "标题应含追赶差 320.0万");
});

// 4) 名次跳动：较上次上传上升了名次（rankDelta>0），且不满足更高优先级。
//    文案用「较上次」而非「今日」——rankDelta 的基线是上一次上传，不是当日零点。
test("rankDelta>0 且距离都远时命中 climb，措辞为较上次", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 130_000_000 },
    next: { name: "王五", score: 50_000_000 },
    gapToPrevious: 30_000_000, // 30%，远
    leadOverNext: 50_000_000, // 50%，远
    rankDelta: 3,
  });
  assert.equal(report.type, "climb");
  assert.ok(report.title.includes("较上次"), "升名文案应为『较上次』");
  assert.ok(report.title.includes("3"), "应含上升名数 3");
});

// 5a) 兜底-守榜：稳坐第 1 且无名次变化，落到 default。守榜没有新鲜事，不应主动弹窗。
test("rank=1 且 rankDelta=0 命中 default（守榜）", () => {
  const report = buildBattleReport({
    own: { rank: 1, score: 200_000_000, name: "我" },
    previous: null,
    next: { name: "王五", score: 150_000_000 },
    gapToPrevious: 0,
    leadOverNext: 50_000_000,
    rankDelta: 0,
  });
  assert.equal(report.type, "default");
  assert.equal(report.metric, "#1");
});

// 5b) 兜底-追赶：中游、距离都远、无名次变化，落到 default。
test("中游无变化命中 default（追赶）", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 130_000_000 },
    next: { name: "王五", score: 50_000_000 },
    gapToPrevious: 30_000_000,
    leadOverNext: 50_000_000,
    rankDelta: 0,
  });
  assert.equal(report.type, "default");
  assert.equal(report.metric, "#5");
});

// 6) 优先级 soon > climb：既升名又临近上一名时，优先播「即时目标」。
test("同时满足 soon 与 climb 时优先 soon", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 103_200_000 },
    next: { name: "王五", score: 50_000_000 },
    gapToPrevious: 3_200_000, // 近
    leadOverNext: 50_000_000, // 远
    rankDelta: 2, // 也升名
  });
  assert.equal(report.type, "soon");
});

// 7) 优先级 defense > soon：既临近上一名又快被身后追上时，优先防守（损失厌恶更强）。
test("同时满足 defense 与 soon 时优先 defense", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: { name: "张三", score: 103_200_000 },
    next: { name: "王五", score: 98_000_000 },
    gapToPrevious: 3_200_000, // 近 → soon
    leadOverNext: 2_000_000, // 近 → defense
    rankDelta: 0,
  });
  assert.equal(report.type, "defense");
});

// 8) 边界：没有 own（拉榜失败 / 尚未上传）时安全兜底，不抛错。
test("缺少 own 时返回 default 且 metric 为占位", () => {
  const report = buildBattleReport({ own: null });
  assert.equal(report.type, "default");
  assert.equal(report.metric, "#--");
});

// 9) 边界：own.score 为 0 时不得触发 soon/defense（占比计算会除零，且语义无意义）。
test("own.score=0 时不触发 soon/defense，落到 default", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 0, name: "我" },
    previous: { name: "张三", score: 1_000_000 },
    next: { name: "王五", score: 0 },
    gapToPrevious: 1_000_001,
    leadOverNext: 0,
    rankDelta: 0,
  });
  assert.equal(report.type, "default");
});

// 榜尾：next 为 null 时，即便领先差很薄也不该触发 defense（无身后追兵）。
test("next 为 null（榜尾）时不触发 defense", () => {
  const report = buildBattleReport({
    own: { rank: 100, score: 1_000_000, name: "我" },
    previous: { name: "张三", score: 1_500_000 },
    next: null,
    gapToPrevious: 500_001, // 50%，远，不触发 soon
    leadOverNext: 0,
    rankDelta: 0,
  });
  assert.notEqual(report.type, "defense");
});

// previous 为 null 但 rank>1（数据异常）时不该触发 soon（无上一名可追）。
test("previous 为 null 时不触发 soon", () => {
  const report = buildBattleReport({
    own: { rank: 5, score: 100_000_000, name: "我" },
    previous: null,
    next: { name: "王五", score: 50_000_000 },
    gapToPrevious: 1_000_000, // 占比很低，但 previous 缺失应短路
    leadOverNext: 50_000_000,
    rankDelta: 0,
  });
  assert.notEqual(report.type, "soon");
});

// 被反超的判定不依赖分数：own.score=0 时也必须触发 overtaken（最高优先级、score 无关）。
test("own.score=0 仍能触发 overtaken", () => {
  const report = buildBattleReport({
    own: { rank: 8, score: 0, name: "我" },
    previous: { name: "李四", score: 1_000_000 },
    next: { name: "王五", score: 0 },
    gapToPrevious: 1_000_001,
    leadOverNext: 0,
    rankDelta: -2,
  });
  assert.equal(report.type, "overtaken");
  assert.ok(report.title.includes("2"), "应含掉名数 2");
});
