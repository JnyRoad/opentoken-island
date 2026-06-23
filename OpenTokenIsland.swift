import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var popoverWebView: WKWebView?
    private var islandWindow: NSPanel?
    private var serverProcess: Process?
    private var timer: Timer?
    private var eventTimer: Timer?
    private let contextMenu = NSMenu()
    private let port = 4174
    private var lastIslandEventId: Int64 = 0
    private var unlockedBadgeTitles = Set<String>()
    private var didLoadInitialSnapshot = false
    private var didLoadIslandEventSnapshot = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NSApp.applicationIconImage = symbolImage(size: 256)
        logIsland("app launched")
        startServer()
        setupStatusItem()
        setupPopover()
        updateStatusTitle()
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.updateStatusTitle()
        }
        eventTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.checkIslandEvent()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.checkIslandEvent()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        logIsland("app terminating")
        timer?.invalidate()
        eventTimer?.invalidate()
        serverProcess?.terminate()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }
        button.image = symbolImage(size: 18)
        button.imagePosition = .imageLeft
        button.title = " -- #--"
        button.action = #selector(togglePopover)
        button.target = self

        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshNow), keyEquivalent: "r")
        refreshItem.target = self
        contextMenu.addItem(refreshItem)
        let islandItem = NSMenuItem(title: "Show Island", action: #selector(showIslandNow), keyEquivalent: "i")
        islandItem.target = self
        contextMenu.addItem(islandItem)
        let quitItem = NSMenuItem(title: "Quit OpenToken Island", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        contextMenu.addItem(quitItem)
        statusItem.menu = nil

        let rightClick = NSClickGestureRecognizer(target: self, action: #selector(showContextMenu(_:)))
        rightClick.buttonMask = 0x2
        button.addGestureRecognizer(rightClick)
    }

    private func setupPopover() {
        let viewController = NSViewController()
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 430, height: 700))
        popoverWebView = webView
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        viewController.view = webView
        popover.contentSize = NSSize(width: 430, height: 700)
        popover.behavior = .transient
        popover.contentViewController = viewController

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(self.port)/popover.html")!))
        }
    }

    private func showIsland(reason: String = "manual") {
        logIsland("showIsland requested reason=\(reason)")
        let width: CGFloat = 560
        let height: CGFloat = 118
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            x: screenFrame.midX - width / 2,
            y: screenFrame.maxY - height - 10,
            width: width,
            height: height
        )

        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        webView.setValue(false, forKey: "drawsBackground")
        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/island.html")!))
        panel.contentView = webView
        panel.orderFrontRegardless()
        islandWindow = panel
        logIsland("showIsland displayed reason=\(reason)")

        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self, weak panel] in
            panel?.orderOut(nil)
            if self?.islandWindow === panel { self?.islandWindow = nil }
            self?.logIsland("showIsland dismissed reason=\(reason)")
        }
    }

    private func startServer() {
        guard serverProcess == nil else { return }
        let resources = Bundle.main.resourceURL!
        let server = resources.appendingPathComponent("server.js").path
        let home = NSHomeDirectory()
        let user = NSUserName()
        let node = detectedNodeBinary(home: home)
        let opentokenBin = detectedOpenTokenBinary(home: home)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = node.hasSuffix("env") ? ["node", server] : [server]
        process.currentDirectoryURL = resources
        process.environment = [
            "OPENTOKEN_ISLAND_PORT": "\(port)",
            "OPENTOKEN_BIN": opentokenBin,
            "HOME": home,
            "USER": user,
            "LOGNAME": user,
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        ]
        try? process.run()
        serverProcess = process
    }

    private func detectedNodeBinary(home: String) -> String {
        if let configured = islandStateString("nodeBin", home: home),
           FileManager.default.isExecutableFile(atPath: configured) {
            return configured
        }

        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node"
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        return "/usr/bin/env"
    }

    private func detectedOpenTokenBinary(home: String) -> String {
        if let configured = islandStateString("opentokenBin", home: home),
           FileManager.default.isExecutableFile(atPath: configured) {
            return configured
        }

        let candidates = [
            "\(home)/.local/bin/opentoken",
            "/opt/homebrew/bin/opentoken",
            "/usr/local/bin/opentoken"
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        return "opentoken"
    }

    private func islandStateString(_ key: String, home: String) -> String? {
        let url = URL(fileURLWithPath: home).appendingPathComponent(".opentoken/island-state.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = json[key] as? String,
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private func symbolImage(size: CGFloat) -> NSImage? {
        guard let image = NSImage(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("assets/scys/icon_topnav.png")),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let cropped = cgImage.cropping(to: CGRect(x: 0, y: 0, width: 48, height: 48)) else {
            return nil
        }
        let output = NSImage(size: NSSize(width: size, height: size))
        output.lockFocus()
        NSImage(cgImage: cropped, size: NSSize(width: size, height: size))
            .draw(in: NSRect(x: 0, y: 0, width: size, height: size))
        output.unlockFocus()
        return output
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            updateStatusTitle()
            refreshPopoverContent()
        }
    }

    @objc private func refreshNow() {
        updateStatusTitle()
        refreshPopoverContent()
        showIsland(reason: "refresh-menu")
    }

    @objc private func showIslandNow() {
        showIsland(reason: "manual-menu")
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    @objc private func showContextMenu(_ recognizer: NSClickGestureRecognizer) {
        guard let button = statusItem.button else { return }
        statusItem.menu = contextMenu
        button.performClick(nil)
        statusItem.menu = nil
    }

    private func refreshPopoverContent() {
        guard popover.isShown else { return }
        popoverWebView?.evaluateJavaScript("window.OpenTokenIslandRefresh && window.OpenTokenIslandRefresh()")
    }

    private func updateStatusTitle() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/summary") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let total = json["totalLabel"] as? String else { return }
            let waiting = json["waiting"] as? Bool ?? false
            let rank = json["rank"] as? Int
            let unlockedBadges = self?.currentUnlockedBadges(from: json) ?? []
            DispatchQueue.main.async {
                guard let self else { return }
                if waiting {
                    self.statusItem.button?.title = " waiting"
                } else if let rank {
                    self.statusItem.button?.title = " \(total) #\(rank)"
                } else {
                    self.statusItem.button?.title = " \(total)"
                }
                if self.shouldShowIsland(waiting: waiting, unlockedBadges: unlockedBadges) {
                    self.showIsland(reason: "badge-unlocked")
                }
            }
        }.resume()
    }

    private func checkIslandEvent() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/island-event") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            if let error {
                self?.logIsland("event poll failed error=\(error.localizedDescription)")
                return
            }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let event = json["event"] as? [String: Any] else { return }

            let id = (event["id"] as? NSNumber)?.int64Value ?? 0
            let reason = event["reason"] as? String ?? "unknown"
            let showIsland = event["showIsland"] as? Bool ?? true

            DispatchQueue.main.async {
                guard let self else { return }
                if !self.didLoadIslandEventSnapshot {
                    self.lastIslandEventId = id
                    self.didLoadIslandEventSnapshot = true
                    self.logIsland("event baseline id=\(id) reason=\(reason)")
                    return
                }

                guard id > self.lastIslandEventId else { return }
                self.lastIslandEventId = id
                self.logIsland("event detected id=\(id) reason=\(reason)")
                self.updateStatusTitle()
                self.refreshPopoverContent()
                if showIsland {
                    self.showIsland(reason: "event:\(reason)")
                }
            }
        }.resume()
    }

    private func currentUnlockedBadges(from json: [String: Any]) -> Set<String> {
        guard let badges = json["badges"] as? [[String: Any]] else { return [] }
        return Set(badges.compactMap { badge in
            guard badge["unlocked"] as? Bool == true else { return nil }
            return badge["title"] as? String
        })
    }

    private func shouldShowIsland(waiting: Bool, unlockedBadges: Set<String>) -> Bool {
        guard !waiting else { return false }
        defer {
            didLoadInitialSnapshot = true
            unlockedBadgeTitles = unlockedBadges
        }

        guard didLoadInitialSnapshot else { return false }
        // 名次变化的弹窗已改为纯服务端事件驱动（server 端 queueIslandEvent），
        // 客户端这里只保留「新解锁徽章」这一类自判触发，避免与服务端战报重复弹窗。
        return !unlockedBadges.subtracting(unlockedBadgeTitles).isEmpty
    }

    private func logIsland(_ message: String) {
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".opentoken")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("island-events.log")
        let line = "\(ISO8601DateFormatter().string(from: Date())) layer=app \(message)\n"
        guard let data = line.data(using: .utf8) else { return }

        if FileManager.default.fileExists(atPath: file.path),
           let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(data)
            handle.closeFile()
        } else {
            try? data.write(to: file)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
