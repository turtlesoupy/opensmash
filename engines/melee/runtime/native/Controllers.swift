import Foundation
import GameController
import Darwin

func configureControllers(_ settings:LaunchSettings, user:URL) throws {
    let template=try String(contentsOf:resources.appendingPathComponent("GCPadNew.ini"),encoding:.utf8)
    let keyboard=template.components(separatedBy:"[GCPad2]")[0].components(separatedBy:"\n").dropFirst().joined(separator:"\n")
    let pipes=user.appendingPathComponent("Pipes")
    try fm.createDirectory(at:pipes,withIntermediateDirectories:true)
    var ini=""
    for (index,port) in settings.ports.enumerated() {
        ini += "[GCPad\(index+1)]\n"
        if port.device=="keyboard" { ini += keyboard+"\n" }
        if port.device.hasPrefix("gamepad") {
            let name="opensmash-pad-\(index)",pipe=pipes.appendingPathComponent(name)
            if !fm.fileExists(atPath:pipe.path),mkfifo(pipe.path,0o600) != 0 { throw Failure(message:"Could not create controller pipe.") }
            ini += "Device = Pipe/0/\(name)\n"
            for key in ["A","B","X","Y","Z","Start"] { ini += "Buttons/\(key) = `Button \(key == "Start" ? "START" : key)`\n" }
            for (group,axis) in [("Main Stick","MAIN"),("C-Stick","C")] {
                for (direction,sign) in [("Up","Y +"),("Down","Y -"),("Left","X -"),("Right","X +")] {
                    ini += "\(group)/\(direction) = `Axis \(axis) \(sign)`\n"
                }
                ini += "\(group)/Calibration = 100.00\n"
            }
            for key in ["L","R"] { ini += "Triggers/\(key) = `Button \(key == "Start" ? "START" : key)`\nTriggers/\(key)-Analog = `Axis \(key) +`\n" }
        }
    }
    try ini.write(to:user.appendingPathComponent("Config/GCPadNew.ini"),atomically:true,encoding:.utf8)
}
final class ControllerBridge {
    var timer:Timer?
    var files=[Int:Int32]()
    init(_ settings:LaunchSettings,user:URL) {
        GCController.shouldMonitorBackgroundEvents=true
        for (i,p) in settings.ports.enumerated() where p.device.hasPrefix("gamepad") {
            let fd=open(user.appendingPathComponent("Pipes/opensmash-pad-\(i)").path,O_RDWR|O_NONBLOCK)
            if fd>=0 { files[i]=fd }
        }
        timer=Timer.scheduledTimer(withTimeInterval:1.0/120,repeats:true) {[weak self] _ in
            guard let self=self else{return}
            let controllers=GCController.controllers()
            for (port,fd) in self.files {
                let index=Int(settings.ports[port].device.suffix(1))!,g=index<controllers.count ? controllers[index].extendedGamepad : nil
                let buttons:[(String,Bool)]=[("A",g?.buttonA.isPressed ?? false),("B",g?.buttonB.isPressed ?? false),("X",g?.buttonX.isPressed ?? false),("Y",g?.buttonY.isPressed ?? false),("Z",g?.rightShoulder.isPressed ?? false),("START",g?.buttonMenu.isPressed ?? false),("L",g?.leftTrigger.isPressed ?? false),("R",g?.rightTrigger.isPressed ?? false)]
                var message=buttons.map{"\($0.1 ? "PRESS" : "RELEASE") \($0.0)\n"}.joined()
                message += "SET MAIN \(((g?.leftThumbstick.xAxis.value ?? 0)+1)/2) \(((g?.leftThumbstick.yAxis.value ?? 0)+1)/2)\n"
                message += "SET C \(((g?.rightThumbstick.xAxis.value ?? 0)+1)/2) \(((g?.rightThumbstick.yAxis.value ?? 0)+1)/2)\n"
                message += "SET L \(g?.leftTrigger.value ?? 0)\nSET R \(g?.rightTrigger.value ?? 0)\n"
                message.withCString{ _ = write(fd,$0,strlen($0)) }
            }
        }
    }
    deinit {timer?.invalidate();for fd in files.values{close(fd)}}
}
