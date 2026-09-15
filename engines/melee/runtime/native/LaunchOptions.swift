import Foundation
import CryptoKit

struct Choice: Codable { let id:Int; let label:String }
struct Port: Codable { var device:String; var character:String; var target:Int? = nil }
struct LaunchSettings: Codable {
    var mode:Int; var stage:Int; var level:Int; var stocks:Int; var minutes:Int; var ports:[Port]
}
struct LaunchSchema: Decodable {
    let modes:[Choice]; let stages:[Choice]; let fighters:[Choice]; let defaults:LaunchSettings
}
struct Costume: Codable { let filename:String; let path:String; let sha256:String; var companions:[Costume]? = nil }
struct Retarget: Codable { let fighter:Int; let costumes:[Costume]; let compactCostumes:[Costume]? }
struct Character: Codable { let slug:String; let name:String; let fighter:Int; let costumes:[Costume]; let compactCostumes:[Costume]?; var targets:[Retarget]? = nil }
struct LaunchPlan {
    var settings:LaunchSettings
    let packed:[Int]
    let costumes:[Costume]
    var environment:[String:String] {
        var result=["OPENSMASH_FIXED_WINDOW":"1", "OPENSMASH_MATCH":"1", "OPENSMASH_MODE":String(settings.mode), "OPENSMASH_STAGE":String(settings.stage),
                    "OPENSMASH_CPU_LEVEL":String(settings.level), "OPENSMASH_STOCKS":String(settings.stocks), "OPENSMASH_MINUTES":String(settings.minutes)]
        for i in 0..<4 { result["OPENSMASH_PORT\(i)"]=String(packed[i]) }
        return result
    }
}
func launchSchema() throws -> LaunchSchema {
    try JSONDecoder().decode(LaunchSchema.self, from:Data(contentsOf:resources.appendingPathComponent("launch-options.json")))
}
func launchPlan(_ input:LaunchSettings, selected:String, characters:[Character], schema:LaunchSchema) throws -> LaunchPlan {
    var settings=input
    guard schema.modes.contains(where:{$0.id==settings.mode}),schema.stages.contains(where:{$0.id==settings.stage}),
          (1...9).contains(settings.level),(1...99).contains(settings.stocks),(0...99).contains(settings.minutes),settings.ports.count==4 else {
        throw Failure(message:"Invalid launch settings.")
    }
    if settings.stage == -1 { settings.stage=schema.stages.filter{$0.id != -1}.randomElement()!.id }
    var devices=Set<String>(), used=[Int:[String:Int]](), entries=[(Port,Int,Character?)]()
    for p in settings.ports {
        guard ["keyboard","gamepad0","gamepad1","gamepad2","gamepad3","cpu","off"].contains(p.device) else { throw Failure(message:"Invalid controller.") }
        if p.device != "cpu" && p.device != "off" && !devices.insert(p.device).inserted { throw Failure(message:"Assign each controller to only one player.") }
        let key=p.character=="selected" ? selected : p.character
        var custom=characters.first{$0.slug==key}
        if let target=p.target, let original=custom, target != original.fighter {
            guard let variant=original.targets?.first(where:{$0.fighter==target}) else {throw Failure(message:"This target is not bundled for \(original.name). Choose Default or build its retarget first.")}
            custom=Character(slug:original.slug,name:original.name,fighter:target,costumes:variant.costumes,compactCostumes:variant.compactCostumes)
        }
        guard let fighter=custom?.fighter ?? (key.hasPrefix("vanilla:") ? Int(key.dropFirst(8)) : nil), (0...25).contains(fighter) else { throw Failure(message:"Choose a valid character for each player.") }
        entries.append((p,fighter,custom))
        if custom == nil && p.device != "off" { used[fighter]=["vanilla":0] }
    }
    if settings.mode==0 && entries.filter({$0.0.device != "off"}).count<2 { throw Failure(message:"Free-for-All needs at least two active players.") }
    if settings.mode==3 && ["off","cpu"].contains(entries[0].0.device) { throw Failure(message:"1P Character Select needs a human on player 1.") }
    // Game & Watch shares one costume archive across every color.
    let flatFighters=entries.filter { $0.1 == 3 && $0.0.device != "off" }
    let flatIdentities=Set(flatFighters.map { $0.2?.slug ?? "vanilla" })
    if flatIdentities.count > 1 && flatFighters.contains(where:{$0.2 != nil}) {
        throw Failure(message:"Game & Watch shares one costume across colors. Use the same custom character for every Game & Watch slot, or choose another target.")
    }
    var packed=[Int](), costumes=[Costume]()
    for (p,fighter,custom) in entries {
        var color=0
        if let character=custom, p.device != "off" {
            var slots=used[fighter] ?? [:]
            if let existing=slots[character.slug] { color=existing }
            else {
                color=slots.count
                guard color<character.costumes.count else { throw Failure(message:"Too many characters share this fighter's costume slots.") }
                slots[character.slug]=color;used[fighter]=slots;costumes.append(character.costumes[color])
            }
        }
        packed.append(fighter | ((p.device=="off" ? 3 : p.device=="cpu" ? 1 : 0)<<8) | (color<<16))
    }
    // Three distinct high-resolution customs exceed the original preload arena.
    // Keep the same mesh/materials and use smaller textures only for large lineups.
    if costumes.count>=3 {
        costumes=costumes.map { costume in
            for character in characters {
                let variants=[Retarget(fighter:character.fighter,costumes:character.costumes,compactCostumes:character.compactCostumes)]+(character.targets ?? [])
                for variant in variants {
                    if let index=variant.costumes.firstIndex(where:{$0.path==costume.path}), let compact=variant.compactCostumes,index<compact.count {return compact[index]}
                }
            }
            return costume
        }
    }
    let expanded=costumes.flatMap { [$0] + ($0.companions ?? []) }
    return LaunchPlan(settings:settings,packed:packed,costumes:expanded)
}

// Each lineup shares immutable imported files. Only replaced costumes are copied.
func lineupGame(_ base:URL, _ plan:LaunchPlan) throws -> URL {
    if plan.costumes.isEmpty { return base }
    let identity=plan.costumes.map{$0.filename+":"+$0.sha256}.sorted().joined(separator:"\n")
    let hash=SHA256.hash(data:Data(identity.utf8)).map{String(format:"%02x",$0)}.joined()
    let destination=base.deletingLastPathComponent().appendingPathComponent("lineup-"+hash.prefix(24))
    for c in plan.costumes {
        guard !c.path.contains(".."),!c.path.hasPrefix("/"),!c.filename.contains("/"),try sha256(resources.appendingPathComponent(c.path))==c.sha256 else { throw Failure(message:"Costume failed its integrity check.") }
    }
    if !fm.fileExists(atPath:destination.path) {
        let temporary=destination.deletingLastPathComponent().appendingPathComponent("lineup-"+UUID().uuidString)
        defer {try? fm.removeItem(at:temporary)}
        try fm.createDirectory(at:temporary,withIntermediateDirectories:true)
        guard let files=fm.enumerator(at:base,includingPropertiesForKeys:[.isDirectoryKey]) else { throw Failure(message:"Cannot read imported game.") }
        for case let file as URL in files {
            let name=String(file.path.dropFirst(base.path.count+1)), target=temporary.appendingPathComponent(name)
            if try file.resourceValues(forKeys:[.isDirectoryKey]).isDirectory == true { try fm.createDirectory(at:target,withIntermediateDirectories:true) }
            else { try fm.linkItem(at:file,to:target) }
        }
        for c in plan.costumes {
            let target=temporary.appendingPathComponent("files/"+c.filename)
            try fm.removeItem(at:target);try fm.copyItem(at:resources.appendingPathComponent(c.path),to:target)
        }
        try fm.moveItem(at:temporary,to:destination)
    }
    for c in plan.costumes where try sha256(destination.appendingPathComponent("files/"+c.filename)) != c.sha256 { throw Failure(message:"Cached lineup costume changed.") }
    return destination
}
