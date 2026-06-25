const { computeLeaderboard } = require("./summary");
const { applyLeaderboardForUpload } = require("./upload-state");
const {
  buildLeaderboardEndpoint,
  LEADERBOARD_ENTRY_LIMIT,
  LEADERBOARD_RANK_ONLY_LIMIT,
} = require("./leaderboard-endpoint");

const LEADERBOARD_MAX_ATTEMPTS = 4;
const LEADERBOARD_RETRY_DELAY_MS = 900;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaderboardEntries(result) {
  return Array.isArray(result?.json?.entries) ? result.json.entries : [];
}

function confirmedMyRank(myRank, summary) {
  const score = Number(summary?.total || 0);
  const myRankScore = Number(myRank?.score || 0);
  const rank = Number(myRank?.rank || 0);
  if (
    !Number.isFinite(score)
    || !Number.isFinite(myRankScore)
    || !Number.isFinite(rank)
    || score <= 0
    || myRankScore < score
    || rank <= 0
  ) {
    return 0;
  }
  return rank;
}

function leaderboardWindowContainsOwn(entries, ownRank, userId, summary) {
  const confirmedUserId = String(userId || "").trim();
  const score = Number(summary?.total || 0);
  return entries.some((entry) => {
    const entryScore = Number(entry.score || 0);
    const entryRank = Number(entry.rank || 0);
    if (!Number.isFinite(score) || !Number.isFinite(entryScore) || score <= 0 || entryScore < score) return false;
    if (!Number.isFinite(entryRank) || entryRank <= 0) return false;
    const entryUserId = String(entry.userId || "").trim();
    if (confirmedUserId && entryUserId) return entryUserId === confirmedUserId;
    return ownRank > 0 && Number(entry.rank || 0) === ownRank;
  });
}

function createLeaderboardRefresher({ requestText, logEvent }) {
  let refreshPromise = null;

  function requestLeaderboard(userId, limit) {
    const endpoint = buildLeaderboardEndpoint(userId, { limit });
    return requestText("GET", endpoint, "", { accept: "application/json" });
  }

  async function refresh(state, saveState, summary, previousRank, uploadId) {
    let lastResult = null;

    for (let attempt = 0; attempt < LEADERBOARD_MAX_ATTEMPTS; attempt += 1) {
      const confirmedUserId = String(state.userId || "").trim();
      let result = confirmedUserId
        ? await requestLeaderboard(confirmedUserId, LEADERBOARD_RANK_ONLY_LIMIT)
        : null;
      lastResult = result;
      let entries = [];
      let myRank = result?.json?.myRank;
      const ownRank = confirmedMyRank(myRank, summary);

      if (!confirmedUserId || ownRank === 0 || ownRank <= LEADERBOARD_ENTRY_LIMIT) {
        result = await requestLeaderboard(confirmedUserId, LEADERBOARD_ENTRY_LIMIT);
        lastResult = result;
        entries = leaderboardEntries(result);
        const fullMyRank = result.json?.myRank;
        const fullOwnRank = confirmedMyRank(fullMyRank, summary) || ownRank;
        const fullWindowHasOwn = !confirmedUserId
          || leaderboardWindowContainsOwn(entries, fullOwnRank, confirmedUserId, summary);
        if (!entries.length || !fullWindowHasOwn) {
          entries = [];
          myRank = null;
        } else {
          myRank = fullMyRank || (ownRank > 0 ? myRank : null);
        }
      }

      const board = computeLeaderboard(entries, summary, previousRank, state.userId, {
        limit: LEADERBOARD_ENTRY_LIMIT,
        myRank,
        allowHigherMyRankScore: Boolean(confirmedUserId),
        allowHigherUserIdScore: Boolean(confirmedUserId),
      });

      if (board) {
        const leaderboard = { updatedAt: new Date().toISOString(), uploadId, ...board };
        if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
        if (board.own.userId) state.userId = board.own.userId;
        saveState();
        return state.leaderboard;
      }

      if (attempt < LEADERBOARD_MAX_ATTEMPTS - 1) await sleep(LEADERBOARD_RETRY_DELAY_MS);
    }

    const leaderboard = {
      updatedAt: new Date().toISOString(),
      board: "total",
      range: "today",
      uploadId,
      entriesCount: leaderboardEntries(lastResult).length,
      error: lastResult?.error || "Current upload was not found in leaderboard yet",
    };
    if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
    saveState();
    return state.leaderboard;
  }

  function markAttempt(state, saveState, uploadId) {
    const checkedAt = new Date().toISOString();
    const current = String(state.leaderboard?.uploadId || "") === String(uploadId || "")
      ? state.leaderboard || {}
      : {};
    const leaderboard = {
      ...current,
      uploadId,
      board: current.board || "total",
      range: current.range || "today",
      lastRefreshAttemptAt: checkedAt,
    };
    if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return false;
    saveState();
    return true;
  }

  function previousRankFor(state, uploadId) {
    if (String(state.leaderboard?.uploadId || "") !== String(uploadId || "")) return null;
    const rank = Number(state.leaderboard?.own?.rank || 0);
    return Number.isFinite(rank) && rank > 0 ? rank : null;
  }

  function schedule(state, saveState, upload) {
    if (refreshPromise) return;
    const uploadId = upload.uploadId || "";
    const previousRank = previousRankFor(state, uploadId);
    if (!markAttempt(state, saveState, uploadId)) return;
    refreshPromise = refresh(state, saveState, upload.summary, previousRank, uploadId)
      .catch((error) => {
        logEvent("leaderboard auto refresh failed", { error: error.message });
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return { refresh, schedule, previousRankFor };
}

module.exports = { createLeaderboardRefresher };
