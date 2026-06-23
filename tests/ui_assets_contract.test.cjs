const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("desktop HTML uses only bundled runtime scripts", () => {
  for (const file of ["index.html", "popover.html", "island.html"]) {
    const html = read(file);
    assert.doesNotMatch(html, /https:\/\/unpkg\.com\/lucide/);
    assert.match(html, /assets\/vendor\/lucide-lite\.js/);
  }
  assert.ok(fs.existsSync(path.join(root, "assets/vendor/lucide-lite.js")));
});

test("popover exposes only wired action buttons", () => {
  const html = read("popover.html");
  assert.doesNotMatch(html, />Pause</);
  assert.match(html, /id="shareButton"/);
  assert.match(html, /id="refreshButton"/);
  assert.match(html, /id="openLogsButton"/);

  const vendorScript = read("assets/vendor/lucide-lite.js");
  assert.match(vendorScript, /"share-2"/);
});

test("browser prototype sends local API token for upload", () => {
  const html = read("index.html");
  assert.match(html, /client-config/);
  assert.match(html, /x-opentoken-island-token/);
  assert.doesNotMatch(html, /fetch\(`\$\{API_BASE\}\/upload`, \{ method: "POST" \}\)/);
});

test("browser prototype renders API tool labels without innerHTML", () => {
  const html = read("index.html");
  assert.match(html, /toolList\.replaceChildren\(\.\.\.rows\)/);
  assert.match(html, /name\.textContent =/);
  assert.match(html, /value\.textContent =/);
  assert.doesNotMatch(html, /toolList\.innerHTML\s*=/);
});

test("mac app bundle includes the full assets directory", () => {
  const installScript = read("scripts/install.sh");
  assert.match(installScript, /cp -R "\$\{ROOT_DIR\}\/assets"/);
  assert.doesNotMatch(installScript, /Resources\/assets\/scys\/icon_topnav\.png/);
});

test("popover constrains quest icons so artwork cannot cover copy", () => {
  const html = read("popover.html");
  assert.match(html, /\.quest svg\{width:18px;height:18px/);
  assert.match(html, /\.quest\s*\{/);
  assert.doesNotMatch(html, /\.quest svg\{width:\s*100%/);
});

test("popover refreshes when upload events arrive and after manual upload", () => {
  const html = read("popover.html");
  assert.match(html, /window\.OpenTokenIslandRefresh\s*=/);
  assert.match(html, /pollIslandEvent/);
  assert.match(html, /setInterval\(pollIslandEvent,\s*2000\)/);
  assert.match(html, /waitForFreshSummary/);
});

test("manual popover upload stops waiting when the upload command fails", () => {
  const html = read("popover.html");
  assert.match(html, /!response\.ok \|\| !result \|\| result\.ok === false/);
  assert.match(html, /Upload failed; check logs/);
});

test("popover labels estimated ranks instead of treating them as confirmed", () => {
  const html = read("popover.html");
  assert.match(html, /data\.rankEstimated/);
  assert.match(html, /预计排名/);
  assert.match(html, /等待官网确认/);
});

test("popover uses clear Chinese status labels instead of gamified badge jargon", () => {
  const html = read("popover.html");
  assert.match(html, /今日进度/);
  assert.match(html, /总榜排名/);
  assert.match(html, /今日目标/);
  assert.match(html, /主力工具/);
  assert.match(html, /上传状态/);
  assert.doesNotMatch(html, /Builder Lv|High Output|King Mode|Codex Main|Rank Climber|Hot Streak|Late Builder|>done</);
});

test("native status event refreshes the open popover webview", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /private var popoverWebView: WKWebView\?/);
  assert.match(swift, /refreshPopoverContent\(\)/);
  assert.match(swift, /evaluateJavaScript\("window\.OpenTokenIslandRefresh/);
});

test("native upload-captured events refresh without forcing an island popup", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /let showIsland = event\["showIsland"\] as\? Bool \?\? true/);
  assert.match(swift, /if showIsland \{\s*self\.showIsland/);
});

test("island banner labels estimated ranks as pending confirmation", () => {
  const html = read("island.html");
  assert.match(html, /data\.rankEstimated/);
  assert.match(html, /等待榜单确认/);
});
