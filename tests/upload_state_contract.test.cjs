const test = require("node:test");
const assert = require("node:assert/strict");
const { applyLeaderboardForUpload, isCurrentUpload } = require("../lib/upload-state");

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
