const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyLeaderboardForUpload,
  isCurrentUpload,
  selectLeaderboardForUpload,
  shouldRefreshLeaderboard,
  uploadAccepted,
} = require("../lib/upload-state");

test("stale upload leaderboard updates do not overwrite the current upload", () => {
  const state = {
    lastUpload: { uploadId: "newer-upload" },
    leaderboard: {
      own: { rank: 2, score: 200 },
    },
  };

  const applied = applyLeaderboardForUpload(state, {
    uploadId: "older-upload",
    leaderboard: {
      own: { rank: 1, score: 100 },
    },
  });

  assert.equal(applied, false);
  assert.deepEqual(state.leaderboard, {
    own: { rank: 2, score: 200 },
  });
});

test("current upload leaderboard updates are applied", () => {
  const state = {
    lastUpload: { uploadId: "current-upload" },
    leaderboard: null,
  };

  const applied = applyLeaderboardForUpload(state, {
    uploadId: "current-upload",
    leaderboard: {
      own: { rank: 1, score: 300 },
    },
  });

  assert.equal(applied, true);
  assert.deepEqual(state.leaderboard, {
    own: { rank: 1, score: 300 },
  });
});

test("blank upload ids are only current for legacy state without ids", () => {
  assert.equal(isCurrentUpload({ lastUpload: { uploadId: "current-upload" } }, ""), false);
  assert.equal(isCurrentUpload({ lastUpload: {} }, ""), true);
});

test("uploadAccepted requires upstream ok and accepted rows", () => {
  assert.equal(uploadAccepted({ upstream: { ok: true, json: { accepted: 1 } } }), true);
  assert.equal(uploadAccepted({ upstream: { ok: true, json: { accepted: 0 } } }), false);
  assert.equal(uploadAccepted({ upstream: { ok: false, json: { accepted: 1 } } }), false);
});

test("confirmed leaderboard rank is not downgraded by an estimated refresh for the same upload", () => {
  const confirmedLeaderboard = {
    uploadId: "current-upload",
    updatedAt: "2026-06-24T03:00:00.000Z",
    own: { rank: 7, score: 413999437 },
    estimated: false,
  };
  const state = {
    lastUpload: { uploadId: "current-upload" },
    leaderboard: confirmedLeaderboard,
  };

  const selected = selectLeaderboardForUpload(state, {
    uploadId: "current-upload",
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:01:00.000Z",
      own: { rank: 6, score: 423071500, estimated: true },
      estimated: true,
    },
  });

  assert.equal(selected.own.rank, 7);
  assert.equal(selected.estimated, false);
  assert.equal(selected.lastRefreshAttemptAt, "2026-06-24T03:01:00.000Z");
});

test("confirmed leaderboard rank is not erased by a failed refresh for the same upload", () => {
  const confirmedLeaderboard = {
    uploadId: "current-upload",
    updatedAt: "2026-06-24T03:00:00.000Z",
    own: { rank: 7, score: 413999437 },
  };
  const state = {
    lastUpload: { uploadId: "current-upload" },
    leaderboard: confirmedLeaderboard,
  };

  const selected = selectLeaderboardForUpload(state, {
    uploadId: "current-upload",
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:01:00.000Z",
      error: "Current upload was not found in leaderboard yet",
    },
  });

  assert.equal(selected.own.rank, 7);
  assert.equal(selected.lastRefreshAttemptAt, "2026-06-24T03:01:00.000Z");
});

test("estimated leaderboard rank is not erased by a failed refresh for the same upload", () => {
  const estimatedLeaderboard = {
    uploadId: "current-upload",
    updatedAt: "2026-06-24T03:00:00.000Z",
    own: { rank: 6, score: 423071500, estimated: true },
    estimated: true,
  };
  const state = {
    lastUpload: { uploadId: "current-upload" },
    leaderboard: estimatedLeaderboard,
  };

  const selected = selectLeaderboardForUpload(state, {
    uploadId: "current-upload",
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:01:00.000Z",
      error: "Current upload was not found in leaderboard yet",
    },
  });

  assert.equal(selected.own.rank, 6);
  assert.equal(selected.estimated, true);
  assert.equal(selected.lastRefreshAttemptAt, "2026-06-24T03:01:00.000Z");
});

test("preserved leaderboard rank advances refresh cooldown after a failed refresh", () => {
  const now = Date.parse("2026-06-24T03:02:30.000Z");
  const state = {
    lastUpload: {
      uploadId: "current-upload",
      summary: { total: 423071500 },
      upstream: { ok: true, json: { accepted: 1 } },
    },
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:00:00.000Z",
      own: { rank: 6, score: 423071500, estimated: true },
      estimated: true,
    },
  };

  const selected = selectLeaderboardForUpload(state, {
    uploadId: "current-upload",
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:02:00.000Z",
      error: "Current upload was not found in leaderboard yet",
    },
  });

  assert.equal(selected.own.rank, 6);
  assert.equal(selected.lastRefreshAttemptAt, "2026-06-24T03:02:00.000Z");
  assert.equal(shouldRefreshLeaderboard({ ...state, leaderboard: selected }, {
    now,
    pendingRefreshMs: 60000,
    confirmedRefreshMs: 300000,
  }), false);
});

test("estimated leaderboard refreshes automatically after the pending interval", () => {
  const now = Date.parse("2026-06-24T03:02:01.000Z");
  const state = {
    lastUpload: {
      uploadId: "current-upload",
      summary: { total: 423071500 },
      upstream: { ok: true, json: { accepted: 1 } },
    },
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:01:00.000Z",
      own: { rank: 6, score: 423071500, estimated: true },
      estimated: true,
    },
  };

  assert.equal(shouldRefreshLeaderboard(state, {
    now,
    pendingRefreshMs: 60000,
    confirmedRefreshMs: 300000,
  }), true);
});

test("accepted zero does not auto-refresh leaderboard", () => {
  const now = Date.parse("2026-06-24T03:02:01.000Z");
  const state = {
    lastUpload: {
      uploadId: "current-upload",
      summary: { total: 423071500 },
      upstream: { ok: true, json: { accepted: 0 } },
    },
    leaderboard: {
      uploadId: "current-upload",
      updatedAt: "2026-06-24T03:01:00.000Z",
      own: { rank: 6, score: 423071500, estimated: true },
      estimated: true,
    },
  };

  assert.equal(shouldRefreshLeaderboard(state, {
    now,
    pendingRefreshMs: 60000,
    confirmedRefreshMs: 300000,
  }), false);
});

test("captured upload does not auto-refresh before upstream accepts it", () => {
  const state = {
    lastUpload: {
      uploadId: "current-upload",
      summary: { total: 10 },
    },
    leaderboard: null,
  };

  assert.equal(shouldRefreshLeaderboard(state), false);
});
