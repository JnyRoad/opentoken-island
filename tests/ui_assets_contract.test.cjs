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
  const utils = read("assets/client-utils.js");
  // client-config endpoint and token header live in the shared utility included by all views
  assert.match(utils, /client-config/);
  assert.match(utils, /x-opentoken-island-token/);
  assert.match(html, /client-utils\.js/); // confirms the utility is loaded
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

test("client surfaces log every wired action and polling flow", () => {
  const popover = read("popover.html");
  const browser = read("index.html");
  const island = read("island.html");
  const poster = read("assets/share-poster.js");

  for (const event of [
    "popover.upload.click",
    "popover.share.click",
    "popover.refresh.click",
    "popover.openLogs.click",
    "popover.summary.load",
    "popover.islandEvent.poll",
  ]) {
    assert.match(popover, new RegExp(event.replaceAll(".", "\\.")));
  }

  for (const event of [
    "prototype.variant.click",
    "prototype.event.click",
    "prototype.panel.click",
    "prototype.upload.click",
    "prototype.escape.keydown",
  ]) {
    assert.match(browser, new RegExp(event.replaceAll(".", "\\.")));
  }

  assert.match(island, /island\.summary\.load/);
  assert.match(poster, /poster\.download\.start/);
  assert.match(poster, /poster\.download\.complete/);
});

test("client click actions do not await logging before the main action", () => {
  const popover = read("popover.html");
  const browser = read("index.html");
  const island = read("island.html");

  assert.doesNotMatch(popover, /await logClientEvent\('popover\.(upload|share|refresh|openLogs)\.click'/);
  assert.match(popover, /void logClientEvent\('popover\.upload\.click'/);
  assert.match(popover, /void logClientEvent\('popover\.share\.click'/);
  assert.match(browser, /void logClientEvent\("prototype\.upload\.click"/);
  assert.match(island, /void logClientEvent\('island\.summary\.load'/);
});

test("native app log lines use the shared JSON event schema", () => {
  const swift = read("OpenTokenIsland.swift");

  assert.match(swift, /JSONSerialization\.data\(withJSONObject: entry/);
  assert.match(swift, /sanitizeLogString/);
  assert.match(swift, /"layer": "app"/);
  assert.match(swift, /"event": safeEvent/);
  assert.match(swift, /logIsland\("event\.detected", details:/);
  assert.doesNotMatch(swift, /logIsland\("[^"]*\\\(/);
  assert.doesNotMatch(swift, /layer=app/);
});

test("poll failure logging is rate limited", () => {
  const popover = read("popover.html");
  const swift = read("OpenTokenIsland.swift");

  assert.match(popover, /lastIslandEventFailureLogAt/);
  assert.match(popover, /now - lastIslandEventFailureLogAt > 60000/);
  assert.match(swift, /lastEventPollFailureLogAt/);
  assert.match(swift, /timeIntervalSince\(lastEventPollFailureLogAt\) >= 60/);
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

test("popover removes the redundant bottom badge grid", () => {
  const html = read("popover.html");
  assert.match(html, /今日进度/);
  assert.match(html, /今日总榜/);
  assert.match(html, /今日目标/);
  assert.match(html, /上传状态/);
  assert.doesNotMatch(html, /class="badges"/);
  assert.doesNotMatch(html, /\.badges\{/);
  assert.doesNotMatch(html, /class="badge/);
  assert.doesNotMatch(html, /renderBadges/);
  assert.doesNotMatch(html, />主力工具</);
  assert.doesNotMatch(html, /Builder Lv|High Output|King Mode|Codex Main|Rank Climber|Hot Streak|Late Builder|>done</);
});

test("native status event refreshes the open popover webview", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /private var popoverWebView: WKWebView\?/);
  assert.match(swift, /refreshPopoverContent\(\)/);
  assert.match(swift, /evaluateJavaScript\("window\.OpenTokenIslandRefresh/);
});

test("native app exposes a single-item poster clipboard bridge", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /WKScriptMessageHandlerWithReply/);
  assert.match(swift, /WKWebViewConfiguration\(\)/);
  assert.match(swift, /userContentController\.addScriptMessageHandler\(self,\s*contentWorld:\s*\.page,\s*name:\s*"openTokenClipboard"\)/);
  assert.match(swift, /userContentController\.addScriptMessageHandler\(self,\s*contentWorld:\s*\.page,\s*name:\s*"openTokenPosterSnapshot"\)/);
  assert.match(swift, /func userContentController\(_ userContentController: WKUserContentController,\s*didReceive message: WKScriptMessage,\s*replyHandler: @escaping \(Any\?, String\?\) -> Void\)/);
  assert.match(swift, /message\.name == "openTokenClipboard"/);
  assert.match(swift, /NSPasteboard\.general/);
  assert.match(swift, /pasteboard\.clearContents\(\)/);
  assert.match(swift, /pasteboard\.setData\(data,\s*forType:\s*\.png\)/);
  assert.match(swift, /replyHandler\(\["ok": true\], nil\)/);
  assert.match(swift, /replyHandler\(nil, "pasteboard-write-failed"\)/);
  assert.doesNotMatch(swift, /pasteboard\.writeObjects\(\[.*URL/);
});

test("native app renders poster HTML snapshots at fixed export size", () => {
  const swift = read("OpenTokenIsland.swift");
  assert.match(swift, /private var posterSnapshotJobs = \[PosterSnapshotJob\]\(\)/);
  assert.match(swift, /message\.name == "openTokenPosterSnapshot"/);
  assert.match(swift, /PosterSnapshotJob\(/);
  assert.match(swift, /WKWebView\(frame: NSRect\(x: 0, y: 0, width: width, height: height\)/);
  assert.match(swift, /webView\.loadHTMLString\(html, baseURL: Bundle\.main\.resourceURL\)/);
  assert.match(swift, /WKSnapshotConfiguration\(\)/);
  assert.match(swift, /snapshotConfig\.snapshotWidth = NSNumber\(value: Int\(width\)\)/);
  assert.match(swift, /webView\.takeSnapshot\(with: snapshotConfig\)/);
  assert.match(swift, /representation\(using: \.png/);
  assert.match(swift, /base64EncodedString\(\)/);
  assert.match(swift, /replyHandler\(\["ok": true, "type": "image\/png", "base64": base64\], nil\)/);
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
  assert.match(swift, /webView\.wantsLayer = true/);
  assert.match(swift, /webView\.layer\?\.backgroundColor = NSColor\.clear\.cgColor/);
  assert.match(swift, /webView\.setValue\(false, forKey: "drawsBackground"\)/);
  assert.doesNotMatch(swift, /webView\.isOpaque = false/);
  assert.doesNotMatch(swift, /webView\.scrollView/);
});
