function isCurrentUpload(state, uploadId = "") {
  const currentUploadId = String(state.lastUpload?.uploadId || "");
  if (!uploadId) return !currentUploadId;
  return currentUploadId === String(uploadId);
}

function applyLeaderboardForUpload(state, { uploadId = "", leaderboard }) {
  if (!isCurrentUpload(state, uploadId)) return false;
  state.leaderboard = leaderboard;
  return true;
}

function applyUploadUpstream(state, { uploadId = "", uploadRecord }) {
  if (!isCurrentUpload(state, uploadId)) return false;
  state.lastUpload = uploadRecord;
  return true;
}

module.exports = {
  applyLeaderboardForUpload,
  applyUploadUpstream,
  isCurrentUpload,
};
