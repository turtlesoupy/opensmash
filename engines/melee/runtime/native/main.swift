import AppKit
import CryptoKit
import Foundation
import Darwin

struct Build: Decodable {
    let isoSha256: String, isoBytes: UInt64, dolSha256: String, moduleSha256: String
    let characters:[Character]
    let selected:String
    let fighter: Int, costume: String, costumeSha256: String, character: String
}
struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
let fm = FileManager.default
let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
let mac = executable.deletingLastPathComponent()
let resources = mac.deletingLastPathComponent().appendingPathComponent("Resources")
let arguments = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
let support = option("--user-dir").map { URL(fileURLWithPath: $0) } ??
    fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OpenSmash Melee")
func sha256(_ url: URL) throws -> String {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var hash = SHA256()
    while let chunk = try file.read(upToCount: 1024 * 1024), !chunk.isEmpty { hash.update(data: chunk) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}
func verify(_ rom: URL, _ build: Build) throws {
    let size = try fm.attributesOfItem(atPath: rom.path)[.size] as? NSNumber
    guard size?.uint64Value == build.isoBytes, try sha256(rom) == build.isoSha256 else {
        throw Failure(message: "This ROM does not match unmodified Melee USA v1.02. Choose a supported ISO or GCM.")
    }
}
func command(_ binary: URL, _ args: [String], log: URL, environment: [String: String] = [:]) throws -> Process {
    let process = Process()
    process.executableURL = binary; process.arguments = args
    process.currentDirectoryURL = mac
    process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
    fm.createFile(atPath: log.path, contents: nil)
    let output = try FileHandle(forWritingTo: log)
    process.standardOutput = output; process.standardError = output
    try process.run()
    try output.close()
    return process
}
func prepare(_ rom: URL, _ build: Build, status: (String) -> Void) throws -> URL {
    status("Verifying your Melee ROM…")
    try verify(rom, build)
    guard try sha256(mac.appendingPathComponent("game-module.dylib")) == build.moduleSha256 else {
        throw Failure(message: "The native module is incomplete or changed. Rebuild the app.")
    }
    try fm.createDirectory(at: support, withIntermediateDirectories: true)
    let games = support.appendingPathComponent("games")
    try fm.createDirectory(at: games, withIntermediateDirectories: true)
    let suffix = build.costumeSha256.isEmpty ? "original" : String(build.costumeSha256.prefix(16))
    let game = games.appendingPathComponent("GALE01-r2-" + suffix)
    let marker = game.appendingPathComponent("verified-iso.sha256")
    if fm.fileExists(atPath: game.path) {
        var valid = (try? String(contentsOf: marker, encoding: .utf8)) == build.isoSha256
        valid = valid && (try? sha256(game.appendingPathComponent("sys/main.dol"))) == build.dolSha256
        if !build.costume.isEmpty {
            valid = valid && (try? sha256(game.appendingPathComponent("files/" + build.costume))) == build.costumeSha256
        }
        if !valid {
            status("Repairing your cached game from the verified disc…")
            try fm.moveItem(at: game, to: games.appendingPathComponent("invalid-" + UUID().uuidString))
        }
    }
    if !fm.fileExists(atPath: game.path) {
        status("Importing your game locally. This is only needed once…")
        let staging = games.appendingPathComponent("import-" + UUID().uuidString)
        defer { try? fm.removeItem(at: staging) }
        let log = support.appendingPathComponent("import.log")
        let process = try command(mac.appendingPathComponent("dolrecomp"), ["extract", rom.path, staging.path], log: log)
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              try sha256(staging.appendingPathComponent("sys/main.dol")) == build.dolSha256 else {
            throw Failure(message: "Game import failed. Details: " + log.path)
        }
        if !build.costume.isEmpty {
            let costume = resources.appendingPathComponent(build.costume)
            guard !build.costume.contains("/"), try sha256(costume) == build.costumeSha256 else {
                throw Failure(message: "Custom costume failed its integrity check.")
            }
            let destination = staging.appendingPathComponent("files/" + build.costume)
            try fm.removeItem(at: destination)
            try fm.copyItem(at: costume, to: destination)
        }
        try build.isoSha256.write(to: staging.appendingPathComponent("verified-iso.sha256"), atomically: true, encoding: .utf8)
        try fm.moveItem(at: staging, to: game)
    }
    guard try String(contentsOf: marker, encoding: .utf8) == build.isoSha256,
          try sha256(game.appendingPathComponent("sys/main.dol")) == build.dolSha256 else {
        throw Failure(message: "Cached game is invalid. Move this directory aside and import again: " + game.path)
    }
    if !build.costume.isEmpty {
        if try sha256(game.appendingPathComponent("files/" + build.costume)) != build.costumeSha256 {
            throw Failure(message: "Cached costume changed. Move this game directory aside and import again: " + game.path)
        }
    }
    try rom.path.write(to: support.appendingPathComponent("rom-path.txt"), atomically: true, encoding: .utf8)
    let config = support.appendingPathComponent("User/Config")
    try fm.createDirectory(at: config, withIntermediateDirectories: true)
    let defaults = """
    [Display]
    Fullscreen = False
    RenderWindowWidth = 960
    RenderWindowHeight = 720
    RenderWindowAutoSize = False
    RenderWindowSaveOnExit = False
    [Interface]
    ConfirmStop = False
    [Core]
    CPUThread = False
    FastDiscSpeed = True
    EnableCheats = False
    """
    for (name, text) in [("Dolphin.ini", defaults)] where !fm.fileExists(atPath: config.appendingPathComponent(name).path) {
        try text.write(to: config.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }
    let pad = config.appendingPathComponent("GCPadNew.ini")
    if !fm.fileExists(atPath: pad.path) { try fm.copyItem(at: resources.appendingPathComponent("GCPadNew.ini"), to: pad) }
    return game
}
func launch(_ game: URL, _ build: Build, _ plan:LaunchPlan, headless: Bool) throws -> Process {
    let user = support.appendingPathComponent(headless ? "SmokeUser" : "User")
    if headless {
        let config = user.appendingPathComponent("Config")
        try fm.createDirectory(at: config, withIntermediateDirectories:true)
        let normal = try String(contentsOf:support.appendingPathComponent("User/Config/Dolphin.ini"),encoding:.utf8)
        try (normal + "\n[Input]\nBackgroundInput = True\n").write(to:config.appendingPathComponent("Dolphin.ini"),atomically:true,encoding:.utf8)
        try "[GCPad1]\nDevice = Pipe/0/opensmash-smoke\nButtons/A = `Button A`\n[GCPad2]\n[GCPad3]\n[GCPad4]\n".write(to:config.appendingPathComponent("GCPadNew.ini"),atomically:true,encoding:.utf8)
        let pipes = user.appendingPathComponent("Pipes")
        try fm.createDirectory(at:pipes,withIntermediateDirectories:true)
        let pipe = pipes.appendingPathComponent("opensmash-smoke")
        if !fm.fileExists(atPath:pipe.path), mkfifo(pipe.path,0o600) != 0 {
            throw Failure(message:"Could not create the smoke-test input pipe.")
        }
    }
    if !headless { try configureControllers(plan.settings,user:user) }
    let root = try lineupGame(game,plan)
    var args = ["--game", root.path, "--module", mac.appendingPathComponent("game-module.dylib").path,
                "--user-dir", user.path,
                "--title", "OpenSmash Melee", "--graphics", headless ? "Null" : "Metal",
                "--audio", headless ? "Null" : "Cubeb", "--mods", resources.appendingPathComponent("Mods").path]
    if headless { args.append("--headless") }
    var environment=plan.environment
    if !plan.costumes.isEmpty {environment["OPENSMASH_NATIVE_MODULE"]=mac.appendingPathComponent("game-module.dylib").path}
    return try command(mac.deletingLastPathComponent().appendingPathComponent("Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner"), args, log: support.appendingPathComponent("game.log"),
        environment: environment)
}
func cli(_ build: Build) throws -> Bool {
    if arguments.contains("--help") {
        print("OpenSmashMelee [--verify-rom ROM | --prepare-rom ROM | --smoke-test ROM] [--user-dir DIRECTORY] [--mode 0..4] [--launch-settings JSON] [--character SLUG]\nOpen the app normally for its ROM picker and native game. --play starts with saved launch settings after ROM verification.")
        return true
    }
    if let path = option("--verify-rom") { try verify(URL(fileURLWithPath: path), build); print("Verified USA v1.02: " + build.isoSha256); return true }
    guard let path = option("--prepare-rom") ?? option("--smoke-test") else { return false }
    let game = try prepare(URL(fileURLWithPath: path), build) { print($0) }
    if option("--smoke-test") != nil {
        let schema=try launchSchema()
        var settings=schema.defaults
        if let file=option("--launch-settings") { settings=try JSONDecoder().decode(LaunchSettings.self,from:Data(contentsOf:URL(fileURLWithPath:file))) }
        if let raw=option("--mode") { guard let mode=Int(raw) else {throw Failure(message:"Invalid mode.")};settings.mode=mode }
        let plan=try launchPlan(settings,selected:option("--character") ?? build.selected,characters:build.characters,schema:schema)
        let process = try launch(game, build, plan, headless: true)
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        let pipe = open(support.appendingPathComponent("SmokeUser/Pipes/opensmash-smoke").path,O_RDWR | O_NONBLOCK)
        guard pipe >= 0 else { throw Failure(message:"Could not open the smoke-test controller.") }
        defer { close(pipe) }
        let deadline = Date().addingTimeInterval(55)
        var step = 0
        var readyAt:Date?
        while process.isRunning && Date() < deadline {
            let log = (try? String(contentsOf: support.appendingPathComponent("game.log"), encoding: .utf8)) ?? ""
            if log.contains("guest assert") || log.contains("Aborted") { throw Failure(message: "Native combat asserted; inspect game.log.") }
            if log.contains("[opensmash] native combat frame=180") { print("PASS: native custom-match boot and 180 headless combat frames."); return true }
            if plan.settings.mode != 0 && log.contains("[opensmash] destination ready mode=\(plan.settings.mode)") {
                if readyAt == nil { readyAt=Date() }
                if Date().timeIntervalSince(readyAt!)>=3 { print("PASS: native launch destination mode=\(plan.settings.mode), stable for 3 seconds.");return true }
            }
            // A fresh virtual memory card can require an initial A confirmation.
            // Exercise that input only in the isolated headless test controller.
            let press = !log.contains("[opensmash] destination ready") && !log.contains("[opensmash] launch fighter=") && step % 10 == 0
            let input = press ? "PRESS A\n" : "RELEASE A\n"
            input.withCString { pointer in _ = write(pipe,pointer,strlen(pointer)) }
            step += 1
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw Failure(message: "Native combat smoke test did not complete; inspect " + support.appendingPathComponent("game.log").path)
    }
    print("Prepared " + game.path)
    return true
}


do {
    let build = try JSONDecoder().decode(Build.self, from: Data(contentsOf: resources.appendingPathComponent("build.json")))
    if try !cli(build) {
        let app = NSApplication.shared
        let delegate = Application(build); app.delegate = delegate
        app.setActivationPolicy(.regular); app.run()
    }
} catch {
    fputs(error.localizedDescription + "\n", stderr); exit(1)
}
