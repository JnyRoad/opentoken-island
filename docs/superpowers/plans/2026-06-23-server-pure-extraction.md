# Server Pure-Extraction Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `server.js`'s pure calculation logic into three single-responsibility `lib/` modules with dependency injection, add unit tests, and make `server.js` requireable without side effects — without changing `/api/*` happy-path behavior.

**Architecture:** Move pure functions out of the 727-line god-file into `lib/format.js`, `lib/battle-report.js`, `lib/summary.js` (dependency chain `format ← battle-report ← summary`, acyclic). All extracted functions take their data via parameters — zero global `state` reads. `server.js` requires the modules, injects `state` fields at call sites, splits `refreshLeaderboard` into a pure `computeLeaderboard` + the HTTP/retry/persist wrapper, guards `listen()` behind `require.main === module`, distinguishes ENOENT from JSON-parse errors, and names the leaderboard fetch magic numbers.

**Tech Stack:** Node.js (CommonJS, `type: "commonjs"`), Node v24 built-in `node:test` runner + `assert`, no new dependencies.

## Global Constraints

- **DO NOT modify `package.json`'s `test` script** — it is hard-asserted as `"node tests/windows_support_contract.test.cjs"` by `tests/windows_support_contract.test.cjs:9`. New unit tests run via a new `test:unit` script.
- `tests/windows_support_contract.test.cjs` must still pass unchanged after every task: `node tests/windows_support_contract.test.cjs` → `windows scaffold contract ok`.
- No new runtime dependencies. CommonJS `require`/`module.exports` only.
- Extracted functions are **pure**: no `fs`, no global `state`, no `new Date()`, no network. Data in via params, result out via return.
- `/api/*` happy-path response shapes must be byte-identical (verified in Task 4).
- Test files mirror existing style: `require("assert")` + `node:test` (`test()` blocks acceptable since `node --test` is the runner).

---

### Task 1: `lib/format.js` — presentation primitives

**Files:**
- Create: `lib/format.js`
- Create: `tests/unit/format.test.cjs`
- Modify: `package.json` (add `test:unit` script — additive, leaves `test` untouched)

**Interfaces:**
- Produces:
  - `formatCount(value: number) -> string`
  - `formatPercent(value: number) -> string`
  - `toolLabel(name: string) -> string`
  - `toolIcon(name: string) -> string`

- [ ] **Step 1: Add the `test:unit` script to `package.json`**

In `package.json`, inside `"scripts"`, add (do NOT touch the existing `"test"` line):

```json
    "test:unit": "node --test tests/unit/",
```

Resulting `scripts` block:

```json
  "scripts": {
    "test": "node tests/windows_support_contract.test.cjs",
    "test:unit": "node --test tests/unit/",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/format.test.cjs`:

```js
const test = require("node:test");
const assert = require("assert");
const { formatCount, formatPercent, toolLabel, toolIcon } = require("../../lib/format");

test("formatCount uses 亿 above 100M", () => {
  assert.equal(formatCount(250_000_000), "2.50亿");
});
test("formatCount uses 万 above 10k", () => {
  assert.equal(formatCount(15_000), "1.5万");
});
test("formatCount rounds small numbers", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(123.4), "123");
});
test("formatPercent rounds and guards non-finite", () => {
  assert.equal(formatPercent(0.5), "50%");
  assert.equal(formatPercent(NaN), "0%");
  assert.equal(formatPercent(Infinity), "0%");
});
test("toolLabel maps known and humanizes unknown", () => {
  assert.equal(toolLabel("claude-code"), "Claude Code");
  assert.equal(toolLabel("my-tool"), "My Tool");
});
test("toolIcon maps known and falls back to terminal", () => {
  assert.equal(toolIcon("codex"), "zap");
  assert.equal(toolIcon("whatever"), "terminal");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/unit/format.test.cjs`
Expected: FAIL — `Cannot find module '../../lib/format'`

- [ ] **Step 4: Create `lib/format.js` (move verbatim from server.js, add exports)**

```js
function formatCount(value) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(Math.round(value));
}

function formatPercent(value) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function toolLabel(name) {
  const labels = {
    "claude-code": "Claude Code",
    codex: "Codex",
    gemini: "Gemini",
    openclaw: "OpenClaw",
    opencode: "opencode",
  };
  return labels[name] || name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toolIcon(name) {
  const icons = {
    "claude-code": "bot",
    codex: "zap",
    gemini: "sparkles",
    openclaw: "terminal",
    opencode: "code-2",
  };
  return icons[name] || "terminal";
}

module.exports = { formatCount, formatPercent, toolLabel, toolIcon };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/unit/format.test.cjs`
Expected: PASS — all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/format.js tests/unit/format.test.cjs package.json
git commit -m "feat(lib): extract pure format helpers with unit tests"
```

---

### Task 2: `lib/battle-report.js` — gamified layer (rankedTools + buildGame)

**Files:**
- Create: `lib/battle-report.js`
- Create: `tests/unit/battle-report.test.cjs`

**Interfaces:**
- Consumes: `lib/format.js` (`formatCount`, `formatPercent`, `toolLabel`, `toolIcon`)
- Produces:
  - `rankedTools(byTool: object, total: number) -> Array<{name,value,label,icon,share}>` (desc by value)
  - `buildGame({ total, rank, rankDelta, byTool, previous, next, gap, lead, accepted }) -> gameObject`
    - **Change from server.js:** `accepted` is now an explicit parameter (was `state.lastUpload?.upstream?.json?.accepted`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/battle-report.test.cjs`:

```js
const test = require("node:test");
const assert = require("assert");
const { rankedTools, buildGame } = require("../../lib/battle-report");

test("rankedTools sorts desc and computes share", () => {
  const ranked = rankedTools({ codex: 30, "claude-code": 70 }, 100);
  assert.equal(ranked[0].name, "claude-code");
  assert.equal(ranked[0].share, 0.7);
  assert.equal(ranked[1].name, "codex");
});

test("buildGame computes level and xp from total", () => {
  const game = buildGame({
    total: 30_000_000, rank: 5, rankDelta: 0,
    byTool: { codex: 30_000_000 }, previous: { name: "A", score: 31_000_000 },
    next: null, gap: 1_000_001, lead: 0, accepted: 0,
  });
  // level = floor(30M / 25M) + 1 = 2
  assert.equal(game.level, 2);
  assert.equal(game.xpMax, 25_000_000);
  assert.equal(game.xp, 30_000_000 % 25_000_000);
});

test("buildGame king branch sets crown quest done", () => {
  const game = buildGame({
    total: 350_000_000, rank: 1, rankDelta: 0,
    byTool: { codex: 350_000_000 }, previous: null,
    next: { name: "Rival", score: 100_000_000 }, gap: 0, lead: 250_000_000, accepted: 3,
  });
  assert.equal(game.quests[0].icon, "crown");
  assert.equal(game.quests[0].done, true);
  assert.equal(game.badges[0].unlocked, true); // King Mode
  assert.equal(game.sync.accepted, 3);
  assert.equal(game.sync.done, true);
});

test("buildGame climber branch when not rank 1", () => {
  const game = buildGame({
    total: 10_000_000, rank: 4, rankDelta: 2,
    byTool: { codex: 10_000_000 }, previous: { name: "Ahead", score: 12_000_000 },
    next: null, gap: 2_000_001, lead: 0, accepted: 0,
  });
  assert.equal(game.quests[0].icon, "trending-up");
  assert.equal(game.quests[0].done, false);
  assert.equal(game.sync.done, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/battle-report.test.cjs`
Expected: FAIL — `Cannot find module '../../lib/battle-report'`

- [ ] **Step 3: Create `lib/battle-report.js`**

Move `rankedTools` (server.js:304-314) and `buildGame` (server.js:316-417) here. Hoist the two
inner consts of buildGame to module level as named constants. Replace the `accepted` line with the param.

```js
const { formatCount, formatPercent, toolLabel, toolIcon } = require("./format");

const LEVEL_SIZE = 25_000_000;
const HIGH_OUTPUT_TARGET = 300_000_000;

function rankedTools(byTool = {}, total = 0) {
  return Object.entries(byTool)
    .map(([name, value]) => ({
      name,
      value: Number(value || 0),
      label: toolLabel(name),
      icon: toolIcon(name),
      share: total > 0 ? Number(value || 0) / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function buildGame({ total, rank, rankDelta, byTool, previous, next, gap, lead, accepted = 0 }) {
  const levelSize = LEVEL_SIZE;
  const highOutputTarget = HIGH_OUTPUT_TARGET;
  const toolRanks = rankedTools(byTool, total);
  const mainTool = toolRanks[0] || { name: "", label: "Main Tool", icon: "terminal", value: 0, share: 0 };
  const runnerUpTool = toolRanks[1] || null;
  const mainLead = runnerUpTool ? Math.max(0, mainTool.value - runnerUpTool.value) : mainTool.value;
  const level = Math.max(1, Math.floor(total / levelSize) + 1);
  const xp = total > 0 ? total % levelSize : 0;
  const xpPct = Math.max(4, Math.round((xp / levelSize) * 100));
  const scoreDone = total >= highOutputTarget;
  const king = rank === 1;
  const rankQuest = king
    ? {
        icon: "crown",
        title: "王座守护：今日总榜第 1",
        detail: next ? `领先 ${next.name} ${formatCount(lead)}` : "当前无人追近",
        rewardLabel: "+800",
        done: true,
      }
    : {
        icon: "trending-up",
        title: "排名冲刺：超过上一名",
        detail: previous ? `距 ${previous.name} 还差 ${formatCount(gap)}` : "等待榜单排名",
        rewardLabel: "+800",
        done: false,
      };

  return {
    level,
    levelTitle: `Builder Lv. ${level}`,
    xp,
    xpMax: levelSize,
    xpPct,
    xpLabel: `${formatCount(xp)} / ${formatCount(levelSize)} XP`,
    codexShare: total > 0 ? Number(byTool.codex || 0) / total : 0,
    codexShareLabel: formatPercent(total > 0 ? Number(byTool.codex || 0) / total : 0),
    mainTool: {
      name: mainTool.name,
      label: mainTool.label,
      value: mainTool.value,
      valueLabel: formatCount(mainTool.value),
      share: mainTool.share,
      shareLabel: formatPercent(mainTool.share),
      leadLabel: formatCount(mainLead),
    },
    quests: [
      rankQuest,
      {
        icon: "target",
        title: "每日任务：冲到 3 亿",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        rewardLabel: "+620",
        done: scoreDone,
      },
      {
        icon: mainTool.icon,
        title: `主力工具：${mainTool.label} Main`,
        detail: runnerUpTool
          ? `领先 ${runnerUpTool.label} ${formatCount(mainLead)}`
          : `${formatPercent(mainTool.share)} share`,
        rewardLabel: "+240",
        done: mainTool.value > 0,
      },
    ],
    badges: [
      {
        icon: "crown",
        title: "King Mode",
        detail: king ? "今日总榜 #1" : rank ? `当前 #${rank}` : "等待排名",
        unlocked: king,
        featured: king,
      },
      {
        icon: "flame",
        title: "High Output",
        detail: `${formatCount(total)} / ${formatCount(highOutputTarget)}`,
        unlocked: scoreDone,
        featured: scoreDone && !king,
      },
      {
        icon: mainTool.icon,
        title: `${mainTool.label} Main`,
        detail: `${formatPercent(mainTool.share)} share`,
        unlocked: mainTool.value > 0,
        featured: false,
      },
      {
        icon: "trending-up",
        title: "Rank Climber",
        detail: rankDelta > 0 ? `上升 ${rankDelta} 名` : king ? "守住第 1" : "等待突破",
        unlocked: rankDelta > 0 || king,
        featured: false,
      },
    ],
    sync: {
      accepted,
      done: accepted > 0,
    },
  };
}

module.exports = { rankedTools, buildGame, LEVEL_SIZE, HIGH_OUTPUT_TARGET };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/battle-report.test.cjs`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/battle-report.js tests/unit/battle-report.test.cjs
git commit -m "feat(lib): extract battle-report (rankedTools/buildGame) with accepted injected"
```

---

### Task 3: `lib/summary.js` — aggregation + leaderboard parsing

**Files:**
- Create: `lib/summary.js`
- Create: `tests/unit/summary.test.cjs`

**Interfaces:**
- Consumes: `lib/format.js` (`formatCount`, `toolLabel`), `lib/battle-report.js` (`buildGame`)
- Produces:
  - `rowsFromPayload(payload) -> rows[]`
  - `rawTokens(row) -> number`
  - `summarizeRows(rows, preferredDate?) -> { date, total, normalized, byTool, rowCount }`
  - `toolsFromMap(byTool) -> Array<{name,value,label,valueLabel,pct}>` (top-6, pct floor 4)
  - `sameToolBreakdown(entryTools, summaryTools) -> boolean`
  - `findOwnEntry(entries, summary, userId) -> entry | undefined` (**userId injected**, was `state.userId`)
  - `computeLeaderboard(entries, summary, previousRank, userId) -> leaderboardObject | null`
    - Returns `null` when own entry not found. Object has NO `updatedAt` (caller injects timestamp).
    - Shape: `{ board:"total", range:"today", entriesCount, own, previous, next, gapToPrevious, leadOverNext, rankDelta }`
  - `buildSummary({ lastUpload, leaderboard }) -> summaryObject` (**state fields injected**, was global `state`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/summary.test.cjs`:

```js
const test = require("node:test");
const assert = require("assert");
const {
  rowsFromPayload, rawTokens, summarizeRows, toolsFromMap,
  sameToolBreakdown, findOwnEntry, computeLeaderboard, buildSummary,
} = require("../../lib/summary");

test("rowsFromPayload handles array/rows/records/garbage", () => {
  assert.deepEqual(rowsFromPayload([1, 2]), [1, 2]);
  assert.deepEqual(rowsFromPayload({ rows: [3] }), [3]);
  assert.deepEqual(rowsFromPayload({ records: [4] }), [4]);
  assert.deepEqual(rowsFromPayload(null), []);
  assert.deepEqual(rowsFromPayload({ nope: 1 }), []);
});

test("rawTokens sums the four token fields", () => {
  assert.equal(rawTokens({ input: 1, output: 2, cache_read: 3, cache_write: 4 }), 10);
  assert.equal(rawTokens({ input: 5 }), 5);
});

test("summarizeRows picks latest date by default and aggregates byTool", () => {
  const rows = [
    { date: "2026-06-22", tool: "codex", input: 100, normalized: 10 },
    { date: "2026-06-23", tool: "codex", input: 200, normalized: 20 },
    { date: "2026-06-23", tool: "claude-code", output: 50, normalized: 5 },
  ];
  const s = summarizeRows(rows);
  assert.equal(s.date, "2026-06-23");
  assert.equal(s.byTool.codex, 200);
  assert.equal(s.byTool["claude-code"], 50);
  assert.equal(s.total, 250);
  assert.equal(s.normalized, 25);
  assert.equal(s.rowCount, 2);
});

test("summarizeRows honors preferredDate when present", () => {
  const rows = [
    { date: "2026-06-22", tool: "codex", input: 100 },
    { date: "2026-06-23", tool: "codex", input: 200 },
  ];
  assert.equal(summarizeRows(rows, "2026-06-22").date, "2026-06-22");
});

test("toolsFromMap caps at 6 and floors pct at 4", () => {
  const map = { a: 100, b: 50, c: 25, d: 12, e: 6, f: 3, g: 1 };
  const tools = toolsFromMap(map);
  assert.equal(tools.length, 6);
  assert.equal(tools[0].pct, 100);
  assert.ok(tools[5].pct >= 4);
});

test("findOwnEntry prefers userId match then falls back to score+byTool", () => {
  const entries = [
    { userId: "u1", score: 100, byTool: { codex: 100 } },
    { userId: "u2", score: 200, byTool: { codex: 200 } },
  ];
  assert.equal(findOwnEntry(entries, { total: 999, byTool: {} }, "u2").userId, "u2");
  const byShape = findOwnEntry(entries, { total: 100, byTool: { codex: 100 } }, "");
  assert.equal(byShape.userId, "u1");
});

test("computeLeaderboard derives rank neighbors, gap and lead", () => {
  const entries = [
    { userId: "a", rank: 1, score: 300, name: "A" },
    { userId: "me", rank: 2, score: 200, name: "Me" },
    { userId: "c", rank: 3, score: 100, name: "C" },
  ];
  const board = computeLeaderboard(entries, { total: 200, byTool: {} }, 4, "me");
  assert.equal(board.own.userId, "me");
  assert.equal(board.previous.userId, "a");
  assert.equal(board.next.userId, "c");
  assert.equal(board.gapToPrevious, 300 - 200 + 1);
  assert.equal(board.leadOverNext, 200 - 100);
  assert.equal(board.rankDelta, 4 - 2);
});

test("computeLeaderboard returns null when own not found", () => {
  const entries = [{ userId: "x", rank: 1, score: 9, name: "X" }];
  assert.equal(computeLeaderboard(entries, { total: 1, byTool: {} }, null, "nobody"), null);
});

test("buildSummary waiting state when no upload", () => {
  const s = buildSummary({ lastUpload: null, leaderboard: null });
  assert.equal(s.waiting, true);
  assert.equal(s.source, "waiting");
  assert.equal(s.totalLabel, "--");
});

test("buildSummary uses leaderboard source when own present", () => {
  const s = buildSummary({
    lastUpload: { summary: { date: "2026-06-23", total: 200, byTool: { codex: 200 } }, upstream: { json: { accepted: 1 }, status: 200 } },
    leaderboard: { own: { rank: 2, score: 200, byTool: { codex: 200 } }, gapToPrevious: 5, leadOverNext: 10, rankDelta: 1, updatedAt: "t" },
  });
  assert.equal(s.source, "leaderboard");
  assert.equal(s.rank, 2);
  assert.equal(s.total, 200);
  assert.equal(s.upstream.accepted, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/summary.test.cjs`
Expected: FAIL — `Cannot find module '../../lib/summary'`

- [ ] **Step 3: Create `lib/summary.js`**

Move `rowsFromPayload` (240-245), `rawTokens` (247-252), `summarizeRows` (254-268),
`toolsFromMap` (270-280), `sameToolBreakdown` (419-423), `findOwnEntry` (425-434),
the parse half of `refreshLeaderboard` (447-472 → `computeLeaderboard`), and `buildSummary` (491-546).
Inject `userId` into `findOwnEntry`/`computeLeaderboard` and `{lastUpload, leaderboard}` into `buildSummary`.

```js
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
```

> **Note on `buildSummary` `accepted`:** original `buildGame` read `state.lastUpload?.upstream?.json?.accepted`. We inject it here from the same `lastUpload`, preserving behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/summary.test.cjs`
Expected: PASS — all tests pass.

- [ ] **Step 5: Run full unit suite**

Run: `npm run test:unit`
Expected: PASS — format + battle-report + summary all green.

- [ ] **Step 6: Commit**

```bash
git add lib/summary.js tests/unit/summary.test.cjs
git commit -m "feat(lib): extract summary aggregation + computeLeaderboard with injected state"
```

---

### Task 4: Rewire `server.js` to consume `lib/`, split `refreshLeaderboard`, guard `listen`

**Files:**
- Modify: `server.js` (remove inline pure functions, require lib, inject at call sites, split refresh, gate listen)

**Interfaces:**
- Consumes: all of `lib/format.js`, `lib/battle-report.js`, `lib/summary.js`.

- [ ] **Step 1: Capture `/api/summary` baseline (before edits)**

Run (uses an alternate port to avoid clobbering any running instance; needs the `opentoken` binary the user has installed):

```bash
OPENTOKEN_ISLAND_PORT=4199 node server.js & SRV=$!; sleep 1; \
curl -s 'http://127.0.0.1:4199/api/summary' | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(Object.keys(j).sort().join(","));console.log("game:"+Object.keys(j.game||{}).sort().join(","))' > /tmp/summary-before.txt; \
kill $SRV; cat /tmp/summary-before.txt
```

Expected: a comma-separated list of top-level keys + `game:` keys. Save this output.

- [ ] **Step 2: Add requires at top of `server.js`**

After the existing `const { execFile } = require("child_process");` line, add:

```js
const { formatCount, formatPercent, toolLabel, toolIcon } = require("./lib/format");
const { rankedTools, buildGame } = require("./lib/battle-report");
const {
  rowsFromPayload, rawTokens, summarizeRows, toolsFromMap,
  sameToolBreakdown, findOwnEntry, computeLeaderboard, buildSummary,
} = require("./lib/summary");
```

- [ ] **Step 3: Delete the now-duplicated inline function definitions from `server.js`**

Delete these definitions (they now live in `lib/`):
- `formatCount` (230-234), `formatPercent` (236-238)
- `rowsFromPayload` (240-245), `rawTokens` (247-252), `summarizeRows` (254-268)
- `toolsFromMap` (270-280), `toolLabel` (282-291), `toolIcon` (293-302), `rankedTools` (304-314)
- `buildGame` (316-417)
- `sameToolBreakdown` (419-423), `findOwnEntry` (425-434)
- the old `buildSummary` (491-546)

Keep `safeJson`, `sleep`, all I/O functions, `accountStatus`, `serviceStatus`, handlers.

- [ ] **Step 4: Replace `buildSummary()` call sites with injected form**

`buildSummary()` is called at server.js (in `handleApi`) three times (`/api/debug/island`, `/api/summary`, `/api/upload`). Replace each bare `buildSummary()` with:

```js
buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard })
```

- [ ] **Step 5: Split `refreshLeaderboard` to use `computeLeaderboard`**

Replace the body of `refreshLeaderboard` (server.js:440-489) with:

```js
const LEADERBOARD_LIMIT = 500;
const LEADERBOARD_MAX_ATTEMPTS = 4;
const LEADERBOARD_RETRY_DELAY_MS = 900;

async function refreshLeaderboard(summary, previousRank = null) {
  const endpoint = `https://scys.com/tokenrank/api/subapp/leaderboard?board=total&range=today&limit=${LEADERBOARD_LIMIT}`;
  let lastResult = null;

  for (let attempt = 0; attempt < LEADERBOARD_MAX_ATTEMPTS; attempt += 1) {
    const result = await requestText("GET", endpoint, "", { accept: "application/json" });
    lastResult = result;
    const entries = Array.isArray(result.json?.entries) ? result.json.entries : [];
    const board = computeLeaderboard(entries, summary, previousRank, state.userId);

    if (board) {
      state.userId = board.own.userId;
      state.leaderboard = { updatedAt: new Date().toISOString(), ...board };
      saveState();
      return state.leaderboard;
    }

    if (attempt < LEADERBOARD_MAX_ATTEMPTS - 1) await sleep(LEADERBOARD_RETRY_DELAY_MS);
  }

  state.leaderboard = {
    updatedAt: new Date().toISOString(),
    board: "total",
    range: "today",
    entriesCount: Array.isArray(lastResult?.json?.entries) ? lastResult.json.entries.length : 0,
    error: lastResult?.error || "Current upload was not found in leaderboard yet",
  };
  saveState();
  return state.leaderboard;
}
```

> The `LEADERBOARD_*` consts go near the top of the file with the other consts (move them out of the function if preferred); shown here adjacent for clarity.

- [ ] **Step 6: Gate the listen + boot side effects**

Replace server.js bottom (724-727):

```js
ensureProxyConfig();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenToken Island proxy running at http://127.0.0.1:${PORT}`);
});
```

with:

```js
if (require.main === module) {
  ensureProxyConfig();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`OpenToken Island proxy running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = { server };
```

- [ ] **Step 7: Smoke-check requireability (no listen, no boot write)**

Run:

```bash
node -e 'const m = require("./server.js"); console.log("required ok, listening:", m.server.listening)'
```

Expected: prints `required ok, listening: false` and exits cleanly (process does not hang on a port).

- [ ] **Step 8: Capture `/api/summary` after, diff against baseline**

Run:

```bash
OPENTOKEN_ISLAND_PORT=4199 node server.js & SRV=$!; sleep 1; \
curl -s 'http://127.0.0.1:4199/api/summary' | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(Object.keys(j).sort().join(","));console.log("game:"+Object.keys(j.game||{}).sort().join(","))' > /tmp/summary-after.txt; \
kill $SRV; diff /tmp/summary-before.txt /tmp/summary-after.txt && echo "SHAPE IDENTICAL"
```

Expected: `SHAPE IDENTICAL` (no diff). If diff appears, a call site was mis-wired — fix before committing.

- [ ] **Step 9: Run unit suite + windows contract**

Run: `npm run test:unit && node tests/windows_support_contract.test.cjs`
Expected: all unit tests pass AND `windows scaffold contract ok`.

- [ ] **Step 10: Commit**

```bash
git add server.js
git commit -m "refactor(server): consume lib modules, split refreshLeaderboard, gate listen behind require.main"
```

---

### Task 5: Distinguish ENOENT vs JSON-parse in `loadState`/`readConfig`; remove dead catch

**Files:**
- Modify: `server.js` (`loadState`, `readConfig`, `accountStatus`)

**Interfaces:** none changed (same signatures, same happy-path returns).

- [ ] **Step 1: Write a failing test for the parse-vs-missing distinction**

Create `tests/unit/store-errors.test.cjs`. We test the helper logic by requiring `server.js` (now side-effect-free) and exercising a small exported helper. Add a pure helper to server.js exports for testability.

First, the test:

```js
const test = require("node:test");
const assert = require("assert");
const { parseJsonFileOrEmpty } = require("../../server.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("returns {} when file is missing (ENOENT)", () => {
  const missing = path.join(os.tmpdir(), "definitely-missing-" + process.pid + ".json");
  assert.deepEqual(parseJsonFileOrEmpty(missing), {});
});

test("throws when file exists but is corrupt JSON", () => {
  const bad = path.join(os.tmpdir(), "corrupt-" + process.pid + ".json");
  fs.writeFileSync(bad, "{not json");
  try {
    assert.throws(() => parseJsonFileOrEmpty(bad), /Failed to parse JSON/);
  } finally {
    fs.unlinkSync(bad);
  }
});

test("parses valid JSON", () => {
  const good = path.join(os.tmpdir(), "good-" + process.pid + ".json");
  fs.writeFileSync(good, '{"webhook_url":"x"}');
  try {
    assert.deepEqual(parseJsonFileOrEmpty(good), { webhook_url: "x" });
  } finally {
    fs.unlinkSync(good);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/store-errors.test.cjs`
Expected: FAIL — `parseJsonFileOrEmpty` is not exported / undefined.

- [ ] **Step 3: Add `parseJsonFileOrEmpty` helper and use it in `loadState`/`readConfig`**

Add this helper in server.js (near the top, after the consts):

```js
function parseJsonFileOrEmpty(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error; // EACCES and other IO problems are real — surface them
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`);
  }
}
```

Replace `loadState` (27-33):

```js
function loadState() {
  return parseJsonFileOrEmpty(STATE_PATH);
}
```

Replace `readConfig` (86-92):

```js
function readConfig() {
  return parseJsonFileOrEmpty(CONFIG_PATH);
}
```

- [ ] **Step 4: Remove the dead try/catch in `accountStatus`**

In `accountStatus`, the regex match cannot throw. Replace (552-555):

```js
  const match = webhook.match(/\/u\/([^/?#]+)/);
  const accountId = match ? match[1] : "";
```

(Delete the surrounding `let accountId = ""; try { ... } catch {}`.)

- [ ] **Step 5: Export the helper for the test**

In the `module.exports` at the bottom of server.js, add `parseJsonFileOrEmpty`:

```js
module.exports = { server, parseJsonFileOrEmpty };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/unit/store-errors.test.cjs`
Expected: PASS — all 3 tests pass.

> **Note:** `isLocalWebhook`'s catch and `findOpenTokenBinary`'s catch are intentionally left unchanged — the first is a predicate (invalid URL → `false`), the second is a candidate probe (inaccessible → try next). Neither is silent error-swallowing.

- [ ] **Step 7: Full regression**

Run: `npm run test:unit && node tests/windows_support_contract.test.cjs`
Expected: all unit tests pass AND `windows scaffold contract ok`.

- [ ] **Step 8: Re-verify requireability + `/api/summary` shape unchanged**

Run:

```bash
node -e 'require("./server.js"); console.log("require ok")'
OPENTOKEN_ISLAND_PORT=4199 node server.js & SRV=$!; sleep 1; \
curl -s 'http://127.0.0.1:4199/api/summary' | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(Object.keys(j).sort().join(","))' > /tmp/summary-final.txt; \
kill $SRV; diff /tmp/summary-before.txt <(head -1 /tmp/summary-final.txt) && echo "SHAPE STILL IDENTICAL"
```

Expected: `require ok` and `SHAPE STILL IDENTICAL`.

- [ ] **Step 9: Commit**

```bash
git add server.js tests/unit/store-errors.test.cjs
git commit -m "refactor(server): distinguish ENOENT vs JSON-parse errors, drop dead catch"
```

---

### Task 6: Final verification + code review

**Files:** none (verification only)

- [ ] **Step 1: Run everything**

```bash
npm run test:unit
node tests/windows_support_contract.test.cjs
node -e 'const m=require("./server.js"); console.log("listening:", m.server.listening)'
```

Expected: all unit tests pass; `windows scaffold contract ok`; `listening: false`.

- [ ] **Step 2: Confirm no leftover inline duplicates in server.js**

```bash
grep -nE "^function (formatCount|formatPercent|rowsFromPayload|rawTokens|summarizeRows|toolsFromMap|toolLabel|toolIcon|rankedTools|buildGame|sameToolBreakdown|findOwnEntry|buildSummary)\b" server.js
```

Expected: NO output (all moved to lib/).

- [ ] **Step 3: Request code review**

Use superpowers:requesting-code-review — dispatch a fresh subagent to review the full diff against `main` for: regressions in `/api/*` shape, leaderboard parsing fidelity (gap/lead/rankDelta/index fallback), the catch behavior change, missing edge tests, and adherence to KISS/SRP. Address actionable findings, then re-review with a fresh subagent until clean.

---

## Self-Review (against spec)

**Spec coverage:**
- require.main gate → Task 4 Step 6 ✓
- pure modules with injection → Tasks 1-3 ✓
- unit tests RED-first → every task ✓
- computeLeaderboard split → Task 3 + Task 4 Step 5 ✓
- catch ENOENT vs parse → Task 5 ✓
- isLocalWebhook kept / accountStatus dead-catch removed → Task 5 Steps 4 + note ✓
- magic numbers named → Task 4 Step 5 ✓
- scripts.test frozen, test:unit added → Task 1 Step 1 + Global Constraints ✓
- windows contract intact → verified Tasks 4/5/6 ✓
- /api shape unchanged → baseline+diff Task 4 Steps 1/8, Task 5 Step 8 ✓

**Placeholder scan:** none — all steps carry real code/commands.

**Type consistency:** `buildSummary({lastUpload, leaderboard})`, `findOwnEntry(entries, summary, userId)`, `computeLeaderboard(entries, summary, previousRank, userId)`, `buildGame({..., accepted})` consistent across Tasks 3/4. `parseJsonFileOrEmpty(filePath)` consistent Task 5. ✓
