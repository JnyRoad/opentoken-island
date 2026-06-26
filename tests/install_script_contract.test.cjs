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

function installProxyNodeScript() {
  const installScript = read("scripts/install.sh");
  const functionStart = installScript.indexOf("configure_opentoken_proxy() {");
  assert.notEqual(functionStart, -1);
  const start = installScript.indexOf("<<'NODE'\n", functionStart);
  const end = installScript.indexOf("\nNODE\n", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return installScript.slice(start + "<<'NODE'\n".length, end);
}

function runInstallProxyNode(configPath, statePath) {
  return spawnSync(process.execPath, [
    "-",
    configPath,
    statePath,
    "/tmp/opentoken",
    process.execPath,
    "4999",
  ], {
    input: installProxyNodeScript(),
    encoding: "utf8",
  });
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

test("installer does not silently replace corrupt OpenToken config JSON", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-install-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const statePath = path.join(directory, "island-state.json");
  fs.writeFileSync(configPath, "{not json");
  fs.writeFileSync(statePath, JSON.stringify({
    upstreamUrl: "https://scys.com/tokenrank/api/subapp/u/account",
  }));

  const result = runInstallProxyNode(configPath, statePath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Failed to parse JSON/);
  assert.equal(fs.readFileSync(configPath, "utf8"), "{not json");
});

test("installer tolerates corrupt island state cache without replacing config", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-install-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const statePath = path.join(directory, "island-state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    webhook_url: "https://scys.com/tokenrank/api/subapp/u/account?date=today",
  }));
  fs.writeFileSync(statePath, "{not json");

  const result = runInstallProxyNode(configPath, statePath);

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.match(result.stderr, /warning: ignoring corrupt JSON/);
  assert.equal(config.webhook_url, "http://127.0.0.1:4999/tokenrank/api/subapp/u/account?date=today");
  assert.equal(state.upstreamUrl, "https://scys.com/tokenrank/api/subapp/u/account?date=today");
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

test("installer stops stale bundled server processes before starting the LaunchAgent", () => {
  const installScript = read("scripts/install.sh");
  const cleanupStart = installScript.indexOf("stop_stale_server_processes() {");
  const installLaunchAgent = installScript.lastIndexOf("  install_launch_agent");
  const cleanupCall = installScript.lastIndexOf("  stop_stale_server_processes");

  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupCall, -1);
  assert.notEqual(installLaunchAgent, -1);
  assert.ok(cleanupCall < installLaunchAgent, "stale bundled server cleanup must run before launching the new agent");

  const cleanupEnd = installScript.indexOf("\n}\n", cleanupStart);
  const cleanup = installScript.slice(cleanupStart, cleanupEnd);
  const cleanupSection = installScript.slice(cleanupStart, installLaunchAgent);
  assert.match(installScript, /need_command lsof/);
  assert.match(cleanup, /stale_server_pids/);
  assert.match(cleanupSection, /lsof -nP -t -iTCP:"\$\{PORT\}" -sTCP:LISTEN/);
  assert.match(cleanupSection, /is_opentoken_island_server_process "\$\{pid\}"/);
  assert.match(cleanupSection, /OpenToken Island\.app\/Contents\/Resources\/server\.js/);
  assert.match(cleanup, /kill "\$\{pid\}"/);
  assert.match(cleanup, /kill -KILL "\$\{pid\}"/);
  assert.match(cleanup, /pids="\$\(stale_server_pids\)"\s*while IFS= read -r pid;/);
  assert.match(cleanup, /remaining_pids="\$\(stale_server_pids\)"/);
  assert.match(cleanup, /ps -o pid= -o command= -p/);
  assert.match(cleanup, /die "stale OpenToken Island server processes are still running:/);
  assert.doesNotMatch(cleanupSection, /pgrep -f/);
});

test("installer stale server matcher accepts only OpenToken Island node server commands", () => {
  const installScript = read("scripts/install.sh");
  const matcherStart = installScript.indexOf("is_opentoken_island_server_process() {");
  const matcherEnd = installScript.indexOf("\n}\n\ninstall_launch_agent", matcherStart);
  assert.notEqual(matcherStart, -1);
  assert.notEqual(matcherEnd, -1);

  const matcher = installScript.slice(matcherStart, matcherEnd + 3).replace(
    /command="\$\(ps -ww -o command= -p "\$\{pid\}" 2>\/dev\/null \|\| true\)"/,
    'command="${MOCK_COMMAND:-}"'
  );
  const bash = [
    "set -euo pipefail",
    matcher,
    "is_opentoken_island_server_process 123",
  ].join("\n");

  function matches(command) {
    const result = spawnSync("bash", ["-c", bash], {
      env: { ...process.env, MOCK_COMMAND: command },
      encoding: "utf8",
    });
    return result.status === 0;
  }

  assert.equal(matches("node /Applications/OpenToken Island.app/Contents/Resources/server.js"), true);
  assert.equal(matches("/usr/bin/env node /Users/me/Applications/OpenToken Island.app/Contents/Resources/server.js"), true);
  assert.equal(matches("/opt/homebrew/bin/node /Users/me/Applications/OpenToken Island.app/Contents/Resources/server.js"), true);
  assert.equal(matches("python /Users/me/Applications/OpenToken Island.app/Contents/Resources/server.js"), false);
  assert.equal(matches("node /tmp/server.js"), false);
  assert.equal(matches("node /Users/me/Applications/OpenToken Island.app/Contents/Resources/server.js --extra"), false);
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
