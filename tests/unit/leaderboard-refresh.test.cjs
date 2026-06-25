const test = require("node:test");
const assert = require("node:assert/strict");
const { createLeaderboardRefresher } = require("../../lib/leaderboard-refresh");

function makeState(overrides = {}) {
  return { userId: "", leaderboard: null, lastUpload: null, ...overrides };
}

test("previousRankFor returns null when leaderboard belongs to a different upload", () => {
  const r = createLeaderboardRefresher({ requestText: () => {}, logEvent: () => {} });
  const state = makeState({ leaderboard: { uploadId: "other", own: { rank: 5 } } });
  assert.equal(r.previousRankFor(state, "current"), null);
});

test("previousRankFor returns rank when leaderboard matches the upload", () => {
  const r = createLeaderboardRefresher({ requestText: () => {}, logEvent: () => {} });
  const state = makeState({ leaderboard: { uploadId: "current", own: { rank: 3 } } });
  assert.equal(r.previousRankFor(state, "current"), 3);
});

test("previousRankFor returns null for non-positive own ranks", () => {
  const r = createLeaderboardRefresher({ requestText: () => {}, logEvent: () => {} });
  const state = makeState({ leaderboard: { uploadId: "u", own: { rank: 0 } } });
  assert.equal(r.previousRankFor(state, "u"), null);
});

// With no userId, refresh makes exactly 1 requestText call before the first await,
// so resolveFirstFetch is guaranteed to be assigned synchronously before the second
// r.schedule() call.
test("schedule deduplicates: second call is ignored while first refresh is in flight", async () => {
  const fetches = [];
  let resolveFirstFetch;

  const requestText = () =>
    new Promise((resolve) => {
      fetches.push(true);
      if (fetches.length === 1) {
        resolveFirstFetch = resolve;
      } else {
        resolve({ ok: false, status: 0, headers: {}, body: "", json: null, error: "" });
      }
    });

  const r = createLeaderboardRefresher({ requestText, logEvent: () => {} });
  // lastUpload.uploadId must match upload.uploadId for applyLeaderboardForUpload to accept it
  const state = makeState({ userId: "", lastUpload: { uploadId: "x" } });
  const saveState = () => {};
  const upload = {
    uploadId: "x",
    summary: { total: 100, byTool: {}, date: "2026-06-25", rowCount: 1, normalized: 100 },
  };

  r.schedule(state, saveState, upload); // starts refresh — first requestText fires synchronously
  assert.equal(fetches.length, 1);      // exactly 1 call so far

  r.schedule(state, saveState, upload); // must be ignored; refreshPromise is set
  assert.equal(fetches.length, 1);      // still 1 — second schedule did nothing

  resolveFirstFetch({ ok: false, status: 0, headers: {}, body: "", json: null, error: "" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  // after resolution the retry loop continues (up to 4 attempts), but total is > 1;
  // the important assertion above already passed.
});
