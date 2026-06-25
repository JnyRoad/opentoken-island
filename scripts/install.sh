#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="OpenToken Island"
APP_DIR="${APP_DIR:-/Applications/${APP_NAME}.app}"
BUILD_DIR="${ROOT_DIR}/build"
BUILD_APP="${BUILD_DIR}/${APP_NAME}.app"
PORT="${OPENTOKEN_ISLAND_PORT:-4174}"
UPLOAD_TIMEOUT_MS="${OPENTOKEN_ISLAND_UPLOAD_TIMEOUT_MS:-60000}"
CONFIG_PATH="${HOME}/.opentoken/config.json"
STATE_PATH="${HOME}/.opentoken/island-state.json"
LAUNCH_AGENT_PATH="${HOME}/Library/LaunchAgents/com.opentoken.island.plist"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

find_opentoken() {
  if [[ -n "${OPENTOKEN_BIN:-}" && -x "${OPENTOKEN_BIN}" ]]; then
    printf '%s\n' "${OPENTOKEN_BIN}"
    return 0
  fi

  if command -v opentoken >/dev/null 2>&1; then
    command -v opentoken
    return 0
  fi

  local candidates=(
    "${HOME}/.local/bin/opentoken"
    "/opt/homebrew/bin/opentoken"
    "/usr/local/bin/opentoken"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  local roots=(
    "${HOME}/.opentoken"
    "${HOME}/.local"
    "${HOME}/Applications"
    "/Applications"
    "/opt/homebrew"
    "/usr/local"
  )
  local root found
  for root in "${roots[@]}"; do
    [[ -d "${root}" ]] || continue
    found="$(find "${root}" -maxdepth 5 -type f -name opentoken -perm -111 2>/dev/null | head -n 1 || true)"
    if [[ -n "${found}" ]]; then
      printf '%s\n' "${found}"
      return 0
    fi
  done

  return 1
}

write_info_plist() {
  mkdir -p "${BUILD_APP}/Contents"
  cat > "${BUILD_APP}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>OpenToken Island</string>
  <key>CFBundleIdentifier</key>
  <string>com.opentoken.island</string>
  <key>CFBundleIconFile</key>
  <string>OpenTokenIslandBrand</string>
  <key>CFBundleName</key>
  <string>OpenToken Island</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.1</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST
}

configure_opentoken_proxy() {
  local opentoken_bin="$1"
  local node_bin="$2"
  mkdir -p "${HOME}/.opentoken"

  [[ -f "${CONFIG_PATH}" ]] || die "OpenToken config not found at ${CONFIG_PATH}. Install/connect opentoken first, then rerun this installer."

  "${node_bin}" - "${CONFIG_PATH}" "${STATE_PATH}" "${opentoken_bin}" "${node_bin}" "${PORT}" <<'NODE'
const fs = require("fs");
const path = require("path");

const [configPath, statePath, opentokenBin, nodeBin, port] = process.argv.slice(2);
const upstreamOrigin = "https://scys.com";

function readJson(file, { fallback = {}, tolerateCorruption = false } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (readError) {
    if (readError.code === "ENOENT") return fallback;
    throw readError;
  }
  if (raw.trim() === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch (parseError) {
    // The installer may rebuild its own island state cache, but it must not
    // silently replace the user's OpenToken config when that file is corrupt.
    if (tolerateCorruption) {
      console.warn(`warning: ignoring corrupt JSON at ${file}, using empty state: ${parseError.message}`);
      return fallback;
    }
    throw new Error(`Failed to parse JSON at ${file}: ${parseError.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function isLocalWebhook(webhook) {
  try {
    const url = new URL(webhook);
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function localWebhookFor(upstreamUrl) {
  const upstream = new URL(upstreamUrl);
  return `http://127.0.0.1:${port}${upstream.pathname}${upstream.search}`;
}

function upstreamFromLocal(localUrl) {
  const local = new URL(localUrl);
  return `${upstreamOrigin}${local.pathname}${local.search}`;
}

const config = readJson(configPath);
const state = readJson(statePath, { tolerateCorruption: true });
const currentWebhook = String(config.webhook_url || "");

if (!currentWebhook && !state.upstreamUrl) {
  throw new Error(`No webhook_url found in ${configPath}`);
}

const upstreamUrl = currentWebhook
  ? (isLocalWebhook(currentWebhook) ? (state.upstreamUrl || upstreamFromLocal(currentWebhook)) : currentWebhook)
  : state.upstreamUrl;
const localWebhookUrl = localWebhookFor(upstreamUrl);

config.webhook_url = localWebhookUrl;
writeJson(configPath, config);

writeJson(statePath, {
  ...state,
  opentokenBin,
  nodeBin,
  upstreamUrl,
  localWebhookUrl,
  installedAt: new Date().toISOString(),
});

console.log(`opentoken: ${opentokenBin}`);
console.log(`upstream:  ${upstreamUrl}`);
console.log(`local:     ${localWebhookUrl}`);
NODE
}

build_app_icon() {
  local symbol="${ROOT_DIR}/assets/scys/icon_symbol.png"
  local source_icon="${BUILD_DIR}/app-icon-source.png"
  local icon_maker="${BUILD_DIR}/make-app-icon.swift"
  local icon_maker_bin="${BUILD_DIR}/make-app-icon"
  local iconset="${BUILD_DIR}/OpenTokenIsland.iconset"
  local output_icon="${BUILD_APP}/Contents/Resources/OpenTokenIslandBrand.icns"

  rm -rf "${iconset}"
  mkdir -p "${iconset}"

  cat > "${icon_maker}" <<'SWIFT'
import AppKit

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let canvasSize: CGFloat = 1024
let symbolSize: CGFloat = 660
let canvas = NSImage(size: NSSize(width: canvasSize, height: canvasSize))

guard let symbol = NSImage(contentsOfFile: inputPath) else {
    fatalError("Could not load symbol image")
}
guard
    let symbolTiff = symbol.tiffRepresentation,
    let sourceRep = NSBitmapImageRep(data: symbolTiff),
    let goldRep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: sourceRep.pixelsWide,
        pixelsHigh: sourceRep.pixelsHigh,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )
else {
    fatalError("Could not read symbol pixels")
}
let symbolSourceRect = NSRect(x: 0, y: 0, width: sourceRep.pixelsWide, height: sourceRep.pixelsHigh)

let brandGreen = NSColor(calibratedRed: 0x36 / 255.0, green: 0xA5 / 255.0, blue: 0x90 / 255.0, alpha: 1)
let brandGold = NSColor(calibratedRed: 0xF1 / 255.0, green: 0xD8 / 255.0, blue: 0xA8 / 255.0, alpha: 1)

for y in 0..<sourceRep.pixelsHigh {
    for x in 0..<sourceRep.pixelsWide {
        guard let color = sourceRep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
        let brightness = max(color.redComponent, color.greenComponent, color.blueComponent)
        let alpha = brightness > 0.06
            ? min(1, (brightness - 0.06) / 0.32) * color.alphaComponent
            : 0
        goldRep.setColor(brandGold.withAlphaComponent(alpha), atX: x, y: y)
    }
}
let goldSymbol = NSImage(size: NSSize(width: sourceRep.pixelsWide, height: sourceRep.pixelsHigh))
goldSymbol.addRepresentation(goldRep)

canvas.lockFocus()
brandGreen.setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize), xRadius: 220, yRadius: 220).fill()

NSColor(calibratedWhite: 0, alpha: 0.12).setStroke()
let border = NSBezierPath(roundedRect: NSRect(x: 24, y: 24, width: canvasSize - 48, height: canvasSize - 48), xRadius: 198, yRadius: 198)
border.lineWidth = 24
border.stroke()

let symbolRect = NSRect(
    x: (canvasSize - symbolSize) / 2,
    y: (canvasSize - symbolSize) / 2,
    width: symbolSize,
    height: symbolSize
)
goldSymbol.draw(in: symbolRect, from: symbolSourceRect, operation: .sourceOver, fraction: 1)
canvas.unlockFocus()

guard
    let tiff = canvas.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fatalError("Could not render app icon")
}

try png.write(to: URL(fileURLWithPath: outputPath))
SWIFT
  swiftc "${icon_maker}" -framework AppKit -o "${icon_maker_bin}"
  "${icon_maker_bin}" "${symbol}" "${source_icon}" 2>/dev/null

  sips -z 16 16 "${source_icon}" --out "${iconset}/icon_16x16.png" >/dev/null
  sips -z 32 32 "${source_icon}" --out "${iconset}/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "${source_icon}" --out "${iconset}/icon_32x32.png" >/dev/null
  sips -z 64 64 "${source_icon}" --out "${iconset}/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "${source_icon}" --out "${iconset}/icon_128x128.png" >/dev/null
  sips -z 256 256 "${source_icon}" --out "${iconset}/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "${source_icon}" --out "${iconset}/icon_256x256.png" >/dev/null
  sips -z 512 512 "${source_icon}" --out "${iconset}/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "${source_icon}" --out "${iconset}/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "${source_icon}" --out "${iconset}/icon_512x512@2x.png" >/dev/null
  if iconutil -c icns "${iconset}" -o "${output_icon}"; then
    return 0
  fi

  local installed_icon="/Applications/OpenToken Island.app/Contents/Resources/OpenTokenIslandBrand.icns"
  if [[ -f "${installed_icon}" ]]; then
    cp "${installed_icon}" "${output_icon}"
    printf 'warning: iconutil rejected generated iconset; reused installed app icon.\n' >&2
    return 0
  fi

  printf 'warning: iconutil rejected generated iconset; continuing without a custom app icon.\n' >&2
}

build_app() {
  rm -rf "${BUILD_APP}"
  mkdir -p "${BUILD_APP}/Contents/MacOS" \
    "${BUILD_APP}/Contents/Resources"

  swiftc "${ROOT_DIR}/OpenTokenIsland.swift" -framework Cocoa -framework WebKit \
    -o "${BUILD_APP}/Contents/MacOS/${APP_NAME}"

  cp "${ROOT_DIR}/popover.html" \
    "${ROOT_DIR}/island.html" \
    "${ROOT_DIR}/server.js" \
    "${BUILD_APP}/Contents/Resources/"
  cp -R "${ROOT_DIR}/lib" \
    "${BUILD_APP}/Contents/Resources/lib"
  cp -R "${ROOT_DIR}/assets" \
    "${BUILD_APP}/Contents/Resources/assets"
  build_app_icon
  write_info_plist
}

install_app() {
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  rm -rf "${APP_DIR}"
  cp -R "${BUILD_APP}" "${APP_DIR}"
}

install_launch_agent() {
  mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/.opentoken"
  cat > "${LAUNCH_AGENT_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opentoken.island</string>
  <key>ProgramArguments</key>
  <array>
    <string>${APP_DIR}/Contents/MacOS/${APP_NAME}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${HOME}/.opentoken/island.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.opentoken/island.launchd.log</string>
</dict>
</plist>
PLIST

  local domain
  local service
  domain="gui/$(id -u)"
  service="${domain}/com.opentoken.island"
  launchctl bootout "${domain}" "${LAUNCH_AGENT_PATH}" >/dev/null 2>&1 || true
  launchctl enable "${service}"
  launchctl bootstrap "${domain}" "${LAUNCH_AGENT_PATH}"
  launchctl kickstart -k "${service}"
}

wait_for_local_api() {
  local node_bin="$1"
  "${node_bin}" - "http://127.0.0.1:${PORT}/api/health" <<'NODE'
const http = require("http");

const healthUrl = process.argv[2];
const deadline = Date.now() + 15000;
const intervalMs = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probe() {
  return new Promise((resolve) => {
    const request = http.get(healthUrl, { timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitUntilReady() {
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await delay(intervalMs);
  }
  return false;
}

waitUntilReady().then((ready) => {
  process.exit(ready ? 0 : 1);
});
NODE
}

prime_initial_upload() {
  local opentoken_bin="$1"
  local node_bin="$2"
  printf 'Initial upload: '
  if "${node_bin}" - "${opentoken_bin}" "${UPLOAD_TIMEOUT_MS}" <<'NODE'
const { spawn } = require("child_process");

const [opentokenBin, timeoutMsRaw] = process.argv.slice(2);
const timeoutMs = Number(timeoutMsRaw);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  process.exit(1);
}

const upload = spawn(opentokenBin, ["upload"], { stdio: "ignore" });
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  process.exit(code);
}

const timer = setTimeout(() => {
  if (finished) return;
  upload.kill("SIGTERM");
  setTimeout(() => upload.kill("SIGKILL"), 2000).unref();
}, timeoutMs);
timer.unref();

upload.on("error", () => finish(1));
upload.on("exit", (code) => finish(code === 0 ? 0 : 1));
NODE
  then
    printf 'captured\n'
    return 0
  fi

  printf 'failed; click Upload now or wait for the next daemon upload.\n'
  return 0
}

main() {
  need_command swiftc
  need_command node
  need_command sips
  need_command iconutil

  local opentoken_bin
  local node_bin
  opentoken_bin="$(find_opentoken)" || die "could not find an installed opentoken binary"
  node_bin="$(command -v node)"

  configure_opentoken_proxy "${opentoken_bin}" "${node_bin}"
  build_app
  install_app
  install_launch_agent

  if wait_for_local_api "${node_bin}"; then
    prime_initial_upload "${opentoken_bin}" "${node_bin}"
  else
    printf 'Initial upload: local API was not ready; click Upload now or wait for the next daemon upload.\n'
  fi

  printf '\nInstalled %s\n' "${APP_DIR}"
  printf 'LaunchAgent: %s\n' "${LAUNCH_AGENT_PATH}"
  printf 'Local API: http://127.0.0.1:%s/api/summary\n' "${PORT}"

  if "${opentoken_bin}" service status >/dev/null 2>&1; then
    printf 'OpenToken daemon: running or installed\n'
  else
    printf "OpenToken daemon: status check failed; run \`opentoken service status\` if uploads do not arrive.\n"
  fi
}

if [[ "${1:-}" == "--build-app-only" ]]; then
  need_command swiftc
  need_command sips
  need_command iconutil
  build_app
  printf 'Built %s\n' "${BUILD_APP}"
  exit 0
fi

main "$@"
