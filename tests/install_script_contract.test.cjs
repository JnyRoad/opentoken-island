const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("installer primes an initial upload after the local API is ready", () => {
  const installScript = read("scripts/install.sh");
  const openApp = installScript.indexOf('open -g "${APP_DIR}"');
  const waitForApi = installScript.indexOf('wait_for_local_api "${node_bin}"');
  const primeUpload = installScript.indexOf('prime_initial_upload "${opentoken_bin}" "${node_bin}"');

  assert.notEqual(waitForApi, -1);
  assert.notEqual(primeUpload, -1);
  assert.ok(openApp < waitForApi, "the app must be opened before polling its local API");
  assert.ok(waitForApi < primeUpload, "upload must run only after the local API is ready");
  assert.match(installScript, /UPLOAD_TIMEOUT_MS="\$\{OPENTOKEN_ISLAND_UPLOAD_TIMEOUT_MS:-60000\}"/);
  assert.match(installScript, /spawn\(opentokenBin, \["upload"\], \{ stdio: "ignore" \}\)/);
  assert.match(installScript, /setTimeout\(\(\) =>/);
  assert.match(installScript, /click Upload now or wait for the next daemon upload/);
});

test("macOS app shell compiles with the WebKit APIs used by the installer", { skip: process.platform !== "darwin" }, (t) => {
  const swiftc = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
  if (swiftc.status !== 0) {
    t.skip("swiftc is not available on this machine");
    return;
  }

  const outputPath = path.join(
    os.tmpdir(),
    `opentoken-island-swift-compile-${process.pid}`
  );
  const result = spawnSync("swiftc", [
    path.join(root, "OpenTokenIsland.swift"),
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-o",
    outputPath,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});
