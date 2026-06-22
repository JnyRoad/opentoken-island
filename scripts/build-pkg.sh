#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="OpenToken Island"
APP_PATH="/Applications/${APP_NAME}.app"
IDENTIFIER="com.opentoken.island"
VERSION="${VERSION:-0.1.1}"
BUILD_DIR="${ROOT_DIR}/build"
BUILD_APP="${BUILD_DIR}/${APP_NAME}.app"
PAYLOAD_ROOT="${BUILD_DIR}/pkg-root"
SCRIPTS_DIR="${BUILD_DIR}/pkg-scripts"
COMPONENT_PKG="${BUILD_DIR}/${APP_NAME}.component.pkg"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/dist}"
OUTPUT_PKG="${OUTPUT_DIR}/${APP_NAME}-${VERSION}.pkg"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

write_postinstall() {
  mkdir -p "${SCRIPTS_DIR}"
  cat > "${SCRIPTS_DIR}/postinstall" <<'SCRIPT'
#!/bin/sh
set -eu

APP_PATH="/Applications/OpenToken Island.app"
LABEL="com.opentoken.island"
CONSOLE_USER="$(/usr/bin/stat -f "%Su" /dev/console 2>/dev/null || true)"

if [ -z "${CONSOLE_USER}" ] || [ "${CONSOLE_USER}" = "root" ] || [ ! -d "${APP_PATH}" ]; then
  exit 0
fi

USER_UID="$(/usr/bin/id -u "${CONSOLE_USER}")"
USER_HOME="$(/usr/bin/dscl . -read "/Users/${CONSOLE_USER}" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
LAUNCH_AGENT_DIR="${USER_HOME}/Library/LaunchAgents"
LAUNCH_AGENT_PATH="${LAUNCH_AGENT_DIR}/${LABEL}.plist"

/bin/mkdir -p "${LAUNCH_AGENT_DIR}" "${USER_HOME}/.opentoken"

/bin/cat > "${LAUNCH_AGENT_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-g</string>
    <string>${APP_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${USER_HOME}/.opentoken/island.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${USER_HOME}/.opentoken/island.launchd.log</string>
</dict>
</plist>
PLIST

/usr/sbin/chown "${CONSOLE_USER}" "${LAUNCH_AGENT_PATH}"
/bin/chmod 644 "${LAUNCH_AGENT_PATH}"

/bin/launchctl bootout "gui/${USER_UID}" "${LAUNCH_AGENT_PATH}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/${USER_UID}" "${LAUNCH_AGENT_PATH}" >/dev/null 2>&1 || true
/bin/launchctl enable "gui/${USER_UID}/${LABEL}" >/dev/null 2>&1 || true
/bin/launchctl kickstart -k "gui/${USER_UID}/${LABEL}" >/dev/null 2>&1 \
  || /bin/launchctl asuser "${USER_UID}" /usr/bin/open -g "${APP_PATH}" >/dev/null 2>&1 \
  || true

exit 0
SCRIPT
  chmod 755 "${SCRIPTS_DIR}/postinstall"
}

main() {
  need_command pkgbuild
  need_command productbuild

  "${ROOT_DIR}/scripts/install.sh" --build-app-only

  rm -rf "${PAYLOAD_ROOT}" "${SCRIPTS_DIR}" "${COMPONENT_PKG}"
  mkdir -p "${PAYLOAD_ROOT}/Applications" "${OUTPUT_DIR}"
  ditto "${BUILD_APP}" "${PAYLOAD_ROOT}${APP_PATH}"
  write_postinstall

  pkgbuild \
    --root "${PAYLOAD_ROOT}" \
    --scripts "${SCRIPTS_DIR}" \
    --identifier "${IDENTIFIER}" \
    --version "${VERSION}" \
    --install-location "/" \
    "${COMPONENT_PKG}"

  productbuild \
    --package "${COMPONENT_PKG}" \
    "${OUTPUT_PKG}"

  printf 'Built installer: %s\n' "${OUTPUT_PKG}"
}

main "$@"
