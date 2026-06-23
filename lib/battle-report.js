const { formatCount, formatPercent, toolLabel, toolIcon } = require("./format");

const LEVEL_SIZE = 25_000_000;
const HIGH_OUTPUT_TARGET = 300_000_000;

function rankedTools(byTool = {}, total = 0) {
  return Object.entries(byTool)
    .map(([name, value]) => ({
      name,
      value: Number(value || 0),
      label: toolLabel(name),
      icon: toolIcon(name),
      share: total > 0 ? Number(value || 0) / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function buildGame({ total, rank, rankDelta, byTool, previous, next, gap, lead, accepted = 0 }) {
  const levelSize = LEVEL_SIZE;
  const highOutputTarget = HIGH_OUTPUT_TARGET;
  const toolRanks = rankedTools(byTool, total);
  const mainTool = toolRanks[0] || { name: "", label: "Main Tool", icon: "terminal", value: 0, share: 0 };
  const runnerUpTool = toolRanks[1] || null;
  const mainLead = runnerUpTool ? Math.max(0, mainTool.value - runnerUpTool.value) : mainTool.value;
  const level = Math.max(1, Math.floor(total / levelSize) + 1);
  const xp = total > 0 ? total % levelSize : 0;
  const xpPct = Math.max(4, Math.round((xp / levelSize) * 100));
  const scoreDone = total >= highOutputTarget;
  const king = rank === 1;
  const rankQuest = king
    ? {
        icon: "crown",
        title: "王座守护：今日总榜第 1",
        detail: next ? `领先 ${next.name} ${formatCount(lead)}` : "当前无人追近",
        rewardLabel: "+800",
        done: true,
      }
    : {
        icon: "trending-up",
        title: "排名冲刺：超过上一名",
        detail: previous ? `距 ${previous.name} 还差 ${formatCount(gap)}` : "等待榜单排名",
        rewardLabel: "+800",
        done: false,
      };

  return {
    level,
    levelTitle: `Builder Lv. ${level}`,
    xp,
    xpMax: levelSize,
    xpPct,
    xpLabel: `${formatCount(xp)} / ${formatCount(levelSize)} XP`,
    codexShare: total > 0 ? Number(byTool.codex || 0) / total : 0,
    codexShareLabel: formatPercent(total > 0 ? Number(byTool.codex || 0) / total : 0),
    mainTool: {
      name: mainTool.name,
      label: mainTool.label,
      value: mainTool.value,
      valueLabel: formatCount(mainTool.value),
      share: mainTool.share,
      shareLabel: formatPercent(mainTool.share),
      leadLabel: formatCount(mainLead),
    },
    quests: [
      rankQuest,
      {
        icon: "target",
        title: "每日任务：冲到 3 亿",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        rewardLabel: "+620",
        done: scoreDone,
      },
      {
        icon: mainTool.icon,
        title: `主力工具：${mainTool.label} Main`,
        detail: runnerUpTool
          ? `领先 ${runnerUpTool.label} ${formatCount(mainLead)}`
          : `${formatPercent(mainTool.share)} share`,
        rewardLabel: "+240",
        done: mainTool.value > 0,
      },
    ],
    badges: [
      {
        icon: "crown",
        title: "King Mode",
        detail: king ? "今日总榜 #1" : rank ? `当前 #${rank}` : "等待排名",
        unlocked: king,
        featured: king,
      },
      {
        icon: "flame",
        title: "High Output",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        unlocked: scoreDone,
        featured: scoreDone && !king,
      },
      {
        icon: mainTool.icon,
        title: `${mainTool.label} Main`,
        detail: `${formatPercent(mainTool.share)} share`,
        unlocked: mainTool.value > 0,
        featured: false,
      },
      {
        icon: "trending-up",
        title: "Rank Climber",
        detail: rankDelta > 0 ? `上升 ${rankDelta} 名` : king ? "守住第 1" : "等待突破",
        unlocked: rankDelta > 0 || king,
        featured: false,
      },
    ],
    sync: {
      accepted,
      done: accepted > 0,
    },
  };
}

module.exports = { rankedTools, buildGame, LEVEL_SIZE, HIGH_OUTPUT_TARGET };
