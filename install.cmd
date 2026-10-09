@echo off
setlocal
set "STREAM_DISPLAY_SCRIPT=%~f0"
set "STREAM_DISPLAY_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$text=[IO.File]::ReadAllText($env:STREAM_DISPLAY_SCRIPT); & ([scriptblock]::Create(($text -split '(?m)^# POWERSHELL\r?$',2)[1]))"
set "result=%errorlevel%"
if not defined STREAM_DISPLAY_NO_PAUSE pause
exit /b %result%
# POWERSHELL
$ErrorActionPreference = 'Stop'
try {
    $vencord = Join-Path $env:APPDATA 'Vencord'
    $dest = Join-Path $vencord 'dist'
    $settingsFile = Join-Path $vencord 'settings\settings.json'
    if (-not (Test-Path -LiteralPath (Join-Path $dest 'patcher.js'))) {
        throw 'install vencord first https://vencord.dev/download then open discord once and try again'
    }
    if (Get-Process -Name Discord,DiscordCanary,DiscordPTB -ErrorAction SilentlyContinue) {
        throw 'close discord first. right click its tray icon -> quit discord, then try again'
    }
    $payload = Join-Path $env:STREAM_DISPLAY_ROOT 'dist'
    if ( Test-Path -LiteralPath ( Join-Path $env:STREAM_DISPLAY_ROOT 'checksums.json' ) ) {
    $manifest = Get-Content -LiteralPath (Join-Path $env:STREAM_DISPLAY_ROOT 'checksums.json') -Raw | ConvertFrom-Json
    foreach ($entry in $manifest) {
        $file = Join-Path $payload $entry.Name
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'zip looks broken. download it again and extract it' }
    }
    }
    $backup = Join-Path $vencord ('backup-before-stream-display-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    Copy-Item -LiteralPath $dest -Destination (Join-Path $backup 'dist') -Recurse
    if (Test-Path -LiteralPath $settingsFile) {
        Copy-Item -LiteralPath $settingsFile -Destination (Join-Path $backup 'settings.json')
        $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
    } else { $settings = [pscustomobject]@{} }
    if (-not $settings.plugins) { $settings | Add-Member -NotePropertyName plugins -NotePropertyValue ([pscustomobject]@{}) -Force }
    $settings.plugins | Add-Member -NotePropertyName ForceStreamAspectRatio -NotePropertyValue ([pscustomobject]@{ enabled = $true; aspect = 'off'; mode = 'stretch' }) -Force
    $settings | Add-Member -NotePropertyName autoUpdate -NotePropertyValue $false -Force
    Copy-Item -Path (Join-Path $payload '*') -Destination $dest -Force
    New-Item -ItemType Directory -Path (Split-Path $settingsFile) -Force | Out-Null
    [IO.File]::WriteAllText($settingsFile, ($settings | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    Write-Host 'done. open discord -> right click a stream -> stream display -> stretch' -ForegroundColor Green
    Write-Host 'original turns it off'
    Write-Host 'replaces your vencord build. it will not be auto updated'
    Write-Host "backup: $backup"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
