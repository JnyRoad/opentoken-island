# server.js 纯逻辑抽取与可测化 — 设计文档

- 日期：2026-06-23
- 状态：待 review
- 范围：`server.js` 增量重构，不改变 happy-path 对外行为

## 背景与事实校准

`server.js`（727 行）是 god-file：底部 `ensureProxyConfig()` + `server.listen()` 是顶层副作用，任何
`require` 都会启动服务并写 `~/.opentoken`，导致内部纯逻辑无法单测。

**校准任务前提（原始需求有两处与仓库现状不符）：**

1. `lib/battle-report.js` / `lib/format.js` **当前不存在**，从未抽取过。本次是**第一次抽取**，非延续。
2. 参考测试 `tests/battle-report.test.cjs` **不存在**；现有唯一测试是
   `tests/windows_support_contract.test.cjs`，断言风格为 `require("assert")` + 顶层断言 +
   `console.log("... ok")`。新测试 mirror 此风格。
3. `windows_support_contract` 测试**不引用 server.js**，只校验 package.json / tauri.conf /
   Cargo.toml / main.rs / popover.html，因此重构 server.js 天然不破它。

**隐藏约束（关键）：** 该合约测试第 9 行硬断言
`pkg.scripts.test === "node tests/windows_support_contract.test.cjs"`。
→ **禁止修改 `package.json` 的 `test` 脚本**。新 unit 测试走独立入口
`test:unit`（`node --test tests/unit/`，Node v24 原生支持）。

## 目标

1. 启动副作用包进 `if (require.main === module)`，使 server.js 可被 `require` 而不 listen、不写盘。
2. 纯计算逻辑抽进 `lib/` 三个单一职责模块，**全部参数注入，零全局 `state` 读取**。
3. 给抽出的纯逻辑补 unit 测试（RED 先行）。
4. 空 catch 按「可恢复 vs 异常」分情况处理（见下，**非一刀切**）。
5. `refreshLeaderboard` 的抓取参数提为具名常量。

## 非目标（YAGNI）

- 不拆 I/O 层（config / store / http / proxy / run / routing / static / listen）。对可测性无额外收益、回归面大。
- 不改超时常量（30000 / 120000 / 15000）等需求未点名的魔法值。
- 不改 `/api/*` 的 happy-path 行为、不改前端、不改 Tauri/Windows 相关。

## 模块设计（三件套，纯函数、参数注入）

### `lib/format.js` — 展示原语
```
formatCount(value) -> string          // 亿/万/round
formatPercent(value) -> string        // NaN/Infinity -> "0%"
toolLabel(name) -> string             // 已知映射 + 兜底 humanize
toolIcon(name) -> string              // 已知映射 + 兜底 "terminal"
```

### `lib/battle-report.js` — 游戏化层（buildGame）
```
buildGame({ total, rank, rankDelta, byTool, previous, next, gap, lead, accepted }) -> game
```
- 关键改动：原 `buildGame` 第 323 行偷读 `state.lastUpload?.upstream?.json?.accepted`。
  改为**显式参数 `accepted`**注入。
- 内部常量 `LEVEL_SIZE = 25_000_000`、`HIGH_OUTPUT_TARGET = 300_000_000` 随之移入本模块。
- 依赖 `lib/format.js`。

### `lib/summary.js` — 汇总与榜单解析
```
rowsFromPayload(payload) -> rows[]
rawTokens(row) -> number
summarizeRows(rows, preferredDate?) -> { date, total, normalized, byTool, rowCount }
toolsFromMap(byTool) -> tool[]                       // top-6, pct 下限 4, 降序
rankedTools(byTool, total) -> ranked[]               // share 计算, 降序
sameToolBreakdown(entryTools, summaryTools) -> bool
findOwnEntry(entries, summary, userId) -> entry|undefined   // userId 由参数注入(原读 state.userId)
computeLeaderboard(entries, summary, previousRank, userId) -> leaderboard
    // 从 refreshLeaderboard 抽出的纯解析: own/previous/next/gapToPrevious/leadOverNext/rankDelta
    // 不含 HTTP/重试/存盘/时间戳; updatedAt 由调用方(server.js)注入
buildSummary({ lastUpload, leaderboard }) -> summary  // 原读全局 state, 改为参数注入
```
- 依赖 `lib/format.js`、`lib/battle-report.js`。

## server.js 改动

1. **启动 gate**：第 724-727 包进 `if (require.main === module) { ensureProxyConfig(); server.listen(...) }`。
2. **`refreshLeaderboard` 拆分**：保留 HTTP 请求 + 重试循环 + `saveState` + `new Date().toISOString()`；
   循环内解析改调 `computeLeaderboard(entries, summary, previousRank, state.userId)`，
   并把 `updatedAt` 在 server.js 侧注入。`state.userId = own.userId` 等存盘动作仍在 server.js。
3. **注入点接线**：
   - `buildSummary()` 调用处改 `buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard })`。
   - `buildGame(...)`（在 buildSummary 内）补 `accepted: state.lastUpload?.upstream?.json?.accepted`。
4. **catch 分情况处理**：
   - `loadState`：`ENOENT` → 返回 `{}`；JSON 解析失败 → **抛出**（含路径，快速失败，避免静默丢 userId/leaderboard）。
   - `readConfig`：同上规则（`ENOENT` → `{}`，解析失败 → 抛出）。
   - `isLocalWebhook`：**保留**——非法 URL 是谓词的合法 `false`，非吞错；可窄化只 catch URL 构造错误。
   - `accountStatus` 内 `try{ match }catch{}`：**删除**——`String.prototype.match` 不抛，是死代码。
   - `findOpenTokenBinary` 的 `accessSync` catch：**保留**——探测候选，不可访问即试下一个。
5. **具名常量**（refreshLeaderboard）：
   ```
   const LEADERBOARD_LIMIT = 500;
   const LEADERBOARD_MAX_ATTEMPTS = 4;
   const LEADERBOARD_RETRY_DELAY_MS = 900;
   ```
   endpoint 用 `LEADERBOARD_LIMIT` 拼接；循环 `attempt < LEADERBOARD_MAX_ATTEMPTS`；
   `sleep(LEADERBOARD_RETRY_DELAY_MS)`；`attempt < LEADERBOARD_MAX_ATTEMPTS - 1` 时才 sleep。

## 行为变化登记（不属于 happy-path，但必须记录）

| 触发条件 | 旧行为 | 新行为 | 理由 |
|---|---|---|---|
| `~/.opentoken/island-state.json` JSON 损坏 | 启动静默重置为 `{}` | 启动**警告(stderr) + 回退 `{}`** | state 是服务自写的可重建缓存；截断写不该让 app 开不了机；警告满足"非静默" |
| `~/.opentoken/config.json` JSON 损坏 | 请求路径静默当 `{}` | 触达 `readConfig` 的请求**抛错** | config 是用户手写的关键配置，解析失败必须暴露 |
| 任一文件为空（中断写产物） | 抛错被吞 → `{}` | 显式视为 `{}` | 空文件不是"损坏 JSON" |

**为何 state 与 config 不对称**（code review 反馈采纳）：state 文件丢失=下次上传即可重建的缓存损失，把它的损坏升级成"宕机"得不偿失；config 文件是 webhook 等关键用户输入，错了就该 fast-fail。两者都**不静默**：state 走响亮 stderr 警告，config 走抛错。

文件缺失（首次运行）行为**不变**：仍返回 `{}`。Happy-path（文件合法 JSON，本服务自己写的）行为**完全不变**。

## 测试策略（TDD，RED 先行）

入口：`tests/unit/*.test.cjs`，`package.json` 新增 `"test:unit": "node --test tests/unit/"`
（`scripts.test` 保持不动以满足 windows 合约）。

RED 覆盖清单：
- `format.test.cjs`：formatCount（亿/万/round 边界、0、负数）、formatPercent（NaN/Infinity→0%、四舍五入）、
  toolLabel/toolIcon（已知映射 + 兜底 humanize）。
- `summary.test.cjs`：rowsFromPayload（array/rows/records/垃圾输入）、rawTokens、
  summarizeRows（preferredDate 命中/未命中取最新日期、byTool 聚合、rowCount）、
  toolsFromMap（top-6 截断、pct 下限 4、降序）、rankedTools（share、降序）、
  sameToolBreakdown、findOwnEntry（userId 命中优先 / 回退 score+byTool 匹配）、
  computeLeaderboard（own 命中、previous/next、gap/lead、rankDelta、rank===1 边界、own 未命中）。
- `battle-report.test.cjs`：buildGame（level/xp 数学、king vs climber quest 分支、badges 解锁、
  accepted 注入影响 sync.done）。
- `summary.test.cjs` 内 buildSummary：waiting 态、source 选择（leaderboard/upload/waiting）、标签格式化。

流程：先写以上失败测试（模块未建）→ GREEN：建 lib/ 三件套并接线 server.js →
REFACTOR：常量、catch 修复 → 全绿 + `node tests/windows_support_contract.test.cjs` 仍过。

## 风险

- `computeLeaderboard` 抽取时 own 的 `index` 回退逻辑（`entries[index-1]` / `entries[index+1]`）需逐行保真，
  否则排名边界回归。→ 用快照式断言锁定。
- catch 行为变化若线上已有损坏文件会导致启动失败——属预期的快速失败，已登记。
- 接线遗漏（buildGame 的 accepted / buildSummary 的注入）会让 sync/total 字段悄悄变空。
  → unit 测试 + 重构后手动跑一次 `/api/summary` 形状对比兜底。
