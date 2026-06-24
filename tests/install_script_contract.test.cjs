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

test("installer script is executable because build-pkg invokes it directly", () => {
  const mode = fs.statSync(path.join(root, "scripts", "install.sh")).mode;
  assert.ok(mode & 0o111, "scripts/install.sh must keep an executable bit");
});

test("installer primes an initial upload after the local API is ready", () => {
  const installScript = read("scripts/install.sh");
  const installLaunchAgent = installScript.lastIndexOf("  install_launch_agent");
  const waitForApi = installScript.indexOf('wait_for_local_api "${node_bin}"');
  const primeUpload = installScript.indexOf('prime_initial_upload "${opentoken_bin}" "${node_bin}"');

  assert.notEqual(installLaunchAgent, -1);
  assert.notEqual(waitForApi, -1);
  assert.notEqual(primeUpload, -1);
  assert.ok(installLaunchAgent < waitForApi, "LaunchAgent must start the app before polling its local API");
  assert.ok(waitForApi < primeUpload, "upload must run only after the local API is ready");
  assert.doesNotMatch(installScript, /open -g "\$\{APP_DIR\}"/);
  assert.match(installScript, /UPLOAD_TIMEOUT_MS="\$\{OPENTOKEN_ISLAND_UPLOAD_TIMEOUT_MS:-60000\}"/);
  assert.match(installScript, /spawn\(opentokenBin, \["upload"\], \{ stdio: "ignore" \}\)/);
  assert.match(installScript, /setTimeout\(\(\) =>/);
  assert.match(installScript, /click Upload now or wait for the next daemon upload/);
});

test("LaunchAgent tracks the app process and relaunches after abnormal exits", () => {
  const installScript = read("scripts/install.sh");
  const launchAgentStart = installScript.indexOf("install_launch_agent() {");
  const launchAgentEnd = installScript.indexOf("  launchctl bootout", launchAgentStart);
  const launchAgent = installScript.slice(launchAgentStart, launchAgentEnd);

  assert.notEqual(launchAgentStart, -1);
  assert.match(launchAgent, /\$\{APP_DIR\}\/Contents\/MacOS\/\$\{APP_NAME\}/);
  assert.doesNotMatch(launchAgent, /<string>\/usr\/bin\/open<\/string>/);
  assert.doesNotMatch(launchAgent, /<string>-g<\/string>/);
  assert.match(launchAgent, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
});

test("installer re-enables and kickstarts the LaunchAgent before waiting for the API", () => {
  const installScript = read("scripts/install.sh");
  const launchAgentStart = installScript.indexOf("install_launch_agent() {");
  const launchAgentEnd = installScript.indexOf("wait_for_local_api()", launchAgentStart);
  const launchAgent = installScript.slice(launchAgentStart, launchAgentEnd);
  const enable = launchAgent.indexOf('launchctl enable "${service}"');
  const bootstrap = launchAgent.indexOf('launchctl bootstrap "${domain}" "${LAUNCH_AGENT_PATH}"');
  const kickstart = launchAgent.indexOf('launchctl kickstart -k "${service}"');
  const waitForApi = installScript.indexOf('wait_for_local_api "${node_bin}"');
  const installLaunchAgent = installScript.lastIndexOf("  install_launch_agent");

  assert.notEqual(enable, -1);
  assert.notEqual(bootstrap, -1);
  assert.notEqual(kickstart, -1);
  assert.ok(enable < bootstrap, "persistent disabled state must be cleared before bootstrap");
  assert.ok(bootstrap < kickstart, "kickstart should run after the agent is bootstrapped");
  assert.ok(installLaunchAgent < waitForApi, "agent must be kickstarted before polling the API");
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
