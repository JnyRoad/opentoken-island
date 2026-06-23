const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const pkg = readJson("package.json");
assert.equal(pkg.scripts.test, "node tests/windows_support_contract.test.cjs");
assert.equal(pkg.scripts["tauri:dev"], "tauri dev");
assert.equal(pkg.scripts["tauri:build"], "tauri build");
assert.equal(pkg.devDependencies["@tauri-apps/cli"], "^2.11.3");

const config = readJson("src-tauri/tauri.conf.json");
assert.equal(config.identifier, "com.opentoken.island.windows");
assert.equal(config.productName, "OpenToken Island");
assert.equal(config.build.frontendDist, "../desktop-placeholder");
assert.equal(config.app.withGlobalTauri, false);
assert.deepEqual(config.bundle.targets, ["nsis"]);
assert.ok(config.bundle.icon.includes("icons/icon.png"));
assert.ok(config.bundle.icon.includes("icons/icon.ico"));
assert.ok(fs.existsSync(path.join(root, "src-tauri/icons/icon.ico")));

const cargoToml = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
assert.match(cargoToml, /tauri = \{ version = "2"/);
assert.match(cargoToml, /features = \["tray-icon", "image-png"\]/);

const mainRs = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
assert.match(
  mainRs,
  /#!\[cfg_attr\(\s*all\(not\(debug_assertions\), target_os = "windows"\),\s*windows_subsystem = "windows"\s*\)\]/,
  "Windows release builds must use GUI subsystem so no cmd window appears"
);
assert.match(
  mainRs,
  /prewarm_windows\(app\.handle\(\)\)\?/,
  "Panel and hover WebViews should be created hidden during setup so first tray click is fast"
);
assert.match(
  mainRs,
  /TrayIconEvent::Enter/,
  "Tray hover must show the quota island when the cursor enters the tray icon"
);
assert.match(
  mainRs,
  /TrayIconEvent::Move/,
  "Tray hover should keep the quota island aligned while the cursor moves over the tray icon"
);
assert.match(
  mainRs,
  /TrayIconEvent::Leave/,
  "Tray hover must schedule the quota island to hide after the cursor leaves the tray icon"
);
assert.match(
  mainRs,
  /schedule_hide_island/,
  "Tray hover should hide via a delayed scheduler instead of immediately closing the WebView"
);

console.log("windows scaffold contract ok");
