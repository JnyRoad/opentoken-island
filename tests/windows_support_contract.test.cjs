const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const pkg = readJson("package.json");
assert.equal(pkg.scripts.test, "node tests/run_all.cjs");
assert.equal(pkg.scripts["tauri:dev"], "tauri dev");
assert.equal(pkg.scripts["tauri:build"], "tauri build");
assert.equal(pkg.devDependencies["@tauri-apps/cli"], "^2.11.3");

const config = readJson("src-tauri/tauri.conf.json");
assert.equal(config.identifier, "com.opentoken.island.windows");
assert.equal(config.productName, "OpenToken Island");
assert.equal(config.build.frontendDist, "../desktop-placeholder");
assert.equal(config.app.withGlobalTauri, false);
assert.equal(config.app.macOSPrivateApi, true);
assert.deepEqual(config.bundle.targets, ["nsis"]);
assert.ok(config.bundle.icon.includes("icons/icon.png"));
assert.ok(config.bundle.icon.includes("icons/icon.ico"));
assert.ok(config.bundle.resources.includes("../lib"));
assert.ok(fs.existsSync(path.join(root, "src-tauri/icons/icon.ico")));

const cargoToml = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
assert.match(cargoToml, /tauri = \{ version = "2"/);
assert.match(cargoToml, /features = \["tray-icon", "image-png", "macos-private-api"\]/);

const mainRs = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
const popoverHtml = fs.readFileSync(path.join(root, "popover.html"), "utf8");
assert.match(
  mainRs,
  /#!\[cfg_attr\(\s*all\(not\(debug_assertions\), target_os = "windows"\),\s*windows_subsystem = "windows"\s*\)\]/,
  "Windows release builds must use GUI subsystem so no cmd window appears"
);
assert.match(
  mainRs,
  /prewarm_windows\(app\.handle\(\)\)\?/,
  "Panel WebView should be created hidden during setup so first tray hover/click is fast"
);
assert.match(
  mainRs,
  /TrayIconEvent::Enter[\s\S]*show_hover_panel/,
  "Tray hover must show the full quota panel when the cursor enters the tray icon"
);
assert.match(
  mainRs,
  /TrayIconEvent::Move[\s\S]*show_hover_panel/,
  "Tray hover should keep the full quota panel aligned while the cursor moves over the tray icon"
);
assert.match(
  mainRs,
  /TrayIconEvent::Leave[\s\S]*schedule_hide_panel/,
  "Tray hover must schedule the panel to hide after the cursor leaves the tray icon"
);
assert.match(
  mainRs,
  /TrayIconEvent::Click[\s\S]*pin_panel/,
  "Left click must pin the panel so it stays visible"
);
assert.match(
  mainRs,
  /MenuItem::with_id\(app, "open-panel", "打开", true, None::<&str>\)/,
  "Tray context menu should use a short open label"
);
assert.match(
  mainRs,
  /MenuItem::with_id\(app, "refresh", "刷新", true, None::<&str>\)/,
  "Tray context menu should include a short refresh label"
);
assert.match(
  mainRs,
  /MenuItem::with_id\(app, "open-browser", "网页", true, None::<&str>\)/,
  "Tray context menu should include a short web label"
);
assert.match(
  mainRs,
  /MenuItem::with_id\(app, "restart-server", "重启服务", true, None::<&str>\)/,
  "Tray context menu should include local server restart"
);
assert.match(
  mainRs,
  /MenuItem::with_id\(app, "quit", "退出", true, None::<&str>\)/,
  "Tray context menu should use the short quit label"
);
assert.deepEqual(
  [...mainRs.matchAll(/MenuItem::with_id\(app, "([^"]+)", "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]),
  [
    ["open-panel", "打开"],
    ["refresh", "刷新"],
    ["open-browser", "网页"],
    ["restart-server", "重启服务"],
    ["quit", "退出"],
  ],
  "Tray context menu should expose only the approved short actions"
);
assert.doesNotMatch(
  mainRs,
  /show-island|open-logs|Show Island|Open Logs|Quit OpenToken Island|Open Browser UI|显示悬浮岛|打开日志/,
  "Tray context menu must not expose removed or long menu labels"
);
assert.match(
  mainRs,
  /fn event_log_path\(now: SystemTime\) -> PathBuf/,
  "Desktop shell event logs should resolve through a daily log path helper"
);
assert.match(
  mainRs,
  /\.join\("logs"\)[\s\S]*island-events-\{year:04\}-\{month:02\}-\{day:02\}\.log/,
  "Desktop shell event logs should be written under .opentoken/logs by UTC day"
);
assert.doesNotMatch(
  mainRs,
  /join\("island-events\.log"\)/,
  "Desktop shell event logs must not keep writing to the legacy root event log"
);
assert.match(
  mainRs,
  /"restart-server" => \{[\s\S]*restart_server\(app\)/,
  "Restart menu item must restart the managed local server"
);
assert.match(
  mainRs,
  /fn stop_server_process\(app: &AppHandle\)/,
  "Quit and restart should share explicit managed server shutdown"
);
assert.match(
  mainRs,
  /WindowEvent::Focused\(false\)[\s\S]*hide_pinned_panel_on_blur/,
  "Pinned tray panel must hide when the user clicks outside and the window loses focus"
);
assert.match(
  mainRs,
  /external_url\("popover\.html"\)[\s\S]*WebviewWindowBuilder::new\(app, PANEL_LABEL/,
  "The tray panel must render the same popover UI used by the browser panel"
);
assert.match(
  mainRs,
  /WebviewWindowBuilder::new\(app, PANEL_LABEL[\s\S]*\.decorations\(false\)[\s\S]*\.transparent\(true\)[\s\S]*\.skip_taskbar\(true\)[\s\S]*\.always_on_top\(true\)/,
  "The tray panel must be a transparent, borderless floating layer"
);
assert.match(
  mainRs,
  /const ISLAND_WIDTH: i32 = 576;/,
  "The island window must include transparent padding around the 560px card"
);
assert.match(
  mainRs,
  /const ISLAND_HEIGHT: i32 = 134;/,
  "The island window must include transparent padding around the 118px card"
);
assert.match(
  mainRs,
  /WebviewWindowBuilder::new\(app, ISLAND_LABEL[\s\S]*\.inner_size\(ISLAND_WIDTH as f64, ISLAND_HEIGHT as f64\)[\s\S]*\.transparent\(true\)[\s\S]*\.shadow\(false\)/,
  "The island must render in a transparent, shadowless, borderless layer sized for the padded card"
);
assert.match(
  mainRs,
  /const PANEL_ANCHOR_GAP: i32 = 430;/,
  "The full tray panel should lift as far as possible above the Windows hidden-icons flyout"
);
assert.match(
  mainRs,
  /floating_position\(\s*app,\s*cursor,\s*rect,\s*PANEL_WINDOW_WIDTH,\s*PANEL_WINDOW_HEIGHT,\s*FLOATING_MARGIN,\s*PANEL_ANCHOR_GAP,?\s*\)/,
  "The full tray panel must use a larger anchor gap than the screen edge clamp margin"
);
assert.doesNotMatch(
  mainRs,
  /show_hover_island/,
  "Hover must not use the short island surface"
);
assert.match(
  popoverHtml,
  /backdrop-filter:blur\(26px\)/,
  "Popover panel should use glass blur for a refined floating surface"
);
assert.match(
  popoverHtml,
  /background:linear-gradient\([^;]+rgba\(18,18,20,\.82\)/,
  "Popover panel should have translucent glass background"
);
assert.match(
  popoverHtml,
  /body\{[^}]*padding:18px/,
  "Popover body should leave enough transparent padding for shadow and rounded corners"
);

console.log("windows scaffold contract ok");
