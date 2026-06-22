import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var islandWindow: NSPanel?
    private var serverProcess: Process?
    private var timer: Timer?
    private let contextMenu = NSMenu()
    private let port = 4174
    private var lastRank: Int?
    private var unlockedBadgeTitles = Set<String>()
    private var didLoadInitialSnapshot = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        startServer()
        setupStatusItem()
        setupPopover()
        updateStatusTitle()
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.updateStatusTitle()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
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

    private func showIsland() {
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

        DispatchQueue.main.asyncAfter(deadline: .now() + 4.2) { [weak self, weak panel] in
            panel?.orderOut(nil)
            if self?.islandWindow === panel { self?.islandWindow = nil }
        }
    }

    private func startServer() {
        guard serverProcess == nil else { return }
        let resources = Bundle.main.resourceURL!
        let server = resources.appendingPathComponent("server.js").path
        let node = FileManager.default.fileExists(atPath: "/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : "/usr/bin/env"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = node.hasSuffix("env") ? ["node", server] : [server]
        process.currentDirectoryURL = resources
        process.environment = [
            "OPENTOKEN_ISLAND_PORT": "\(port)",
            "OPENTOKEN_BIN": "/Users/yangguangxiaolaohu/.local/bin/opentoken",
            "HOME": "/Users/yangguangxiaolaohu",
            "USER": "yangguangxiaolaohu",
            "LOGNAME": "yangguangxiaolaohu",
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        ]
        try? process.run()
        serverProcess = process
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
        }
    }

    @objc private func refreshNow() {
        updateStatusTitle()
        showIsland()
    }

    @objc private func showIslandNow() {
        showIsland()
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
                if waiting {
                    self?.statusItem.button?.title = " waiting"
                } else if let rank {
                    self?.statusItem.button?.title = " \(total) #\(rank)"
                } else {
                    self?.statusItem.button?.title = " \(total)"
                }
                if self?.shouldShowIsland(waiting: waiting, rank: rank, unlockedBadges: unlockedBadges) == true {
                    self?.showIsland()
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

    private func shouldShowIsland(waiting: Bool, rank: Int?, unlockedBadges: Set<String>) -> Bool {
        guard !waiting else { return false }
        defer {
            didLoadInitialSnapshot = true
            lastRank = rank
            unlockedBadgeTitles = unlockedBadges
        }

        guard didLoadInitialSnapshot else { return false }
        let rankChanged = rank != nil && lastRank != nil && rank != lastRank
        let hasNewBadge = !unlockedBadges.subtracting(unlockedBadgeTitles).isEmpty
        return rankChanged || hasNewBadge
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
