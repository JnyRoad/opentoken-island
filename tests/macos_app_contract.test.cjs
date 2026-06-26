const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("native shell logs node server launch failures instead of swallowing them", () => {
  const swift = read("OpenTokenIsland.swift");
  const startServer = swift.slice(
    swift.indexOf("private func startServer()"),
    swift.indexOf("private func detectedNodeBinary")
  );

  assert.match(startServer, /do\s*\{\s*try process\.run\(\)/);
  assert.match(startServer, /catch\s*\{/);
  assert.match(startServer, /logIsland\("server\.launch\.failed", details: \["error": error\.localizedDescription\]\)/);
  assert.doesNotMatch(startServer, /try\? process\.run\(\)/);
});

test("native shell restarts the child node server after unexpected exits", () => {
  const swift = read("OpenTokenIsland.swift");
  const startServer = swift.slice(
    swift.indexOf("private func startServer()"),
    swift.indexOf("private func detectedNodeBinary")
  );
  const terminate = swift.slice(
    swift.indexOf("func applicationWillTerminate"),
    swift.indexOf("private func setupStatusItem")
  );
  const prepareForQuit = swift.slice(
    swift.indexOf("private func prepareForQuit()"),
    swift.indexOf("private func stopServerProcess")
  );

  assert.match(swift, /private var isTerminating = false/);
  assert.match(swift, /private func scheduleServerRestart\(reason: String\)/);
  assert.match(terminate, /prepareForQuit\(\)/);
  assert.match(prepareForQuit, /isTerminating = true/);
  assert.match(startServer, /guard self\.serverProcess === process else \{\s*return\s*\}/);
  assert.match(startServer, /self\.serverProcess = nil/);
  assert.match(startServer, /self\.scheduleServerRestart\(reason: "server-exit"\)/);
  assert.match(startServer, /scheduleServerRestart\(reason: "launch-failed"\)/);
});

test("native shell does not restart stale or port-conflict server exits", () => {
  const swift = read("OpenTokenIsland.swift");
  const startServer = swift.slice(
    swift.indexOf("private func startServer()"),
    swift.indexOf("private func detectedNodeBinary")
  );

  assert.match(swift, /private let serverPortInUseExitCode: Int32 = 98/);
  assert.match(startServer, /guard self\.serverProcess === process else \{\s*return\s*\}/);
  assert.match(startServer, /if status == self\.serverPortInUseExitCode \{/);
  assert.match(startServer, /self\.logIsland\("server\.portInUse", details: \["port": self\.port\]\)/);
  assert.match(startServer, /return\s*\}\s*self\.scheduleServerRestart\(reason: "server-exit"\)/);
});

test("native status menu uses short recovery actions without logs or island item", () => {
  const swift = read("OpenTokenIsland.swift");
  const setupStatusItem = swift.slice(
    swift.indexOf("private func setupStatusItem()"),
    swift.indexOf("private func setupPopover()")
  );

  assert.match(setupStatusItem, /NSMenuItem\(title: "打开", action: #selector\(openPanelNow\), keyEquivalent: "o"\)/);
  assert.match(setupStatusItem, /NSMenuItem\(title: "刷新", action: #selector\(refreshNow\), keyEquivalent: "r"\)/);
  assert.match(setupStatusItem, /NSMenuItem\(title: "网页", action: #selector\(openWebNow\), keyEquivalent: "w"\)/);
  assert.match(setupStatusItem, /NSMenuItem\(title: "重启服务", action: #selector\(restartServerNow\), keyEquivalent: "s"\)/);
  assert.match(setupStatusItem, /NSMenuItem\(title: "退出", action: #selector\(quit\), keyEquivalent: "q"\)/);
  assert.match(setupStatusItem, /contextMenu\.addItem\(NSMenuItem\.separator\(\)\)/);
  const menuTitles = [...setupStatusItem.matchAll(/NSMenuItem\(title: "([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(menuTitles, ["打开", "刷新", "网页", "重启服务", "退出"]);
  assert.doesNotMatch(setupStatusItem, /Show Island|Open Logs|Quit OpenToken Island|Open Browser UI|显示悬浮岛|打开日志/);
});

test("native status item routes right click through the status button action", () => {
  const swift = read("OpenTokenIsland.swift");
  const setupStatusItem = swift.slice(
    swift.indexOf("private func setupStatusItem()"),
    swift.indexOf("private func setupPopover()")
  );
  const handleClick = swift.slice(
    swift.indexOf("@objc private func handleStatusItemClick()"),
    swift.indexOf("private func showPopover()")
  );

  assert.match(setupStatusItem, /button\.action = #selector\(handleStatusItemClick\)/);
  assert.match(setupStatusItem, /button\.sendAction\(on: \[\.leftMouseUp, \.rightMouseUp\]\)/);
  assert.doesNotMatch(setupStatusItem, /NSClickGestureRecognizer|buttonMask|addGestureRecognizer/);
  assert.match(handleClick, /NSApp\.currentEvent\?\.type == \.rightMouseUp/);
  assert.match(handleClick, /showContextMenu\(\)/);
  assert.match(handleClick, /togglePopover\(\)/);
});

test("native menu can restart the local server without showing the island", () => {
  const swift = read("OpenTokenIsland.swift");
  const restartServerNow = swift.slice(
    swift.indexOf("@objc private func restartServerNow()"),
    swift.indexOf("@objc private func quit()")
  );
  const refreshNow = swift.slice(
    swift.indexOf("@objc private func refreshNow()"),
    swift.indexOf("@objc private func openWebNow()")
  );

  assert.match(restartServerNow, /logIsland\("menu\.restartServer\.clicked"\)/);
  assert.match(restartServerNow, /stopServerProcess\(reason: "menu-restart"\)/);
  assert.match(restartServerNow, /self\.startServer\(\)/);
  assert.doesNotMatch(refreshNow, /showIsland/);
});

test("native shell writes event logs into daily files", () => {
  const swift = read("OpenTokenIsland.swift");
  const logIsland = swift.slice(
    swift.indexOf("private func logIsland("),
    swift.indexOf("\n}", swift.indexOf("private func logIsland("))
  );

  assert.doesNotMatch(swift, /private let eventLogDayFormatter: DateFormatter/);
  assert.match(logIsland, /\.appendingPathComponent\("logs"\)/);
  assert.match(logIsland, /let timestamp = ISO8601DateFormatter\(\)\.string\(from: now\)/);
  assert.match(logIsland, /island-events-\\\(String\(timestamp\.prefix\(10\)\)\)\.log/);
  assert.match(logIsland, /"at": timestamp/);
  assert.doesNotMatch(logIsland, /appendingPathComponent\("island-events\.log"\)/);
});

test("native quit menu item performs explicit shutdown before app termination", () => {
  const swift = read("OpenTokenIsland.swift");
  const quit = swift.slice(
    swift.indexOf("@objc private func quit()"),
    swift.indexOf("@objc private func showContextMenu")
  );
  const prepareForQuit = swift.slice(
    swift.indexOf("private func prepareForQuit()"),
    swift.indexOf("private func stopServerProcess")
  );

  assert.match(quit, /logIsland\("menu\.quit\.clicked"\)/);
  assert.match(quit, /prepareForQuit\(\)/);
  assert.match(quit, /NSApp\.terminate\(nil\)/);
  assert.match(prepareForQuit, /isTerminating = true/);
  assert.match(prepareForQuit, /timer\?\.invalidate\(\)/);
  assert.match(prepareForQuit, /eventTimer\?\.invalidate\(\)/);
  assert.match(prepareForQuit, /popover\.performClose\(nil\)/);
  assert.match(prepareForQuit, /islandWindow\?\.orderOut\(nil\)/);
  assert.match(prepareForQuit, /stopServerProcess\(reason: "quit"\)/);
  assert.match(swift, /import Darwin/);
  assert.match(swift, /kill\(process\.processIdentifier, SIGKILL\)/);
});
