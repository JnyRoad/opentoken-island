// 数值展示格式化。
//
// 从 server.js 抽出，供 server.js 与 battle-report.js 共用：
// 战报文案要把 token 分差渲染成「320.0万 / 1.20亿」这类中文缩写，
// 必须和主面板用同一套口径，否则同一个数字在岛上和面板里显示不一致。
// 集中到一处，避免两边各写一份实现而漂移（DRY）。

/**
 * 把一个 token 计数渲染成中文缩写。
 * 亿 / 万 两档，低于 1 万直接显示整数。
 * @param {number} value 原始计数
 * @returns {string} 形如 "1.20亿" / "320.0万" / "8500"
 */
function formatCount(value) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(Math.round(value));
}

/**
 * 把一个 0~1 的比例渲染成整数百分比。非有限值按 0% 处理（快速失败的反面：显式兜底）。
 * @param {number} value 0~1 的比例
 * @returns {string} 形如 "42%"
 */
function formatPercent(value) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

module.exports = { formatCount, formatPercent };
