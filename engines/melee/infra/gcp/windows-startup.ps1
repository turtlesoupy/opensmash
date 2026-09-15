$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONUTF8 = '1'
$reported = $false
try {
New-Item C:\opensmash -ItemType Directory -Force | Out-Null
Start-Transcript -Path C:\opensmash-build.log
function Metadata($key) {
  $content = (Invoke-WebRequest -UseBasicParsing -Headers @{'Metadata-Flavor'='Google'} -Uri "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$key").Content
  if ($content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($content) }
  return [string]$content
}
$env:RELEASE_BUCKET = Metadata 'release-bucket'
$env:RELEASE_BUILD = Metadata 'release-build'
$env:RELEASE_PLATFORM = Metadata 'release-platform'
# The VM and disk are deleted after this build; no permanent Windows host.
Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install visualstudio2022buildtools -y --no-progress --execution-timeout=3600 --package-parameters='--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart'
if ($LASTEXITCODE -notin @(0,3010)) { throw 'Visual Studio installation failed' }
choco install python --version=3.12.10 -y --no-progress
if ($LASTEXITCODE -notin @(0,3010)) { throw 'Python installation failed' }
choco install nodejs-lts git llvm ccache -y --no-progress
if ($LASTEXITCODE -notin @(0,3010)) { throw 'Build tool installation failed' }
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')+';C:\Python312;C:\Python312\Scripts;C:\Program Files\LLVM\bin;C:\Program Files\Git\cmd'
python -m pip install google-cloud-storage
if ($LASTEXITCODE -ne 0) { throw 'Cloud storage client installation failed' }
Set-Location C:\opensmash
@'
import os,tarfile
from google.cloud import storage
b=storage.Client().bucket(os.environ['RELEASE_BUCKET'])
b.blob('jobs/'+os.environ['RELEASE_BUILD']+'/source.tar.gz').download_to_filename('C:/source.tar.gz')
with tarfile.open('C:/source.tar.gz') as t:t.extractall('.',filter='data')
'@ | python -
if ($LASTEXITCODE -ne 0) { throw 'Source staging failed' }
$vs = & 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe' -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$dev = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
@"
@echo off
call "$dev" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
python infra/gcp/worker.py --build "$env:RELEASE_BUILD" --platform "$env:RELEASE_PLATFORM"
exit /b %errorlevel%
"@ | Set-Content C:\run-build.cmd
& cmd.exe /c C:\run-build.cmd
$buildExitCode = $LASTEXITCODE
Stop-Transcript
@'
import os
from pathlib import Path
from google.cloud import storage
bucket=storage.Client().bucket(os.environ['RELEASE_BUCKET'])
storage.Client().bucket(os.environ['RELEASE_BUCKET']).blob('jobs/'+os.environ['RELEASE_BUILD']+'/'+os.environ['RELEASE_PLATFORM']+'/build.log').upload_from_filename('C:/opensmash-build.log')
status=Path('build/gcp-status.json')
if status.exists(): bucket.blob('jobs/'+os.environ['RELEASE_BUILD']+'/'+os.environ['RELEASE_PLATFORM']+'/status.json').upload_from_filename(status)
'@ | python -
if ($LASTEXITCODE -eq 0) { $reported = $true }
} finally {
  if (-not $reported -and $env:RELEASE_BUCKET -and $env:RELEASE_BUILD) {
    try {
      $token = ((Invoke-WebRequest -UseBasicParsing -Headers @{'Metadata-Flavor'='Google'} -Uri 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token').Content | ConvertFrom-Json).access_token
      Invoke-RestMethod -Method Post -Headers @{Authorization="Bearer $token"} -ContentType 'application/json' -Body '{"success":false,"phase":"bootstrap"}' -Uri "https://storage.googleapis.com/upload/storage/v1/b/$env:RELEASE_BUCKET/o?uploadType=media&name=jobs%2F$env:RELEASE_BUILD%2F$env:RELEASE_PLATFORM%2Fstatus.json"
    } catch { Write-Error $_ -ErrorAction Continue }
  }
  # Coordinator deletes us; if it disappears, the GCE runtime deadline deletes us.
}
exit $buildExitCode
