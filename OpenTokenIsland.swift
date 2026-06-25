import Cocoa
import WebKit

private final class PosterSnapshotJob: NSObject, WKNavigationDelegate {
    private let html: String
    private let width: CGFloat
    private let height: CGFloat
    private let replyHandler: (Any?, String?) -> Void
    private let onComplete: (PosterSnapshotJob) -> Void
    private let webView: WKWebView
    private var timeoutWorkItem: DispatchWorkItem?
    private var isCompleted = false

    init(
        html: String,
        width: CGFloat,
        height: CGFloat,
        replyHandler: @escaping (Any?, String?) -> Void,
        onComplete: @escaping (PosterSnapshotJob) -> Void
    ) {
        self.html = html
        self.width = width
        self.height = height
        self.replyHandler = replyHandler
        self.onComplete = onComplete
        self.webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        super.init()
        webView.navigationDelegate = self
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.setValue(false, forKey: "drawsBackground")
    }

    func start() {
        let timeout = DispatchWorkItem { [weak self] in
            self?.finish(errorMessage: "snapshot-timeout")
        }
        timeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
        webView.loadHTMLString(html, baseURL: Bundle.main.resourceURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.capture()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(errorMessage: "snapshot-navigation-failed")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(errorMessage: "snapshot-navigation-failed")
    }

    private func capture() {
        guard !isCompleted else { return }
        let snapshotConfig = WKSnapshotConfiguration()
        snapshotConfig.rect = NSRect(x: 0, y: 0, width: width, height: height)
        snapshotConfig.snapshotWidth = NSNumber(value: Int(width))
        webView.takeSnapshot(with: snapshotConfig) { [weak self] image, _ in
            guard let self else { return }
            guard let image,
                  let tiff = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                self.finish(errorMessage: "snapshot-png-failed")
                return
            }
            let base64 = png.base64EncodedString()
            self.complete(base64: base64)
        }
    }

    private func complete(base64: String) {
        guard !isCompleted else { return }
        isCompleted = true
        timeoutWorkItem?.cancel()
        replyHandler(["ok": true, "type": "image/png", "base64": base64], nil)
        webView.navigationDelegate = nil
        onComplete(self)
    }

    private func finish(errorMessage: String) {
        guard !isCompleted else { return }
        isCompleted = true
        timeoutWorkItem?.cancel()
        replyHandler(nil, errorMessage)
        webView.navigationDelegate = nil
        onComplete(self)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var popoverWebView: WKWebView?
    private var islandWindow: NSPanel?
    private var serverProcess: Process?
    private var timer: Timer?
    private var eventTimer: Timer?
    private let contextMenu = NSMenu()
    private let port = 4174
    private let serverRestartDelay: TimeInterval = 5
    private var lastIslandEventId: Int64 = 0
    private var unlockedBadgeTitles = Set<String>()
    private var didLoadInitialSnapshot = false
    private var didLoadIslandEventSnapshot = false
    private var isTerminating = false
    private var lastEventPollFailureLogAt = Date.distantPast
    private var posterSnapshotJobs = [PosterSnapshotJob]()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NSApp.applicationIconImage = symbolImage(size: 256)
        logIsland("app.launched")
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
        isTerminating = true
        logIsland("app.terminating")
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
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "openTokenClipboard")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "openTokenPosterSnapshot")
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 430, height: 700), configuration: configuration)
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

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        if message.name == "openTokenClipboard" {
            handleClipboardMessage(message, replyHandler: replyHandler)
            return
        }
        if message.name == "openTokenPosterSnapshot" {
            handlePosterSnapshotMessage(message, replyHandler: replyHandler)
            return
        }
        replyHandler(nil, "unknown-message")
    }

    private func handleClipboardMessage(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              type == "image/png",
              let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64),
              !data.isEmpty else {
            logIsland("poster.nativeCopy.failed", details: ["reason": "invalid-message"])
            replyHandler(nil, "invalid-message")
            return
        }

        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        let wrotePng = pasteboard.setData(data, forType: .png)
        var wroteTiff = false
        if let image = NSImage(data: data),
           let tiffData = image.tiffRepresentation {
            wroteTiff = pasteboard.setData(tiffData, forType: .tiff)
        }

        if wrotePng || wroteTiff {
            logIsland("poster.nativeCopy.complete", details: ["type": type])
            replyHandler(["ok": true], nil)
        } else {
            logIsland("poster.nativeCopy.failed", details: ["reason": "pasteboard-write-failed"])
            replyHandler(nil, "pasteboard-write-failed")
        }
    }

    private func handlePosterSnapshotMessage(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              type == "text/html",
              let html = body["html"] as? String,
              !html.isEmpty else {
            logIsland("poster.nativeSnapshot.failed", details: ["reason": "invalid-message"])
            replyHandler(nil, "invalid-message")
            return
        }

        let width = CGFloat((body["width"] as? NSNumber)?.doubleValue ?? 1080)
        let height = CGFloat((body["height"] as? NSNumber)?.doubleValue ?? 1920)
        guard width > 0, height > 0 else {
            logIsland("poster.nativeSnapshot.failed", details: ["reason": "invalid-size"])
            replyHandler(nil, "invalid-size")
            return
        }

        let job = PosterSnapshotJob(
            html: html,
            width: width,
            height: height,
            replyHandler: replyHandler,
            onComplete: { [weak self] completedJob in
                self?.posterSnapshotJobs.removeAll { $0 === completedJob }
            }
        )
        posterSnapshotJobs.append(job)
        logIsland("poster.nativeSnapshot.start", details: ["width": Int(width), "height": Int(height)])
        job.start()
    }

    private func showIsland(reason: String = "manual") {
        logIsland("island.show.requested", details: ["reason": reason])
        let width: CGFloat = 576
        let height: CGFloat = 134
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
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.setValue(false, forKey: "drawsBackground")
        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/island.html")!))
        panel.contentView = webView
        panel.orderFrontRegardless()
        islandWindow = panel
        logIsland("island.show.displayed", details: ["reason": reason])

        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self, weak panel] in
            panel?.orderOut(nil)
            if self?.islandWindow === panel { self?.islandWindow = nil }
            self?.logIsland("island.show.dismissed", details: ["reason": reason])
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
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                self.logIsland("server.exited", details: [
                    "status": process.terminationStatus,
                    "reason": process.terminationReason.rawValue
                ])
                if self.serverProcess === process { self.serverProcess = nil }
                self.scheduleServerRestart(reason: "server-exit")
            }
        }
        do {
            try process.run()
            serverProcess = process
            logIsland("server.launched", details: ["pid": process.processIdentifier])
        } catch {
            logIsland("server.launch.failed", details: ["error": error.localizedDescription])
            scheduleServerRestart(reason: "launch-failed")
        }
    }

    private func scheduleServerRestart(reason: String) {
        guard !isTerminating else { return }
        logIsland("server.restart.scheduled", details: ["reason": reason])
        DispatchQueue.main.asyncAfter(deadline: .now() + serverRestartDelay) { [weak self] in
            guard let self, !self.isTerminating, self.serverProcess == nil else { return }
            self.logIsland("server.restart.starting", details: ["reason": reason])
            self.startServer()
        }
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
        logIsland("button.togglePopover.clicked", details: ["shown": popover.isShown])
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            updateStatusTitle()
            refreshPopoverContent()
        }
    }

    @objc private func refreshNow() {
        logIsland("menu.refresh.clicked")
        updateStatusTitle()
        refreshPopoverContent()
        showIsland(reason: "refresh-menu")
    }

    @objc private func showIslandNow() {
        logIsland("menu.showIsland.clicked")
        showIsland(reason: "manual-menu")
    }

    @objc private func quit() {
        logIsland("menu.quit.clicked")
        NSApp.terminate(nil)
    }

    @objc private func showContextMenu(_ recognizer: NSClickGestureRecognizer) {
        guard let button = statusItem.button else { return }
        logIsland("button.contextMenu.clicked")
        statusItem.menu = contextMenu
        button.performClick(nil)
        statusItem.menu = nil
    }

    private func refreshPopoverContent() {
        guard popover.isShown else { return }
        logIsland("popover.refresh.requested")
        popoverWebView?.evaluateJavaScript("window.OpenTokenIslandRefresh && window.OpenTokenIslandRefresh()")
    }

    private func updateStatusTitle() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/summary") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data else {
                self?.logIsland("status.update.failed", details: ["error": "no-data"])
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let total = json["totalLabel"] as? String else {
                self?.logIsland("status.update.failed", details: ["error": "invalid-json"])
                return
            }
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
                self.logIsland("status.updated", details: [
                    "waiting": waiting,
                    "rank": rank ?? 0
                ])
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
                self?.logEventPollFailure(error.localizedDescription)
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
                    self.logIsland("event.baseline", details: ["id": id, "reason": reason])
                    return
                }

                guard id > self.lastIslandEventId else { return }
                self.lastIslandEventId = id
                self.logIsland("event.detected", details: ["id": id, "reason": reason])
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

    private func logEventPollFailure(_ message: String) {
        let now = Date()
        guard now.timeIntervalSince(lastEventPollFailureLogAt) >= 60 else { return }
        lastEventPollFailureLogAt = now
        logIsland("event.poll.failed", details: ["error": message])
    }

    private func sanitizeLogString(_ value: String) -> String {
        var text = value.replacingOccurrences(
            of: "(/tokenrank/api/subapp/u/)[^/?#]+",
            with: "$1<account>",
            options: .regularExpression
        )
        let secretPattern = "(bearer\\s+[a-z0-9._~+/=-]+|authorization\\s*[:=]|(?:api[_-]?token|auth[_-]?token|token|secret[_-]?token)\\s*[:=]|x-opentoken-island-token)"
        if text.range(of: secretPattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return "<redacted>"
        }
        if text.count > 1000 {
            text = String(text.prefix(1000)) + "...<truncated>"
        }
        return text
    }

    private func sanitizeLogValue(_ value: Any) -> Any {
        if let string = value as? String { return sanitizeLogString(string) }
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number }
        if let dictionary = value as? [String: Any] { return sanitizeLogDetails(dictionary) }
        if let array = value as? [Any] {
            return array.prefix(20).map { sanitizeLogValue($0) }
        }
        return sanitizeLogString(String(describing: value))
    }

    private func sanitizeLogDetails(_ details: [String: Any]) -> [String: Any] {
        var sanitized: [String: Any] = [:]
        for (key, value) in details {
            let lowerKey = key.lowercased()
            if lowerKey.contains("authorization")
                || lowerKey.contains("cookie")
                || lowerKey.contains("password")
                || lowerKey.contains("secret")
                || lowerKey.contains("token") {
                sanitized[key] = "<redacted>"
            } else if ["body", "payload", "raw", "stdout", "stderr"].contains(lowerKey) {
                sanitized[key] = "<omitted>"
            } else {
                sanitized[key] = sanitizeLogValue(value)
            }
        }
        return sanitized
    }

    private func logIsland(_ event: String, details: [String: Any] = [:]) {
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".opentoken")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("island-events.log")
        let safeEvent = sanitizeLogString(event)
        let entry: [String: Any] = [
            "at": ISO8601DateFormatter().string(from: Date()),
            "layer": "app",
            "event": safeEvent,
            "flow": safeEvent,
            "details": sanitizeLogDetails(details)
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: entry),
              var line = String(data: data, encoding: .utf8) else { return }
        line.append("\n")
        guard let lineData = line.data(using: .utf8) else { return }

        if FileManager.default.fileExists(atPath: file.path),
           let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(lineData)
            handle.closeFile()
        } else {
            try? lineData.write(to: file)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
