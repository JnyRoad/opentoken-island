// 实时战报：把 leaderboard 的排名指标翻译成「一条灵动岛推送」。
//
// 设计取舍（第一性原理）：
//   - 文案规则是业务逻辑，集中在这一个纯函数里，便于单测、便于改文案，
//     island.html 退化为纯展示（只负责渲染本函数算好的 title/copy/metric）。
//   - 纯函数：只吃一个 board 对象，不读全局 state、不做 IO，输入相同输出必然相同。
//
// 心理学动机：
//   - overtaken / defense 是「损失厌恶」——失去比获得更上头，排在最前。
//   - soon 是「即时目标」——差一点点就能达成，给冲刺动力。
//   - climb 是正向反馈——每次上传都让名次跳动有回响。

const { formatCount } = require("./format");

// 「差一点点 / 快被追上」的判定阈值：相对比例，而非绝对值。
// 用相对比例的原因：榜首附近差几亿是常态，中游差几百万就很近，
// 绝对阈值对不同分段不公平；用 (差距 / 自己的分数) 衡量「近不近」更普适。
const NEAR_THRESHOLD = 0.05;

/**
 * 根据排行榜快照生成一条战报。
 *
 * 优先级（命中即返回，短路）：overtaken > defense > soon > climb > default
 *
 * @param {object} board 排行榜快照，对应 server.js 的 state.leaderboard
 * @param {object|null} board.own 自己的榜单条目 { rank, score, name }
 * @param {object|null} board.previous 上一名条目 { name, score }
 * @param {object|null} board.next 下一名条目 { name, score }
 * @param {number} board.gapToPrevious 距上一名的分差（追上所需）
 * @param {number} board.leadOverNext 领先下一名的分差（被追上前的缓冲）
 * @param {number} board.rankDelta 较上一次上传的名次变化，正=上升，负=下降
 * @returns {{type:string, icon:string, title:string, copy:string, metric:string}}
 *          type 用于服务端判断「是否值得弹窗」，其余字段供 island.html 直接渲染。
 */
function buildBattleReport(board) {
  const own = board && board.own;

  // 边界：拉榜失败或尚未上传时没有 own，安全兜底，绝不抛错（岛上展示占位）。
  if (!own) {
    return {
      type: "default",
      icon: "award",
      title: "等待排名",
      copy: "已同步，等待榜单刷新",
      metric: "#--",
    };
  }

  const rank = Number(own.rank) || 0;
  const ownScore = Number(own.score) || 0;
  const previous = board.previous || null;
  const next = board.next || null;
  const gap = Number(board.gapToPrevious) || 0;
  const lead = Number(board.leadOverNext) || 0;
  const rankDelta = Number(board.rankDelta) || 0;
  const metric = rank ? `#${rank}` : "#--";

  // 用自己的分数做分母衡量「近不近」。score<=0 时除法无意义且会除零，
  // 显式置为 Infinity 表示「不近」，从而跳过 soon/defense（边界显式处理）。
  const gapRatio = ownScore > 0 ? gap / ownScore : Infinity;
  const leadRatio = ownScore > 0 ? lead / ownScore : Infinity;

  // 1) 被反超：rankDelta<0。最高优先级（损失厌恶）。
  //    只陈述掉了几名——排名下降可能由多人上传/新用户挤入造成，
  //    当前 previous 未必是反超你的人，点名会指错人。
  if (rankDelta < 0) {
    return {
      type: "overtaken",
      icon: "trending-down",
      title: `🔻 掉了 ${-rankDelta} 名`,
      copy: `刚被反超，现在 ${metric}，夺回来`,
      metric,
    };
  }

  // 2) 防守预警：领先下一名很薄（将被反超）。点名身后追兵是可靠的——
  //    next 确实排在你后面。lead>0 排除并列/异常负值。
  if (next && lead > 0 && leadRatio < NEAR_THRESHOLD) {
    return {
      type: "defense",
      icon: "shield-alert",
      title: `⚠️ ${next.name} 快追上了`,
      copy: `只领先 ${formatCount(lead)}，别松劲`,
      metric,
    };
  }

  // 3) 临近超越：距上一名很近（即时目标）。点名可靠——previous 确实排你前面、是你要追的人。
  if (rank > 1 && previous && gap > 0 && gapRatio < NEAR_THRESHOLD) {
    return {
      type: "soon",
      icon: "flame",
      title: `⚡ 再 ${formatCount(gap)} 就超 ${previous.name}`,
      copy: `冲一把升到 #${rank - 1}`,
      metric,
    };
  }

  // 4) 名次跳动：较上次上传上升了名次。措辞用「较上次」而非「今日」——
  //    rankDelta 的基线是上一次上传时的排名，不是当日零点（详见 server.js 的 previousRank）。
  if (rankDelta > 0) {
    return {
      type: "climb",
      icon: "trending-up",
      title: `📈 较上次 +${rankDelta} 名`,
      copy: `现在 ${metric}，继续冲`,
      metric,
    };
  }

  // 5) 兜底：没有值得「战报」的变化时，回到守榜/追赶的静态文案。
  //    这一类 type 仍是 "default"，服务端据此判断「不主动弹窗」（守榜没有新鲜事）。
  if (rank === 1) {
    return {
      type: "default",
      icon: "crown",
      title: "👑 守住第 1",
      copy: next ? `领先 ${next.name} ${formatCount(lead)}` : "稳坐榜首",
      metric,
    };
  }
  return {
    type: "default",
    icon: "award",
    title: rank ? `当前 ${metric}` : "等待排名",
    copy: previous ? `距 ${previous.name} ${formatCount(gap)}` : "已同步",
    metric,
  };
}

module.exports = { buildBattleReport, NEAR_THRESHOLD };
