#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="OpenToken Island"
APP_DIR="${APP_DIR:-/Applications/${APP_NAME}.app}"
BUILD_DIR="${ROOT_DIR}/build"
BUILD_APP="${BUILD_DIR}/${APP_NAME}.app"
PORT="${OPENTOKEN_ISLAND_PORT:-4174}"
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
  <string>OpenTokenIsland</string>
  <key>CFBundleName</key>
  <string>OpenToken Island</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
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

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
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
const state = readJson(statePath);
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
  local logo="${ROOT_DIR}/assets/scys/icon_topnav.png"
  local source_icon="${BUILD_DIR}/app-icon-source.png"
  local iconset="${BUILD_DIR}/OpenTokenIsland.iconset"
  local output_icon="${BUILD_APP}/Contents/Resources/OpenTokenIsland.icns"
  local logo_width
  local logo_height
  local crop_size
  local horizontal_offset

  logo_width="$(sips -g pixelWidth "${logo}" 2>/dev/null | awk '/pixelWidth:/ {print $2}')"
  logo_height="$(sips -g pixelHeight "${logo}" 2>/dev/null | awk '/pixelHeight:/ {print $2}')"
  [[ -n "${logo_width}" && -n "${logo_height}" ]] || die "could not read logo size from ${logo}"

  crop_size="${logo_height}"
  horizontal_offset=$(( crop_size / 2 - logo_width / 2 ))

  rm -rf "${iconset}"
  mkdir -p "${iconset}"
  sips -c "${crop_size}" "${crop_size}" --cropOffset 0 "${horizontal_offset}" \
    "${logo}" --out "${source_icon}" >/dev/null

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
  iconutil -c icns "${iconset}" -o "${output_icon}"
}

build_app() {
  rm -rf "${BUILD_APP}"
  mkdir -p "${BUILD_APP}/Contents/MacOS" \
    "${BUILD_APP}/Contents/Resources/assets/scys"

  swiftc "${ROOT_DIR}/OpenTokenIsland.swift" -framework Cocoa -framework WebKit \
    -o "${BUILD_APP}/Contents/MacOS/${APP_NAME}"

  cp "${ROOT_DIR}/popover.html" \
    "${ROOT_DIR}/island.html" \
    "${ROOT_DIR}/server.js" \
    "${BUILD_APP}/Contents/Resources/"
  cp "${ROOT_DIR}/assets/scys/icon_topnav.png" \
    "${BUILD_APP}/Contents/Resources/assets/scys/icon_topnav.png"
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
    <string>/usr/bin/open</string>
    <string>-g</string>
    <string>${APP_DIR}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.opentoken/island.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.opentoken/island.launchd.log</string>
</dict>
</plist>
PLIST

  launchctl bootout "gui/$(id -u)" "${LAUNCH_AGENT_PATH}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "${LAUNCH_AGENT_PATH}"
  launchctl enable "gui/$(id -u)/com.opentoken.island"
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

  open -g "${APP_DIR}"
  sleep 2

  printf '\nInstalled %s\n' "${APP_DIR}"
  printf 'LaunchAgent: %s\n' "${LAUNCH_AGENT_PATH}"
  printf 'Local API: http://127.0.0.1:%s/api/summary\n' "${PORT}"

  if "${opentoken_bin}" service status >/dev/null 2>&1; then
    printf 'OpenToken daemon: running or installed\n'
  else
    printf 'OpenToken daemon: status check failed; run `opentoken service status` if uploads do not arrive.\n'
  fi
}

main "$@"
