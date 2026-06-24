const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function cssRuleDeclarations(html, selector) {
  const rules = [...html.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const match = rules.find((rule) => rule[1].trim() === selector);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return Object.fromEntries(
    match[2]
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const [property, ...valueParts] = declaration.split(":");
        return [property.trim(), valueParts.join(":").trim().replace(/\s+/g, " ")];
      })
  );
}

function splitCssTopLevelList(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
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

test("island banner leaves transparent chrome and avoids corner artwork", () => {
  const html = read("island.html");
  const rootStyle = cssRuleDeclarations(html, "html,body");
  const bodyStyle = cssRuleDeclarations(html, "body");
  const islandStyle = cssRuleDeclarations(html, ".island");
  const islandShadows = splitCssTopLevelList(islandStyle["box-shadow"]);

  assert.equal(rootStyle.background, "transparent");
  assert.equal(bodyStyle.padding, "8px");
  assert.equal(islandStyle.width, "calc(100vw - 16px)");
  assert.equal(islandStyle.height, "calc(100vh - 16px)");
  assert.ok(islandShadows.every((shadow) => shadow.startsWith("inset ")));
  assert.doesNotMatch(html, /class="spark/);
  assert.doesNotMatch(html, /class="mark/);
  assert.doesNotMatch(html, /assets\/scys\/icon_topnav\.png/);
});

test("native island window is sized for transparent padding and clears WKWebView chrome", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /let width: CGFloat = 576/);
  assert.match(swift, /let height: CGFloat = 134/);
  assert.match(swift, /panel\.isOpaque = false/);
  assert.match(swift, /panel\.backgroundColor = \.clear/);
  assert.match(swift, /panel\.hasShadow = false/);
  assert.match(swift, /webView\.isOpaque = false/);
  assert.match(swift, /webView\.scrollView\.drawsBackground = false/);
  assert.match(swift, /webView\.scrollView\.backgroundColor = \.clear/);
});
