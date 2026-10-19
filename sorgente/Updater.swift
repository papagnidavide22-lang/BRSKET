// Aggiornamenti automatici: controlla GitHub, scarica la nuova versione e la installa al riavvio.
import Cocoa

final class Updater: NSObject {
    static let shared = Updater()
    let repo = (Bundle.main.object(forInfoDictionaryKey: "BrsketUpdateRepo") as? String) ?? "papagnidavide22-lang/brsket"
    var current: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
    var ready: (version: String, app: URL)? = nil
    var busy = false
    var log: ((String) -> Void)?
    var say: ((String) -> Void)?          // messaggio nella finestra di Brsket
    var onReady: ((String) -> Void)?      // aggiornamento pronto (notifica + voce di menu)
    var onBlocked: ((String) -> Void)?    // c'è una versione nuova ma l'app non è in Applicazioni

    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.check(manual: false) }
        Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in self.check(manual: false) }
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        let y = b.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    // l'app deve stare in una cartella scrivibile (non dentro il DMG)
    var installable: Bool {
        let path = Bundle.main.bundleURL.path
        if path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/") { return false }
        return FileManager.default.isWritableFile(atPath: Bundle.main.bundleURL.deletingLastPathComponent().path)
    }

    func check(manual: Bool) {
        if let r = ready { if manual { onReady?(r.version) }; return }
        guard !busy else { return }
        busy = true
        // 1) file "aggiornamenti/latest.json" nel repository (lo aggiorna chi pubblica, senza release)
        var mreq = URLRequest(url: URL(string: "https://raw.githubusercontent.com/\(repo)/main/aggiornamenti/latest.json?t=\(Int(Date().timeIntervalSince1970))")!)
        mreq.cachePolicy = .reloadIgnoringLocalCacheData
        mreq.timeoutInterval = 20
        URLSession.shared.dataTask(with: mreq) { data, resp, _ in
            if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
               let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let ver = j["version"] as? String, let z = j["zip"] as? String, let zurl = URL(string: z) {
                if !Updater.newer(ver, than: self.current) {
                    DispatchQueue.main.async { self.busy = false; if manual { self.info("Brsket è aggiornata", "Hai già l'ultima versione (\(self.current)).") } }
                    return
                }
                guard self.installable else {
                    DispatchQueue.main.async { self.busy = false; self.onBlocked?(ver) }
                    return
                }
                self.download(zurl, version: ver, manual: manual)
                return
            }
            self.checkReleases(manual: manual)   // 2) in alternativa, le release di GitHub
        }.resume()
    }

    func checkReleases(manual: Bool) {
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Brsket/\(current)", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, resp, err in
            let fail = { (msg: String) in DispatchQueue.main.async { self.busy = false; self.log?("aggiornamenti: \(msg)"); if manual { self.info("Impossibile controllare gli aggiornamenti", msg) } } }
            guard let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = j["tag_name"] as? String else { return fail(err.map { $0.localizedDescription } ?? "nessuna versione pubblicata") }
            let ver = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
            guard Updater.newer(ver, than: self.current) else {
                DispatchQueue.main.async { self.busy = false; if manual { self.info("Brsket è aggiornata", "Hai già l'ultima versione (\(self.current)).") } }
                return
            }
            let assets = j["assets"] as? [[String: Any]] ?? []
            guard let a = assets.first(where: { ($0["name"] as? String)?.hasSuffix(".zip") == true }),
                  let s = a["browser_download_url"] as? String, let url = URL(string: s) else { return fail("la versione \(ver) non contiene l'app") }
            guard self.installable else {
                DispatchQueue.main.async {
                    self.busy = false
                    self.onBlocked?(ver)
                }
                return
            }
            self.download(url, version: ver, manual: manual)
        }.resume()
    }

    func download(_ url: URL, version: String, manual: Bool) {
        log?("aggiornamenti: scarico \(version)")
        URLSession.shared.downloadTask(with: url) { tmp, resp, err in
            guard let tmp = tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else {
                DispatchQueue.main.async { self.busy = false; self.log?("aggiornamenti: download fallito \(err?.localizedDescription ?? "")") }
                return
            }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("brsket-agg-\(version)")
            try? FileManager.default.removeItem(at: dir)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let zip = dir.appendingPathComponent("Brsket.zip")
            try? FileManager.default.moveItem(at: tmp, to: zip)
            let ok = Updater.run("/usr/bin/ditto", ["-x", "-k", zip.path, dir.path]) == 0
            let app = dir.appendingPathComponent("Brsket.app")
            let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
            let sameApp = (info?["CFBundleIdentifier"] as? String) == Bundle.main.bundleIdentifier
            let signed = Updater.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path]) == 0
            DispatchQueue.main.async {
                self.busy = false
                guard ok, sameApp, signed else { self.log?("aggiornamenti: pacchetto \(version) non valido (\(ok) \(sameApp) \(signed))"); return }
                _ = Updater.run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", app.path])
                self.ready = (version, app)
                self.log?("aggiornamenti: \(version) pronta")
                self.onReady?(version)
            }
        }.resume()
    }

    func restartNow() { relaunchAfterInstall = true; NSApp.terminate(nil) }
    var relaunchAfterInstall = false

    // chiamato mentre l'app si chiude: sostituisce l'app sul disco (quella in esecuzione resta in memoria) e, se richiesto, apre la nuova
    func installOnQuit() {
        guard let r = ready else { return }
        let dest = Bundle.main.bundleURL
        let old = dest.deletingLastPathComponent().appendingPathComponent("Brsket (vecchia).app")
        let fm = FileManager.default
        try? fm.removeItem(at: old)
        do {
            try fm.moveItem(at: dest, to: old)
            guard Updater.run("/usr/bin/ditto", [r.app.path, dest.path]) == 0 else { throw NSError(domain: "brsket", code: 1) }
            try? fm.removeItem(at: old)
            log?("aggiornamenti: installata \(r.version)")
        } catch {
            try? fm.removeItem(at: dest); try? fm.moveItem(at: old, to: dest)
            log?("aggiornamenti: installazione non riuscita \(error)")
            return
        }
        if relaunchAfterInstall {
            let cfg = NSWorkspace.OpenConfiguration(); cfg.createsNewApplicationInstance = true
            NSWorkspace.shared.openApplication(at: dest, configuration: cfg, completionHandler: nil)
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    func info(_ t: String, _ m: String) { say?("\(t). \(m)") }

    @discardableResult static func run(_ cmd: String, _ args: [String]) -> Int32 {
        let p = Process(); p.executableURL = URL(fileURLWithPath: cmd); p.arguments = args
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus } catch { return -1 }
    }
}
