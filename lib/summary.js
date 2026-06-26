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

function positiveToolMap(byTool = {}) {
  if (!byTool || typeof byTool !== "object") return {};
  const entries = Object.entries(byTool)
    .map(([name, value]) => [name, Number(value || 0)])
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries);
}

function toolsFromMap(byTool = {}) {
  const entries = Object.entries(positiveToolMap(byTool));
  const total = Math.max(1, entries.reduce((sum, [, value]) => sum + value, 0));
  return entries.slice(0, 6).map(([name, value]) => ({
    name,
    value,
    label: toolLabel(name),
    valueLabel: formatCount(value),
    pct: Math.round((value / total) * 100),
    barPct: Math.max(4, Math.round((value / total) * 100)),
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

function positiveFiniteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeFiniteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rankDeltaLabel(value) {
  const number = finiteNumberOrNull(value);
  if (number === null) return "--";
  return number >= 0 ? `+${number}` : String(number);
}

function hasValidRank(entry = {}) {
  return positiveFiniteNumber(entry.rank) > 0;
}

function leaderboardTools(summary = {}) {
  return summary.byTool || {};
}

function entryMatchesSummary(entry = {}, summary = {}, { allowHigherScore = false } = {}) {
  const score = positiveFiniteNumber(leaderboardScore(summary));
  const entryScore = positiveFiniteNumber(entry.score);
  const scoreMatches = allowHigherScore ? entryScore >= score : entryScore === score;
  if (score <= 0 || !hasValidRank(entry) || !scoreMatches) return false;
  if (allowHigherScore) return true;
  const entryTools = entry.byTool || {};
  const summaryTools = leaderboardTools(summary);
  if (!Object.keys(entryTools).length || !Object.keys(summaryTools).length) return true;
  return sameToolBreakdown(entryTools, summaryTools);
}

function findOwnEntry(entries, summary, userId, {
  allowUserIdFallback = true,
  allowHigherUserIdScore = false,
} = {}) {
  const confirmedUserId = String(userId || "").trim();
  const matches = entries.filter((entry) => {
    const entryUserId = String(entry.userId || "").trim();
    const canUseHigherScore = allowHigherUserIdScore && confirmedUserId && entryUserId === confirmedUserId;
    return entryMatchesSummary(entry, summary, { allowHigherScore: canUseHigherScore });
  });
  if (!matches.length) return null;
  if (userId) {
    const userIdMatch = matches.find((entry) => String(entry.userId) === String(userId));
    if (userIdMatch) return userIdMatch;
    if (allowHigherUserIdScore && confirmedUserId) return null;
    return allowUserIdFallback ? matches[0] : null;
  }
  return matches[0];
}

function estimateOwnEntry(entries, summary, { limit = Infinity } = {}) {
  if (!entries.length) return null;
  const score = positiveFiniteNumber(leaderboardScore(summary));
  if (score <= 0) return null;
  if (entries.some((entry) => positiveFiniteNumber(entry.score) <= 0 || positiveFiniteNumber(entry.rank) <= 0)) return null;
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

function findRankNeighbor(entries, rank) {
  const targetRank = positiveFiniteNumber(rank);
  if (targetRank <= 0) return null;
  return entries.find((entry) =>
    positiveFiniteNumber(entry.rank) === targetRank
    && positiveFiniteNumber(entry.score) > 0
  ) || null;
}

function ownEntryFromMyRank(myRank, summary, userId, { allowHigherMyRankScore = false } = {}) {
  if (!userId || !myRank) return null;
  const score = positiveFiniteNumber(leaderboardScore(summary));
  const rank = positiveFiniteNumber(myRank.rank);
  const myRankScore = positiveFiniteNumber(myRank.score);
  const scoreMatches = allowHigherMyRankScore ? myRankScore >= score : myRankScore === score;
  if (score <= 0 || rank <= 0 || !scoreMatches) return null;
  return {
    userId,
    rank,
    score: myRankScore,
    name: "You",
    byTool: leaderboardTools(summary),
  };
}

function computeLeaderboard(entries, summary, previousRank, userId, options = {}) {
  const ownFromMyRank = ownEntryFromMyRank(options.myRank, summary, userId, {
    allowHigherMyRankScore: Boolean(options.allowHigherMyRankScore),
  });
  let own = findOwnEntry(entries, summary, userId, {
    allowUserIdFallback: !ownFromMyRank,
    allowHigherUserIdScore: Boolean(options.allowHigherUserIdScore),
  });
  let estimated = false;
  let previous;
  let next;

  if (!own) own = ownFromMyRank;

  if (own) {
    const ownRank = Number(own.rank || 0);
    previous = ownRank > 1
      ? findRankNeighbor(entries, ownRank - 1)
      : null;
    next = findRankNeighbor(entries, ownRank + 1);
  } else {
    const estimate = estimateOwnEntry(entries, summary, options);
    if (!estimate) return null;
    ({ own, previous, next } = estimate);
    estimated = true;
  }

  const ownRank = Number(own.rank || 0);
  const gapToPrevious = previous
    ? Math.max(0, Number(previous.score || 0) - Number(own.score || 0) + 1)
    : ownRank > 1 ? null : 0;
  const leadOverNext = next
    ? Math.max(0, Number(own.score || 0) - Number(next.score || 0))
    : null;
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
  const rawOwn = board?.own || null;
  const ownScore = positiveFiniteNumber(rawOwn?.score);
  const ownRank = positiveFiniteNumber(rawOwn?.rank);
  const own = ownScore > 0 && ownRank > 0 ? rawOwn : null;
  const previous = own ? board?.previous || null : null;
  const next = own ? board?.next || null : null;
  const leaderboardByTool = positiveToolMap(own?.byTool);
  const uploadByTool = positiveToolMap(uploadSummary?.byTool);
  const byTool = Object.keys(leaderboardByTool).length ? leaderboardByTool : uploadByTool;
  const leaderboardScoreValue = own ? ownScore : 0;
  const total = leaderboardScoreValue || positiveFiniteNumber(uploadSummary?.total);
  const score = leaderboardScoreValue || positiveFiniteNumber(uploadSummary?.normalized) || total;
  const rank = own ? ownRank : null;
  const rankEstimated = Boolean(own && (own.estimated || board?.estimated));
  const rankDelta = own ? finiteNumberOrNull(board?.rankDelta) : null;
  const gap = !own || board?.gapToPrevious === null || board?.gapToPrevious === undefined
    ? null
    : nonNegativeFiniteNumberOrNull(board.gapToPrevious);
  const lead = !own || board?.leadOverNext === null || board?.leadOverNext === undefined
    ? null
    : nonNegativeFiniteNumberOrNull(board.leadOverNext);
  const tools = toolsFromMap(byTool);
  const displayPrevious = gap === null ? null : previous;
  const displayNext = lead === null ? null : next;
  const reportBoard = own ? {
    ...board,
    own: { ...own, rank, score: ownScore, byTool },
    previous: displayPrevious,
    next: displayNext,
    gapToPrevious: gap,
    leadOverNext: lead,
    rankDelta,
    estimated: rankEstimated,
  } : null;
  const game = buildGame({
    total,
    rank,
    rankEstimated,
    rankDelta,
    byTool,
    previous: displayPrevious,
    next: displayNext,
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
    rankDelta,
    rankDeltaLabel: rankDeltaLabel(rankDelta),
    previousName: displayPrevious?.name || "",
    previousScore: positiveFiniteNumber(displayPrevious?.score),
    nextName: displayNext?.name || "",
    nextScore: positiveFiniteNumber(displayNext?.score),
    gapToPrevious: gap,
    gapToPreviousLabel: rank === 1 ? "0" : gap === null ? "--" : formatCount(gap),
    leadOverNext: lead,
    leadOverNextLabel: lead === null ? "--" : formatCount(lead),
    nextRankGap: gap,
    xp: game.xp,
    xpMax: game.xpMax,
    // 战报：始终用当前榜单实时计算，保证灵动岛展示与当前排名一致（不缓存，避免陈旧）。
    report: buildBattleReport(reportBoard),
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
