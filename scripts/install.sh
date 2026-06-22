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
    <string>-a</string>
    <string>${APP_NAME}</string>
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

  local opentoken_bin
  local node_bin
  opentoken_bin="$(find_opentoken)" || die "could not find an installed opentoken binary"
  node_bin="$(command -v node)"

  configure_opentoken_proxy "${opentoken_bin}" "${node_bin}"
  build_app
  install_app
  install_launch_agent

  open -a "${APP_NAME}"
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
