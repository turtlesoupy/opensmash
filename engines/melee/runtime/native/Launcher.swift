import AppKit

final class Application: NSObject, NSApplicationDelegate, NSWindowDelegate, NSComboBoxDelegate {
    let build:Build
    var window:NSWindow!, status:NSTextField!, play:NSButton!, mode:NSPopUpButton!, stage:NSPopUpButton!
    var level:NSTextField!, stocks:NSTextField!, minutes:NSTextField!, chosen:NSComboBox!
    var targets=[NSPopUpButton]()
    var targetIDs:[Int] { [-1] + schema.fighters.map{$0.id} }
    var devices=[NSPopUpButton](), characters=[NSComboBox](), characterKeys=[String](), characterNames=[String]()
    var preparingDisc=false
    var playActivity:NSObjectProtocol?
    var launchTimer:Timer?, launchReady=false, launchStarted=Date(), progress:NSProgressIndicator!
    var schema:LaunchSchema!, settings:LaunchSettings!, root:URL?, game:Process?, bridge:ControllerBridge?
    let deviceKeys=["keyboard","gamepad0","gamepad1","gamepad2","gamepad3","cpu","off"]
    init(_ build:Build){self.build=build}
    // A light presentation pass over the existing controls and launch flow.
    let accent=NSColor(calibratedRed:0.96,green:0.67,blue:0.35,alpha:1)
    func card(_ x:CGFloat,_ y:CGFloat,_ width:CGFloat,_ height:CGFloat) {
        let view=NSView(frame:NSRect(x:x,y:y,width:width,height:height))
        view.wantsLayer=true;view.layer?.cornerRadius=12
        view.layer?.backgroundColor=NSColor(calibratedRed:0.13,green:0.145,blue:0.17,alpha:1).cgColor
        window.contentView!.addSubview(view)
    }
    func label(_ text:String,_ x:CGFloat,_ y:CGFloat,_ width:CGFloat=150)->NSTextField {
        let view=NSTextField(labelWithString:text);view.frame=NSRect(x:x,y:y,width:width,height:22)
        view.font = .systemFont(ofSize:12,weight:.medium);view.textColor = .secondaryLabelColor
        window.contentView!.addSubview(view);return view
    }
    func popup(_ names:[String],_ x:CGFloat,_ y:CGFloat,_ width:CGFloat)->NSPopUpButton {
        let view=NSPopUpButton(frame:NSRect(x:x,y:y,width:width,height:28));view.addItems(withTitles:names);view.font = .systemFont(ofSize:13);window.contentView!.addSubview(view);return view
    }
    func combo(_ names:[String],_ x:CGFloat,_ y:CGFloat,_ width:CGFloat)->NSComboBox {
        let view=NSComboBox(frame:NSRect(x:x,y:y,width:width,height:28));view.addItems(withObjectValues:names);view.delegate=self;view.completes=true;view.numberOfVisibleItems=12;view.font = .systemFont(ofSize:13);window.contentView!.addSubview(view);return view
    }
    func number(_ value:Int,_ x:CGFloat,_ y:CGFloat)->NSTextField {
        let view=NSTextField(string:String(value));view.frame=NSRect(x:x,y:y,width:80,height:28);view.font = .monospacedDigitSystemFont(ofSize:14,weight:.medium);view.alignment = .center;window.contentView!.addSubview(view);return view
    }
    func windowWillClose(_ notification:Notification){if game?.isRunning != true {NSApp.terminate(nil)}}
    func applicationDidFinishLaunching(_ notification:Notification) {
        do {
            schema=try launchSchema();settings=schema.defaults
            if let data=try? Data(contentsOf:support.appendingPathComponent("launch-settings.json")),let saved=try? JSONDecoder().decode(LaunchSettings.self,from:data),saved.ports.count==4 {settings=saved}
            let menu=NSMenu(), item=NSMenuItem(), appMenu=NSMenu()
            let discItem=appMenu.addItem(withTitle:"Choose Game Disc…",action:#selector(chooseNewROM),keyEquivalent:"o");discItem.target=self
            appMenu.addItem(withTitle:"Quit OpenSmash Melee",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
            item.submenu=appMenu;menu.addItem(item);NSApp.mainMenu=menu
            window=NSWindow(contentRect:NSRect(x:0,y:0,width:760,height:620),styleMask:[.titled,.closable],backing:.buffered,defer:false)
            window.delegate=self;window.title="OpenSmash Melee";window.level = .floating;window.center()
            window.appearance=NSAppearance(named:.darkAqua)
            window.backgroundColor=NSColor(calibratedRed:0.085,green:0.095,blue:0.115,alpha:1)
            window.titlebarAppearsTransparent=true
            card(12,518,736,90);card(12,376,736,134);card(12,170,736,196);card(12,88,736,42)
            let heading=label("OpenSmash Melee",26,570,500)
            heading.font = .systemFont(ofSize:23,weight:.bold);heading.textColor = .labelColor
            let badge=label("CHOOSE YOUR FIGHTER",520,575,208)
            badge.font = .systemFont(ofSize:10,weight:.semibold);badge.textColor=accent;badge.alignment = .right
            characterKeys=build.characters.map{$0.slug}+schema.fighters.map{"vanilla:\($0.id)"}
            characterNames=build.characters.map{$0.name}+schema.fighters.map{"\($0.label) (Melee)"}
            chosen=combo(characterNames,24,528,710);chosen.selectItem(at:characterKeys.firstIndex(of:option("--character") ?? build.selected) ?? 0)
            _=label("Launch mode",24,480);mode=popup(schema.modes.map{$0.label},24,450,340);mode.selectItem(at:schema.modes.firstIndex{$0.id==settings.mode} ?? 0)
            _=label("Stage",394,480);stage=popup(schema.stages.map{$0.label},394,450,340);stage.selectItem(at:schema.stages.firstIndex{$0.id==settings.stage} ?? 0)
            _=label("CPU level (1–9)",24,422);level=number(settings.level,24,390)
            _=label("Stocks (1–99)",210,422);stocks=number(settings.stocks,210,390)
            _=label("Minutes (0 = unlimited)",394,422,250);minutes=number(settings.minutes,394,390)
            for i in 0..<4 {
                let y=CGFloat(330-i*48)
                let player=label("Player \(i+1)",26,y+3,80)
                player.font = .systemFont(ofSize:12,weight:.semibold)
                player.textColor = i==0 ? accent : .labelColor
                let device=popup(["Keyboard","Gamepad 1","Gamepad 2","Gamepad 3","Gamepad 4","CPU","Off"],108,y,170)
                device.selectItem(at:deviceKeys.firstIndex(of:settings.ports[i].device) ?? 6);devices.append(device)
                let character=combo(["Selected fighter"]+characterNames,294,y,252)
                character.selectItem(at:settings.ports[i].character=="selected" ? 0 : (characterKeys.firstIndex(of:settings.ports[i].character).map{$0+1} ?? 0));characters.append(character)
                let target=popup(["Default target"] + schema.fighters.map { choice in
                    choice.label + ([8,7,0,2,9,6].contains(choice.id) ? "" : ([4,15].contains(choice.id) ? " · big head" : " · experimental"))
                },552,y,182)
                target.selectItem(at:targetIDs.firstIndex(of:settings.ports[i].target ?? -1) ?? 0);targets.append(target)
            }
            refreshTargets()
            label("Target selects the Melee body / moveset for customs. Default uses the original assignment.",24,142,720).font = .systemFont(ofSize:11)
            status=label("Choose your Melee USA v1.02 ROM to play.",54,98,670)
            progress=NSProgressIndicator(frame:NSRect(x:26,y:98,width:18,height:18));progress.style = .spinning;progress.isDisplayedWhenStopped=false;window.contentView!.addSubview(progress)
            status.font = .systemFont(ofSize:13);status.textColor = .labelColor
            play=NSButton(title:"Play Melee",target:self,action:#selector(startGame));play.frame=NSRect(x:548,y:30,width:186,height:48);play.bezelStyle = .rounded;play.bezelColor=NSColor(calibratedRed:0.68,green:0.38,blue:0.17,alpha:1);play.contentTintColor = .white;play.controlSize = .large;play.font = .systemFont(ofSize:15,weight:.semibold);play.image=NSImage(systemSymbolName:"play.fill",accessibilityDescription:nil);play.imagePosition = .imageRight;play.keyEquivalent="\r";play.isEnabled=false;window.contentView!.addSubview(play)
            _=label("\(build.characters.count) bundled custom characters · 26 Melee fighters",24,44,510)
            window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
            chooseROM()
        } catch { showError(error) }
    }
    func comboBoxSelectionDidChange(_ notification:Notification) {DispatchQueue.main.async {self.refreshTargets()}}
    func controlTextDidChange(_ notification:Notification) {refreshTargets()}
    func refreshTargets() {
        guard targets.count==4 else{return}
        for i in 0..<4 {
            let box=characters[i].stringValue=="Selected fighter" ? chosen! : characters[i]
            let key=characterNames.firstIndex(of:box.stringValue).map{characterKeys[$0]}
            let custom=build.characters.first{$0.slug==key}
            let available=custom.map{[$0.fighter]+($0.targets ?? []).map{$0.fighter}} ?? []
            let original=custom.flatMap{character in schema.fighters.first{$0.id==character.fighter}?.label}
            targets[i].item(at:0)?.title=original.map{"Default: " + $0} ?? "Melee target"
            targets[i].autoenablesItems=false
            for j in 1..<targetIDs.count {targets[i].item(at:j)?.isEnabled=available.contains(targetIDs[j])}
            targets[i].isEnabled=custom != nil
            targets[i].toolTip="Melee skeleton and moveset. Only bundled retargets are available."
            if !available.contains(targetIDs[targets[i].indexOfSelectedItem]) {targets[i].selectItem(at:0)}
        }
    }
    @objc func chooseNewROM() {
        guard game?.isRunning != true else {status.stringValue="Close the game before changing its disc.";return}
        chooseROM(force:true)
    }
    func chooseROM(force:Bool=false) {
        guard !preparingDisc else {return}
        var rom:URL?
        if !force && !arguments.contains("--choose-rom"),let path=try? String(contentsOf:support.appendingPathComponent("rom-path.txt"),encoding:.utf8),fm.fileExists(atPath:path){rom=URL(fileURLWithPath:path)}
        if rom==nil {
            let picker=NSOpenPanel();picker.title="Choose Melee USA v1.02";picker.message="Select your unmodified ISO or GCM. Its full hash is checked before importing.";picker.allowsMultipleSelection=false;picker.canChooseDirectories=false
            guard picker.runModal() == .OK else{status.stringValue="Choose Game Disc… from the app menu when you’re ready.";return};rom=picker.url
        }
        guard let rom=rom else{return}
        preparingDisc=true;play.isEnabled=false
        DispatchQueue.global(qos:.userInitiated).async {
            do {
                let game=try prepare(rom,self.build){message in DispatchQueue.main.async{self.status.stringValue=message}}
                DispatchQueue.main.async{self.preparingDisc=false;self.root=game;self.play.isEnabled=true;self.status.stringValue="Ready. Choose your fighter and launch mode.";if arguments.contains("--play"){self.startGame()}}
            }catch{DispatchQueue.main.async{self.preparingDisc=false;self.play.isEnabled=self.root != nil;self.status.stringValue="Disc setup failed. Use Choose Game Disc… in the app menu to retry.";self.showError(error)}}
        }
    }
    func key(_ box:NSComboBox,selectedAllowed:Bool) throws -> String {
        if selectedAllowed && box.stringValue=="Selected fighter" {return "selected"}
        guard let index=characterNames.firstIndex(of:box.stringValue) else {throw Failure(message:"Choose a character from the search suggestions.")};return characterKeys[index]
    }
    @objc func startGame() {
        guard let root=root,game?.isRunning != true else{return}
        do {
            guard let cpu=Int(level.stringValue),let stock=Int(stocks.stringValue),let time=Int(minutes.stringValue) else{throw Failure(message:"Enter whole numbers for CPU level, stocks and minutes.")}
            var ports=[Port]()
            for i in 0..<4 {ports.append(Port(device:deviceKeys[devices[i].indexOfSelectedItem],character:try key(characters[i],selectedAllowed:true),target:targetIDs[targets[i].indexOfSelectedItem] == -1 ? nil : targetIDs[targets[i].indexOfSelectedItem]))}
            settings=LaunchSettings(mode:schema.modes[mode.indexOfSelectedItem].id,stage:schema.stages[stage.indexOfSelectedItem].id,level:cpu,stocks:stock,minutes:time,ports:ports)
            let plan=try launchPlan(settings,selected:try key(chosen,selectedAllowed:false),characters:build.characters,schema:schema)
            try JSONEncoder().encode(settings).write(to:support.appendingPathComponent("launch-settings.json"),options:.atomic)
            play.isEnabled=false;play.title="Starting…";status.stringValue="Preparing your fighters…"
            launchReady=false;launchStarted=Date();progress.startAnimation(nil)
            playActivity=ProcessInfo.processInfo.beginActivity(options:[.userInitiated,.latencyCritical],reason:"Melee gameplay and controller input")
            DispatchQueue.global(qos:.userInitiated).async {
                do {
                    let process=try launch(root,self.build,plan,headless:false)
                    DispatchQueue.main.async{
                        self.game=process;self.bridge=ControllerBridge(plan.settings,user:support.appendingPathComponent("User"))
                        self.status.stringValue="Opening Melee…"
                        self.launchTimer=Timer.scheduledTimer(withTimeInterval:0.2,repeats:true){[weak self] _ in self?.updateLaunchStatus()}
                    }
                    process.waitUntilExit()
                    DispatchQueue.main.async{
                        self.launchTimer?.invalidate();self.launchTimer=nil;self.progress.stopAnimation(nil)
                        self.endPlayActivity()
                        self.bridge=nil;self.game=nil;self.play.isEnabled=true;self.play.title="Play Melee";self.window.makeKeyAndOrderFront(nil)
                        if process.terminationStatus != 0 || !self.launchReady {
                            self.status.stringValue="Melee stopped unexpectedly. Open the log for details."
                            let alert=NSAlert();alert.messageText="Melee \(self.launchReady ? "stopped unexpectedly" : "could not finish starting")"
                            alert.informativeText="The game exited with status \(process.terminationStatus). Your launch settings are saved."
                            alert.addButton(withTitle:"Open game log");alert.addButton(withTitle:"Close")
                            if alert.runModal() == .alertFirstButtonReturn {NSWorkspace.shared.open(support.appendingPathComponent("game.log"))}
                        } else {self.status.stringValue="Game closed. Choose a fighter for another match."}
                    }
                }catch{DispatchQueue.main.async{self.endPlayActivity();self.progress.stopAnimation(nil);self.play.isEnabled=true;self.play.title="Play Melee";self.showError(error)}}
            }
        }catch{showError(error)}
    }
    func endPlayActivity() {if let activity=playActivity {ProcessInfo.processInfo.endActivity(activity);playActivity=nil}}
    func updateLaunchStatus() {
        guard game?.isRunning == true else{return}
        let trace=(try? String(contentsOf:support.appendingPathComponent("game.log"),encoding:.utf8)) ?? ""
        let ready=settings.mode==0 ? trace.contains("[opensmash] combat started") :
            settings.mode==4 ? trace.contains("[staticrecomp] secondary idle first hit") : trace.contains("[opensmash] destination ready")
        if ready {
            launchReady=true;launchTimer?.invalidate();launchTimer=nil;progress.stopAnimation(nil)
            status.stringValue="Melee is running. Close its window to return here.";window.orderOut(nil)
            return
        }
        let phase=trace.contains("[opensmash] stage select ready") ? "Loading stage" :
            trace.contains("[opensmash] character select ready") ? "Loading fighters" : "Starting Melee"
        status.stringValue="\(phase)… \(Int(Date().timeIntervalSince(launchStarted)))s"
        if Date().timeIntervalSince(launchStarted)>15 { status.stringValue += " · Check the game window for a confirmation prompt." }
    }
    func showError(_ error:Error){let alert=NSAlert();alert.messageText="Melee could not start";alert.informativeText=error.localizedDescription;alert.runModal()}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {if game?.isRunning==true{game?.terminate()};return .terminateNow}
}
