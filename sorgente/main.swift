// Brsket — app per Mac: una finestra sua (niente browser) che mostra l'interfaccia del motore locale.
import Cocoa
import WebKit
import UserNotifications

let URL_BASE = "http://127.0.0.1:8765"

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var launcher: Process?
    var serverWasUp = false
    var downCount = 0
    var quitting = false
    var seenDone: Set<String>? = nil   // download già finiti (per avvisare solo dei nuovi)
    let dataDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Brsket")

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        buildWindow()
        startEngine()
        Updater.shared.log = { [weak self] t in self?.note(t) }
        Updater.shared.say = { [weak self] t in self?.pageToast(t) }
        Updater.shared.onReady = { [weak self] v in self?.updateReady(v) }
        Updater.shared.start()
        UNUserNotificationCenter.current().delegate = self
        // chiedi subito il permesso per le notifiche (una volta sola: poi macOS lo ricorda)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, err in
            self.note("permesso notifiche: \(ok) \(err.map { "\($0)" } ?? "")")
        }
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.watch() }
        NSApp.activate(ignoringOtherApps: true)
    }

    // ---------- finestra ----------
    func buildWindow() {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "brsket")
        cfg.websiteDataStore = .default()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.setValue(false, forKey: "drawsBackground")
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(1240, screen.width * 0.86), h = min(900, screen.height * 0.9)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Brsket"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 420, height: 560)
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("BrsketFinestra")
        window.backgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0.047, alpha: 1) : NSColor(red: 0.949, green: 0.949, blue: 0.937, alpha: 1)
        }
        loadLoading()
        window.makeKeyAndOrderFront(nil)
    }

    // pagina d'attesa locale finché il motore non risponde
    func loadLoading() {
        let html = """
        <!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:#f2f2ef;color:#0c0c0c;font:19px -apple-system,sans-serif}
        @media (prefers-color-scheme:dark){html,body{background:#0c0c0c;color:#f2f2ef}.r{border-color:#262624!important;border-top-color:#f2f2ef!important}}
        body{display:flex;align-items:center;padding:0 8vw;box-sizing:border-box;-webkit-user-select:none}
        h1{font-size:clamp(40px,6vw,84px);font-weight:500;letter-spacing:-.05em;margin:28px 0 12px}
        .r{width:34px;height:34px;border-radius:50%;border:3px solid #d9d9d4;border-top-color:#0c0c0c;animation:s .9s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style>
        <div><div class=r></div><h1>Avvio Brsket…</h1><p>Un attimo.</p></div>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    // ---------- motore ----------
    func startEngine() {
        guard let sh = Bundle.main.path(forResource: "brsket", ofType: "sh") else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [sh]
        var env = ProcessInfo.processInfo.environment
        env["BRSKET_NATIVE"] = "1"
        p.environment = env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); launcher = p } catch { NSLog("Brsket: avvio motore non riuscito \(error)") }
    }

    func watch() {
        guard !quitting else { return }
        var req = URLRequest(url: URL(string: URL_BASE + "/api/status")!)
        req.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
            DispatchQueue.main.async { self?.statusResult(ok: err == nil && data != nil) }
        }.resume()
    }

    func statusResult(ok: Bool) {
        let cur = web.url?.absoluteString ?? ""
        if ok {
            downCount = 0
            checkJobs()
            if !serverWasUp || !cur.hasPrefix(URL_BASE) {
                serverWasUp = true
                web.load(URLRequest(url: URL(string: URL_BASE + "/")!))
            } else if window.isVisible && !web.isLoading {
                // pagina rimasta bianca (es. dopo lo stop del Mac): ricaricala
                web.evaluateJavaScript("!!document.getElementById('form')") { [weak self] r, _ in
                    if (r as? Bool) != true, let self = self, !self.web.isLoading {
                        self.note("pagina vuota: ricarico")
                        self.web.load(URLRequest(url: URL(string: URL_BASE + "/")!))
                    }
                }
            }
            return
        }
        let launcherAlive = launcher?.isRunning ?? false
        if serverWasUp {
            downCount += 1
            // motore spento (Esci nella pagina) e niente in avvio: chiudi l'app
            if downCount >= 2 && !launcherAlive { quitting = true; NSApp.terminate(nil) }
        } else if !launcherAlive {
            // preparazione fallita o in corso dal launcher: mostra la sua pagina d'attesa/errore
            showLauncherPage()
        } else {
            showLauncherPage()
        }
    }

    // controlla i download finiti anche a finestra chiusa e manda la notifica
    func checkJobs() {
        var req = URLRequest(url: URL(string: URL_BASE + "/api/jobs")!)
        req.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let jobs = obj["jobs"] as? [[String: Any]] else { return }
            let done = jobs.filter { ($0["stage"] as? String) == "done" }
            DispatchQueue.main.async {
                guard let self = self else { return }
                let ids = Set(done.compactMap { $0["id"] as? String })
                if self.seenDone == nil { self.seenDone = ids; return }
                for j in done {
                    guard let id = j["id"] as? String, !(self.seenDone!.contains(id)) else { continue }
                    self.seenDone!.insert(id)
                    let files = j["files"] as? [[String: Any]] ?? []
                    let name = files.first?["name"] as? String ?? (j["title"] as? String ?? "")
                    let body = files.count > 1 ? "\(files.count) file: \(name)" : name
                    self.notifyDone(id: id, body: body)
                }
            }
        }.resume()
    }

    func notifyDone(id: String, body: String) {
        // rispetta l'interruttore "Notifica quando un download è pronto" nelle Impostazioni
        URLSession.shared.dataTask(with: URL(string: URL_BASE + "/api/settings")!) { data, _, _ in
            let st = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            if let on = st?["notify"] as? Bool, !on { return }
            DispatchQueue.main.async { self.postNotification(id: id, body: body) }
        }.resume()
    }

    func postNotification(id: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = "Download completato"
        c.body = body + "\nClicca per aprire la cartella"
        c.sound = .default
        c.userInfo = ["id": id]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil)) { err in
            self.note("notifica \(id): \(err.map { "errore \($0)" } ?? "inviata")")
        }
        if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
    }

    func showLauncherPage() {
        let f = dataDir.appendingPathComponent("avvio.html")
        guard FileManager.default.fileExists(atPath: f.path) else { return }
        if web.url?.isFileURL == true { return }   // si aggiorna da sola
        web.loadFileURL(f, allowingReadAccessTo: dataDir)
    }

    // ---------- messaggi dalla pagina ----------
    func userContentController(_ ucc: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let type = d["type"] as? String else { return }
        switch type {
        case "paste":
            let t = NSPasteboard.general.string(forType: .string) ?? ""
            let js = "window.__brsketPaste(\(jsString(t)))"
            web.evaluateJavaScript(js, completionHandler: nil)
        case "askNotify":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        case "notify":
            break   // le notifiche le manda l'app da sola (anche a finestra chiusa)
        default: break
        }
    }

    // piccolo registro per capire se le notifiche partono
    func note(_ t: String) {
        let f = dataDir.appendingPathComponent("app.log")
        let line = "[\(Date())] \(t)\n"
        if let h = try? FileHandle(forWritingTo: f) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(to: f, atomically: true, encoding: .utf8) }
    }

    func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    // clic sulla notifica: mostra il file nel Finder
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        note("clic sulla notifica")
        if r.notification.request.content.userInfo["update"] != nil { done(); Updater.shared.restartNow(); return }
        if let id = r.notification.request.content.userInfo["id"] as? String, !id.isEmpty {
            var req = URLRequest(url: URL(string: URL_BASE + "/api/reveal")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id])
            URLSession.shared.dataTask(with: req).resume()
        }
        done()
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }

    // link esterni (siti, QR, ecc.) nel browser; l'interfaccia resta qui
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, let scheme = u.scheme {
            let local = u.absoluteString.hasPrefix(URL_BASE) || scheme == "file" || scheme == "about" || scheme == "data"
            if !local && (scheme == "http" || scheme == "https" || scheme == "mailto") {
                NSWorkspace.shared.open(u); decisionHandler(.cancel); return
            }
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage msg: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let al = NSAlert(); al.messageText = msg
        al.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage msg: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let al = NSAlert(); al.messageText = msg; al.addButton(withTitle: "OK"); al.addButton(withTitle: "Annulla")
        al.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) {}
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }

    // ---------- ciclo di vita ----------
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows v: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }  // i download continuano
    func applicationShouldTerminate(_ s: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        var req = URLRequest(url: URL(string: URL_BASE + "/api/quit")!)
        req.httpMethod = "POST"; req.timeoutInterval = 1.5
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 1.6)
        if let l = launcher, l.isRunning { l.terminate() }
        Updater.shared.installOnQuit()
        return .terminateNow
    }

    // ---------- menu ----------
    func buildMenu() {
        let main = NSMenu()
        func item(_ t: String, _ a: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; i.target = target; return i
        }
        let app = NSMenu()
        app.addItem(item("Informazioni su Brsket", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""))
        app.addItem(item("Controlla aggiornamenti…", #selector(checkUpdates), "", target: self))
        app.addItem(.separator())
        app.addItem(item("Apri la cartella dei download", #selector(openFolder), "o", target: self))
        app.addItem(.separator())
        app.addItem(item("Nascondi Brsket", #selector(NSApplication.hide(_:)), "h"))
        app.addItem(item("Nascondi altre", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        app.addItem(item("Mostra tutte", #selector(NSApplication.unhideAllApplications(_:)), ""))
        app.addItem(.separator())
        app.addItem(item("Esci da Brsket", #selector(NSApplication.terminate(_:)), "q"))
        let appItem = NSMenuItem(); appItem.submenu = app; main.addItem(appItem)

        let edit = NSMenu(title: "Modifica")
        edit.addItem(item("Annulla", Selector(("undo:")), "z"))
        edit.addItem(item("Ripeti", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Taglia", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Copia", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Incolla", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Seleziona tutto", #selector(NSText.selectAll(_:)), "a"))
        let editItem = NSMenuItem(); editItem.submenu = edit; main.addItem(editItem)

        let view = NSMenu(title: "Vista")
        view.addItem(item("Ricarica", #selector(reloadPage), "r", target: self))
        view.addItem(item("Dimensioni reali", #selector(zoomReset), "0", target: self))
        view.addItem(item("Ingrandisci", #selector(zoomIn), "+", target: self))
        view.addItem(item("Riduci", #selector(zoomOut), "-", target: self))
        view.addItem(.separator())
        view.addItem(item("Attiva/disattiva schermo intero", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        let viewItem = NSMenuItem(); viewItem.submenu = view; main.addItem(viewItem)

        let win = NSMenu(title: "Finestra")
        win.addItem(item("Riduci nel Dock", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Ridimensiona", #selector(NSWindow.performZoom(_:)), ""))
        win.addItem(item("Chiudi", #selector(NSWindow.performClose(_:)), "w"))
        win.addItem(.separator())
        win.addItem(item("Brsket", #selector(showMain), "1", target: self))
        let winItem = NSMenuItem(); winItem.submenu = win; main.addItem(winItem)
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }
    @objc func checkUpdates() { pageToast("Controllo gli aggiornamenti…"); Updater.shared.check(manual: true) }
    @objc func restartForUpdate() { Updater.shared.restartNow() }

    // nuova versione scaricata: notifica + voce nel menu + avviso nella finestra (niente finestre bloccanti)
    var updateItem: NSMenuItem?
    func updateReady(_ v: String) {
        if updateItem == nil, let appMenu = NSApp.mainMenu?.items.first?.submenu {
            let it = NSMenuItem(title: "Riavvia e aggiorna a Brsket \(v)", action: #selector(restartForUpdate), keyEquivalent: "")
            it.target = self
            appMenu.insertItem(it, at: 2)
            updateItem = it
        }
        pageToast("Brsket \(v) è pronta: si installa da sola quando chiudi l'app (oppure menu Brsket → Riavvia e aggiorna).")
        let c = UNMutableNotificationContent()
        c.title = "Aggiornamento pronto"
        c.body = "Brsket \(v) si installa quando chiudi l'app. Clicca per riavviare adesso."
        c.userInfo = ["update": v]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "update-\(v)", content: c, trigger: nil))
    }
    func pageToast(_ t: String) {
        web.evaluateJavaScript("typeof toast==='function' && toast(\(jsString(t)), 'ok')", completionHandler: nil)
    }
    @objc func openFolder() {
        let d = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads/Brsket")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        NSWorkspace.shared.open(d)
    }
    @objc func reloadPage() { if serverWasUp { _ = web.load(URLRequest(url: URL(string: URL_BASE + "/")!)) } else { _ = web.reload() } }
    @objc func zoomReset() { web.pageZoom = 1 }
    @objc func zoomIn() { web.pageZoom = min(2, web.pageZoom + 0.1) }
    @objc func zoomOut() { web.pageZoom = max(0.6, web.pageZoom - 0.1) }
    @objc func showMain() { window.makeKeyAndOrderFront(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
