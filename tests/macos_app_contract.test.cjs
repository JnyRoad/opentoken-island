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
  assert.match(startServer, /logIsland\("server launch failed error=\\\(error\.localizedDescription\)"\)/);
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

  assert.match(swift, /private var isTerminating = false/);
  assert.match(swift, /private func scheduleServerRestart\(reason: String\)/);
  assert.match(terminate, /isTerminating = true/);
  assert.match(startServer, /if self\.serverProcess === process \{\s*self\.serverProcess = nil\s*\}/);
  assert.match(startServer, /self\.scheduleServerRestart\(reason: "server-exit"\)/);
  assert.match(startServer, /scheduleServerRestart\(reason: "launch-failed"\)/);
});
