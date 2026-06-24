function isCurrentUpload(state, uploadId = "") {
  const currentUploadId = String(state.lastUpload?.uploadId || "");
  if (!uploadId) return !currentUploadId;
  return currentUploadId === String(uploadId);
}

function leaderboardMatchesUpload(leaderboard, uploadId = "") {
  const leaderboardUploadId = String(leaderboard?.uploadId || "");
  if (!uploadId) return !leaderboardUploadId;
  return leaderboardUploadId === String(uploadId);
}

function hasLeaderboardRank(leaderboard) {
  return Number(leaderboard?.own?.rank || 0) > 0;
}

function hasConfirmedLeaderboardRank(leaderboard) {
  return hasLeaderboardRank(leaderboard)
    && !Boolean(leaderboard?.estimated || leaderboard?.own?.estimated);
}

function preserveLeaderboardRank(current, attempted) {
  return {
    ...current,
    error: attempted?.error || current?.error || "",
    entriesCount: attempted?.entriesCount ?? current?.entriesCount,
    lastRefreshAttemptAt: attempted?.updatedAt || current?.lastRefreshAttemptAt || current?.updatedAt || "",
  };
}

function selectLeaderboardForUpload(state, { uploadId = "", leaderboard }) {
  const current = state.leaderboard;
  if (!leaderboardMatchesUpload(current, uploadId)) return leaderboard;
  if (hasLeaderboardRank(current) && !hasLeaderboardRank(leaderboard)) {
    return preserveLeaderboardRank(current, leaderboard);
  }
  if (hasConfirmedLeaderboardRank(current) && !hasConfirmedLeaderboardRank(leaderboard)) {
    return preserveLeaderboardRank(current, leaderboard);
  }
  return leaderboard;
}

function applyLeaderboardForUpload(state, { uploadId = "", leaderboard }) {
  if (!isCurrentUpload(state, uploadId)) return false;
  state.leaderboard = selectLeaderboardForUpload(state, { uploadId, leaderboard });
  return true;
}

function applyUploadUpstream(state, { uploadId = "", uploadRecord }) {
  if (!isCurrentUpload(state, uploadId)) return false;
  state.lastUpload = uploadRecord;
  return true;
}

function uploadAccepted(lastUpload) {
  return lastUpload?.upstream?.ok === true
    && Number(lastUpload?.upstream?.json?.accepted || 0) > 0;
}

function shouldRefreshLeaderboard(state, {
  now = Date.now(),
  pendingRefreshMs = 60000,
  confirmedRefreshMs = 300000,
} = {}) {
  if (!state.lastUpload?.summary) return false;
  if (!uploadAccepted(state.lastUpload)) return false;
  const uploadId = state.lastUpload?.uploadId || "";
  const leaderboard = state.leaderboard;
  if (!leaderboardMatchesUpload(leaderboard, uploadId)) return true;

  const updatedAt = Date.parse(leaderboard?.lastRefreshAttemptAt || leaderboard?.updatedAt || "");
  const ageMs = Number.isFinite(updatedAt) ? now - updatedAt : Infinity;
  if (ageMs < 0) return false;

  const refreshMs = hasConfirmedLeaderboardRank(leaderboard)
    ? confirmedRefreshMs
    : pendingRefreshMs;
  return ageMs >= refreshMs;
}

module.exports = {
  applyLeaderboardForUpload,
  applyUploadUpstream,
  hasConfirmedLeaderboardRank,
  hasLeaderboardRank,
  isCurrentUpload,
  selectLeaderboardForUpload,
  shouldRefreshLeaderboard,
  uploadAccepted,
};
