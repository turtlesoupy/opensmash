param(
    [switch]$EngineOnly,
    [string]$Inputs = 'build/desktop-inputs/native-inputs-v3.tar.gz',
    [string]$Output = 'build/desktop-runtime-local'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Install Visual Studio C++ Build Tools first.' }
$developerCommand = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$activate = 'call "{0}" -arch=x64 -host_arch=x64 >nul && set' -f $developerCommand
foreach ($line in (& cmd.exe /d /c $activate)) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
if ($LASTEXITCODE) { throw 'Could not activate the Visual Studio developer environment.' }

# Optional machine-local paths for an extracted Microsoft toolset. The normal
# installed-toolchain path needs no configuration file.
$configuration = Join-Path $projectRoot 'build/windows-toolchain.json'
if (Test-Path -LiteralPath $configuration) {
    $localTools = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
    if ($localTools.toolset) {
        $include = Join-Path $localTools.toolset 'include'
        $env:INCLUDE = "$include;$env:INCLUDE"
        $env:LIB = "$(Join-Path $localTools.toolset 'lib/x64');$env:LIB"
        $env:CXXFLAGS = "$env:CXXFLAGS /imsvc`"$include`""
    }
    if ($localTools.compatibilityVersion) {
        $env:CXXFLAGS += " -fms-compatibility-version=$($localTools.compatibilityVersion)"
    }
    if ($localTools.winrtHeaders) {
        $env:CXXFLAGS += " /imsvc`"$($localTools.winrtHeaders)`""
    }
    if ($localTools.redist) { $env:VCToolsRedistDir = $localTools.redist }
}
$env:PATH = "$(Join-Path $projectRoot '.venv/Scripts');$env:ProgramFiles\LLVM\bin;$env:PATH"
$env:CC = 'clang-cl'
$env:CXX = 'clang-cl'
$env:PYTHONUTF8 = '1'
if ($EngineOnly) {
    cmake --build build/desktop-runtime-host --target moderngekko-run opensmash-launch opensmash-controllers opensmash-embedded-test opensmash-mod-dispatch-test opensmash-hash-test opensmash-backend-test opensmash-character-select-test -j 16
    if ($LASTEXITCODE) { throw 'Native compilation failed.' }
    & build/desktop-runtime-host/opensmash-character-select-test.exe
    if ($LASTEXITCODE) { throw 'Character-select/save initialization test failed.' }
    & build/desktop-runtime-host/opensmash-embedded-test.exe build/desktop-runtime-host/embedded-input-test.bin
    if ($LASTEXITCODE) { throw 'Embedded input test failed.' }
    & build/desktop-runtime-host/opensmash-backend-test.exe
    if ($LASTEXITCODE) { throw 'CPU backend selection test failed.' }
    & build/desktop-runtime-host/opensmash-mod-dispatch-test.exe
    if ($LASTEXITCODE) { throw 'Mod dispatch test failed.' }
    & build/desktop-runtime-host/opensmash-hash-test.exe build/desktop-runtime-host/hash-test-data.bin
    if ($LASTEXITCODE) { throw 'SHA-256 test failed.' }
} else {
    python tools/build_desktop_runtime.py $Inputs --output $Output
    if ($LASTEXITCODE) { throw 'Native payload build failed.' }
}
