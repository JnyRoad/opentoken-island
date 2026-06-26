# OpenToken Island

A macOS menu bar companion for OpenToken.

It combines:

- A real macOS status bar item
- A compact Apple-style Dynamic Island event popup
- A popover extension panel with rank, XP, quests, and achievements
- Live data from the local `opentoken` CLI
- Manual upload through `opentoken upload`

## Install Locally

Install the app:

```bash
./scripts/install.sh
```

The installer:

- Finds an existing local `opentoken` binary from `PATH`, `~/.local/bin`, Homebrew, or common app folders
- Reads `~/.opentoken/config.json`
- Stores the original scys upload URL in `~/.opentoken/island-state.json`
- Rewrites `webhook_url` to the local proxy at `http://127.0.0.1:4174/...`
- Builds and installs `/Applications/OpenToken Island.app`
- Registers a login LaunchAgent at `~/Library/LaunchAgents/com.opentoken.island.plist`

After that, OpenToken keeps using its own upload mechanism. OpenToken Island only listens to that upload payload, forwards it to scys, and renders the latest rank/game state.

If `opentoken` is installed in a non-standard location, pass it explicitly:

```bash
OPENTOKEN_BIN="/path/to/opentoken" ./scripts/install.sh
```

The local API port defaults to `4174`; override it with `OPENTOKEN_ISLAND_PORT=4175` if needed.

## Windows GUI

Windows support is implemented as a Tauri tray shell around the existing local proxy and Web UI. It does not require .NET SDK.

See [docs/windows-gui.md](docs/windows-gui.md) for setup, development, and build commands.

## Build Installer Package

Build a local macOS installer package:

```bash
./scripts/build-pkg.sh
```

The package installs `OpenToken Island.app` into `/Applications`, writes the user LaunchAgent, and starts the menu bar app after install. The App icon is generated from the circular SCYS symbol in `assets/scys/icon_topnav.png`.

## Debug Island Popup

Trigger the Dynamic Island popup once:

```bash
TOKEN="$(curl -sS "http://127.0.0.1:4174/api/client-config" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).apiToken')"
curl -sS -X POST \
  -H "x-opentoken-island-token: ${TOKEN}" \
  "http://127.0.0.1:4174/api/debug/island"
```

Watch the listener log:

```bash
tail -f ~/.opentoken/logs/island-events-$(date -u +%F).log
```

## Files

- `OpenTokenIsland.swift` - native AppKit menu bar shell
- `server.js` - local API bridge to the `opentoken` CLI
- `popover.html` - extension popover UI
- `island.html` - Dynamic Island notification UI
- `index.html` - original browser prototype kept for design review
- `scripts/install.sh` - local installer and OpenToken detector
- `scripts/build-pkg.sh` - macOS `.pkg` installer builder
