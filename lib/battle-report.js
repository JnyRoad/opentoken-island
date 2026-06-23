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

function buildGame({ total, rank, rankEstimated = false, rankDelta, byTool, previous, next, gap, lead, accepted = 0 }) {
  const highOutputTarget = HIGH_OUTPUT_TARGET;
  const toolRanks = rankedTools(byTool, total);
  const mainTool = toolRanks[0] || { name: "", label: "主力工具", icon: "terminal", value: 0, share: 0 };
  const runnerUpTool = toolRanks[1] || null;
  const mainLead = runnerUpTool ? Math.max(0, mainTool.value - runnerUpTool.value) : mainTool.value;
  const level = Math.max(1, Math.floor(total / LEVEL_SIZE) + 1);
  const xp = Math.max(0, total);
  const xpPct = Math.max(4, Math.min(100, Math.round((xp / highOutputTarget) * 100)));
  const scoreDone = total >= highOutputTarget;
  const king = rank === 1 && !rankEstimated;
  const rankQuest = king
    ? {
        icon: "crown",
        title: "总榜排名：第 1 名",
        detail: next ? `领先第 2 名 ${next.name} ${formatCount(lead)}` : "已确认今日总榜第 1",
        rewardLabel: "已确认",
        done: true,
      }
    : {
        icon: "trending-up",
        title: rankEstimated ? `总榜排名：预计 #${rank || "--"}` : rank ? `总榜排名：#${rank}` : "总榜排名：待确认",
        detail: rankEstimated
          ? "等待官网榜单确认当前上传"
          : previous ? `距 ${previous.name} 还差 ${formatCount(gap)}` : "等待榜单排名",
        rewardLabel: rankEstimated ? "待确认" : "追赶中",
        done: false,
      };

  return {
    level,
    levelTitle: "今日进度",
    xp,
    xpMax: highOutputTarget,
    xpPct,
    xpLabel: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
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
        title: "今日目标：冲到 3 亿",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        rewardLabel: scoreDone ? "达标" : "未达标",
        done: scoreDone,
      },
      {
        icon: mainTool.icon,
        title: "工具占比",
        detail: runnerUpTool
          ? `${mainTool.label} 领先 ${runnerUpTool.label} ${formatCount(mainLead)}`
          : `${mainTool.label} ${formatPercent(mainTool.share)}`,
        rewardLabel: "已统计",
        done: mainTool.value > 0,
      },
    ],
    badges: [
      {
        icon: "crown",
        title: "总榜排名",
        detail: king ? "第 1 名" : rank ? `${rankEstimated ? "预计 " : "第 "}${rank}${rankEstimated ? "" : " 名"}` : "等待排名",
        unlocked: king,
        featured: king,
      },
      {
        icon: "target",
        title: "今日目标",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        unlocked: scoreDone,
        featured: scoreDone && !king,
      },
      {
        icon: mainTool.icon,
        title: "主力工具",
        detail: `${mainTool.label} ${formatPercent(mainTool.share)}`,
        unlocked: mainTool.value > 0,
        featured: false,
      },
      {
        icon: "upload-cloud",
        title: "上传状态",
        detail: accepted > 0 ? `已同步 ${accepted} 条` : "等待上传",
        unlocked: accepted > 0,
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
