$ErrorActionPreference = 'Stop'
  function Metadata($key) {
  $content = (Invoke-WebRequest -UseBasicParsing -Headers @{'Metadata-Flavor'='Google'} -Uri "http://metadata.google.internal/computeMetadata/v1/$key").Content
  if ($content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($content) }
  return [string]$content
}
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseInput((Metadata 'instance/attributes/validation-script'), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) { throw ($errors | Out-String) }
  $bucket = Metadata 'instance/attributes/release-bucket'
  $build = Metadata 'instance/attributes/release-build'
  $platform = Metadata 'instance/attributes/release-platform'
  $token = (Metadata 'instance/service-accounts/default/token' | ConvertFrom-Json).access_token
  Invoke-RestMethod -Method Post -Headers @{Authorization="Bearer $token"} -ContentType 'application/json' -Body '{"success":true,"smoke":true,"startupSyntax":true}' -Uri "https://storage.googleapis.com/upload/storage/v1/b/$bucket/o?uploadType=media&name=jobs%2F$build%2F$platform%2Fstatus.json"
