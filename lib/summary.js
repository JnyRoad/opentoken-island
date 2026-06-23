const { formatCount, toolLabel } = require("./format");
const { buildGame } = require("./battle-report");

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

function rawTokens(row) {
  return Number(row.input || 0)
    + Number(row.output || 0)
    + Number(row.cache_read || 0)
    + Number(row.cache_write || 0);
}

function summarizeRows(rows, preferredDate = "") {
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
  const date = preferredDate && dates.includes(preferredDate)
    ? preferredDate
    : dates[dates.length - 1] || "";
  const dayRows = rows.filter((row) => row.date === date);
  const byTool = {};
  let normalized = 0;
  for (const row of dayRows) {
    byTool[row.tool] = (byTool[row.tool] || 0) + rawTokens(row);
    normalized += Number(row.normalized || 0);
  }
  const total = Object.values(byTool).reduce((sum, value) => sum + value, 0);
  return { date, total, normalized, byTool, rowCount: dayRows.length };
}

function toolsFromMap(byTool = {}) {
  const entries = Object.entries(byTool).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return entries.slice(0, 6).map(([name, value]) => ({
    name,
    value,
    label: toolLabel(name),
    valueLabel: formatCount(value),
    pct: Math.max(4, Math.round((value / max) * 100)),
  }));
}

function sameToolBreakdown(entryTools = {}, summaryTools = {}) {
  const keys = Object.keys(summaryTools);
  if (!keys.length) return false;
  return keys.every((key) => Number(entryTools[key] || 0) === Number(summaryTools[key] || 0));
}

function findOwnEntry(entries, summary, userId) {
  if (userId) {
    const byUser = entries.find((entry) => String(entry.userId) === String(userId));
    if (byUser) return byUser;
  }
  return entries.find((entry) =>
    Number(entry.score || 0) === Number(summary.total || 0)
    && sameToolBreakdown(entry.byTool || {}, summary.byTool || {})
  );
}

function computeLeaderboard(entries, summary, previousRank, userId) {
  const own = findOwnEntry(entries, summary, userId);
  if (!own) return null;
  const index = entries.findIndex((entry) => entry.rank === own.rank || entry.userId === own.userId);
  const previous = own.rank > 1
    ? entries.find((entry) => entry.rank === own.rank - 1) || entries[index - 1] || null
    : null;
  const next = entries.find((entry) => entry.rank === own.rank + 1) || entries[index + 1] || null;
  const gapToPrevious = previous ? Math.max(0, Number(previous.score || 0) - Number(own.score || 0) + 1) : 0;
  const leadOverNext = next ? Math.max(0, Number(own.score || 0) - Number(next.score || 0)) : 0;
  const rankDelta = typeof previousRank === "number" ? previousRank - Number(own.rank || previousRank) : 0;
  return {
    board: "total",
    range: "today",
    entriesCount: entries.length,
    own,
    previous,
    next,
    gapToPrevious,
    leadOverNext,
    rankDelta,
  };
}

function buildSummary({ lastUpload, leaderboard }) {
  const uploadSummary = lastUpload?.summary || null;
  const board = leaderboard || null;
  const own = board?.own || null;
  const previous = board?.previous || null;
  const next = board?.next || null;
  const byTool = own?.byTool || uploadSummary?.byTool || {};
  const total = Number(own?.score || uploadSummary?.total || 0);
  const rank = own ? Number(own.rank) : null;
  const gap = Number(board?.gapToPrevious || 0);
  const lead = Number(board?.leadOverNext || 0);
  const tools = toolsFromMap(byTool);
  const game = buildGame({
    total,
    rank,
    rankDelta: Number(board?.rankDelta || 0),
    byTool,
    previous,
    next,
    gap,
    lead,
    accepted: Number(lastUpload?.upstream?.json?.accepted || 0),
  });

  return {
    ok: true,
    waiting: !uploadSummary,
    source: own ? "leaderboard" : uploadSummary ? "upload" : "waiting",
    capturedAt: lastUpload?.capturedAt || "",
    leaderboardUpdatedAt: board?.updatedAt || "",
    date: uploadSummary?.date || "",
    total,
    totalLabel: uploadSummary ? formatCount(total) : "--",
    rank,
    rankLabel: rank ? `#${rank}` : "#--",
    rankDelta: Number(board?.rankDelta || 0),
    previousName: previous?.name || "",
    previousScore: Number(previous?.score || 0),
    nextName: next?.name || "",
    nextScore: Number(next?.score || 0),
    gapToPrevious: gap,
    gapToPreviousLabel: rank === 1 ? "0" : formatCount(gap),
    leadOverNext: lead,
    leadOverNextLabel: formatCount(lead),
    nextRankGap: gap,
    xp: game.xp,
    xpMax: game.xpMax,
    game,
    quests: game.quests,
    badges: game.badges,
    tools,
    upstream: {
      accepted: lastUpload?.upstream?.json?.accepted ?? null,
      status: lastUpload?.upstream?.status ?? null,
    },
  };
}

module.exports = {
  rowsFromPayload, rawTokens, summarizeRows, toolsFromMap,
  sameToolBreakdown, findOwnEntry, computeLeaderboard, buildSummary,
};
