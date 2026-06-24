const { formatCount, toolLabel } = require("./format");
const { buildGame } = require("./battle-report");
const { buildBattleReport } = require("./island-report");

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
  const normalizedByTool = {};
  let normalized = 0;
  for (const row of dayRows) {
    byTool[row.tool] = (byTool[row.tool] || 0) + rawTokens(row);
    normalizedByTool[row.tool] = (normalizedByTool[row.tool] || 0) + Number(row.normalized || 0);
    normalized += Number(row.normalized || 0);
  }
  const total = Object.values(byTool).reduce((sum, value) => sum + value, 0);
  return { date, total, normalized, byTool, normalizedByTool, rowCount: dayRows.length };
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

function leaderboardScore(summary = {}) {
  return Number(summary.total || 0);
}

function leaderboardTools(summary = {}) {
  return summary.byTool || {};
}

function entryMatchesSummary(entry = {}, summary = {}) {
  const score = leaderboardScore(summary);
  if (score <= 0 || Number(entry.score || 0) !== score) return false;
  const entryTools = entry.byTool || {};
  const summaryTools = leaderboardTools(summary);
  if (!Object.keys(entryTools).length || !Object.keys(summaryTools).length) return true;
  return sameToolBreakdown(entryTools, summaryTools);
}

function findOwnEntry(entries, summary, userId, { allowUserIdFallback = true } = {}) {
  const matches = entries.filter((entry) => entryMatchesSummary(entry, summary));
  if (!matches.length) return null;
  if (userId) {
    return matches.find((entry) => String(entry.userId) === String(userId))
      || (allowUserIdFallback ? matches[0] : null);
  }
  return matches[0];
}

function estimateOwnEntry(entries, summary, { limit = Infinity } = {}) {
  if (!entries.length) return null;
  const score = leaderboardScore(summary);
  if (score <= 0) return null;
  const sorted = [...entries].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0)
    || Number(a.rank || 0) - Number(b.rank || 0)
  );
  const lowestFetchedScore = Number(sorted[sorted.length - 1]?.score || 0);
  if (entries.length >= limit && score < lowestFetchedScore) return null;
  const higher = sorted.filter((entry) => Number(entry.score || 0) > score);
  const rank = higher.length + 1;
  return {
    own: {
      rank,
      score,
      name: "You",
      byTool: leaderboardTools(summary),
      estimated: true,
    },
    previous: higher[higher.length - 1] || null,
    next: sorted.find((entry) => Number(entry.score || 0) <= score) || null,
  };
}

function ownEntryFromMyRank(myRank, summary, userId) {
  if (!userId || !myRank) return null;
  const score = leaderboardScore(summary);
  const rank = Number(myRank.rank || 0);
  const myRankScore = Number(myRank.score || 0);
  if (score <= 0 || rank <= 0 || myRankScore !== score) return null;
  return {
    userId,
    rank,
    score,
    name: "You",
    byTool: leaderboardTools(summary),
  };
}

function computeLeaderboard(entries, summary, previousRank, userId, options = {}) {
  const ownFromMyRank = ownEntryFromMyRank(options.myRank, summary, userId);
  let own = findOwnEntry(entries, summary, userId, { allowUserIdFallback: !ownFromMyRank });
  let estimated = false;
  let previous;
  let next;

  if (!own) own = ownFromMyRank;

  if (own) {
    const ownRank = Number(own.rank || 0);
    const index = entries.findIndex((entry) =>
      Number(entry.rank || 0) === ownRank
      || (own.userId && String(entry.userId) === String(own.userId))
    );
    const previousInEntries = index >= 0 ? entries[index - 1] || null : null;
    const nextInEntries = index >= 0 ? entries[index + 1] || null : null;
    previous = ownRank > 1
      ? entries.find((entry) => Number(entry.rank || 0) === ownRank - 1) || previousInEntries
      : null;
    next = entries.find((entry) => Number(entry.rank || 0) === ownRank + 1) || nextInEntries;
  } else {
    const estimate = estimateOwnEntry(entries, summary, options);
    if (!estimate) return null;
    ({ own, previous, next } = estimate);
    estimated = true;
  }

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
    estimated,
  };
}

function leaderboardBelongsToUpload(lastUpload, leaderboard) {
  if (!leaderboard) return false;
  const uploadId = lastUpload?.uploadId || "";
  const leaderboardUploadId = leaderboard.uploadId || "";
  if (!uploadId) return true;
  return leaderboardUploadId === uploadId;
}

function buildSummary({ lastUpload, leaderboard }) {
  const uploadSummary = lastUpload?.summary || null;
  const board = leaderboardBelongsToUpload(lastUpload, leaderboard) ? leaderboard : null;
  const own = board?.own || null;
  const previous = board?.previous || null;
  const next = board?.next || null;
  const byTool = uploadSummary?.byTool || own?.byTool || {};
  const total = Number(uploadSummary?.total || own?.score || 0);
  const score = Number(own?.score || uploadSummary?.normalized || total);
  const rank = own ? Number(own.rank) : null;
  const rankEstimated = Boolean(own?.estimated || board?.estimated);
  const gap = Number(board?.gapToPrevious || 0);
  const lead = Number(board?.leadOverNext || 0);
  const tools = toolsFromMap(byTool);
  const game = buildGame({
    total,
    rank,
    rankEstimated,
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
    source: own ? (rankEstimated ? "leaderboard-estimate" : "leaderboard") : uploadSummary ? "upload" : "waiting",
    capturedAt: lastUpload?.capturedAt || "",
    leaderboardUpdatedAt: board?.updatedAt || "",
    leaderboardError: board?.error || "",
    leaderboardScore: score,
    leaderboardScoreLabel: uploadSummary ? formatCount(score) : "--",
    date: uploadSummary?.date || "",
    total,
    totalLabel: uploadSummary ? formatCount(total) : "--",
    rank,
    rankLabel: rank ? `#${rank}` : "#--",
    rankEstimated,
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
    // 战报：始终用当前榜单实时计算，保证灵动岛展示与当前排名一致（不缓存，避免陈旧）。
    report: buildBattleReport(board),
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
