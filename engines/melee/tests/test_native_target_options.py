"""Exercise native retarget selection without booting or requiring game assets."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('xcrun'), 'requires the macOS Swift toolchain')
class NativeTargetTests(unittest.TestCase):
    def test_target_resolution_slots_compact_and_old_settings(self):
        harness = r'''
import Foundation
let resources=URL(fileURLWithPath:CommandLine.arguments[1])
let fm=FileManager.default
struct Failure: Error {let message:String}
func sha256(_ url:URL) throws -> String {return "unused"}
let schema=try launchSchema()
func costumes(_ prefix:String)->[Costume] {(0..<5).map{Costume(filename:"\(prefix)\($0).dat",path:"\(prefix)/\($0)",sha256:"hash")}}
let mario=Retarget(fighter:8,costumes:costumes("mario"),compactCostumes:costumes("mario-small"))
let lincoln=Character(slug:"lincoln",name:"Lincoln",fighter:0,costumes:costumes("falcon"),compactCostumes:costumes("falcon-small"),targets:[mario])
let other=Character(slug:"other",name:"Other",fighter:0,costumes:costumes("other"),compactCostumes:costumes("other-small"))
var settings=schema.defaults
assert(settings.ports.allSatisfy{$0.target==nil}) // old JSON remains readable
settings.ports=[Port(device:"keyboard",character:"selected",target:8),Port(device:"cpu",character:"vanilla:8"),Port(device:"off",character:"vanilla:0"),Port(device:"off",character:"vanilla:0")]
var plan=try launchPlan(settings,selected:"lincoln",characters:[lincoln,other],schema:schema)
assert(plan.packed[0]&255==8 && (plan.packed[0]>>16)==1)
assert(plan.costumes[0].path=="mario/1") // standard Mario reserves neutral
settings.ports[1]=Port(device:"cpu",character:"lincoln",target:8)
plan=try launchPlan(settings,selected:"lincoln",characters:[lincoln,other],schema:schema)
assert(plan.costumes.count==1 && plan.packed[1]&255==8)
settings.ports[1]=Port(device:"cpu",character:"lincoln")
settings.ports[2]=Port(device:"cpu",character:"other")
plan=try launchPlan(settings,selected:"lincoln",characters:[lincoln,other],schema:schema)
assert(plan.costumes.count==3 && plan.costumes.allSatisfy{$0.path.contains("small")})
assert(plan.packed[0]&255==8 && plan.packed[1]&255==0)
settings.ports[0].target=9
var rejected=false
do {_ = try launchPlan(settings,selected:"lincoln",characters:[lincoln,other],schema:schema)} catch {rejected=true}
assert(rejected)
let saved=try JSONDecoder().decode(LaunchSettings.self,from:JSONEncoder().encode(settings))
assert(saved.ports[0].target==9)
var pair=costumes("popo")
for i in pair.indices {pair[i].companions=[costumes("nana")[i]]}
let ice=Retarget(fighter:14,costumes:pair,compactCostumes:nil)
let probe=Character(slug:"probe",name:"Probe",fighter:0,costumes:costumes("base"),compactCostumes:nil,targets:[ice,Retarget(fighter:3,costumes:costumes("flat"),compactCostumes:nil)])
settings.ports=[Port(device:"keyboard",character:"selected",target:14),Port(device:"cpu",character:"vanilla:14"),Port(device:"off",character:"vanilla:0"),Port(device:"off",character:"vanilla:0")]
plan=try launchPlan(settings,selected:"probe",characters:[probe],schema:schema)
assert(plan.costumes.map{$0.path} == ["popo/1","nana/1"])
settings.ports[0].target=3;settings.ports[1].character="vanilla:3"
rejected=false
do {_ = try launchPlan(settings,selected:"probe",characters:[probe],schema:schema)} catch {rejected=true}
assert(rejected)
print("Native target selection checks passed")
'''
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / 'main.swift').write_text(harness)
            subprocess.run(['xcrun', 'swiftc', str(ROOT / 'runtime/native/LaunchOptions.swift'),
                            str(folder / 'main.swift'), '-o', str(folder / 'check')], check=True)
            subprocess.run([str(folder / 'check'), str(ROOT / 'runtime')], check=True)
