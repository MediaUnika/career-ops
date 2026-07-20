# Creates a Desktop shortcut to CareerOps.exe. Run once after build:exe
# (or again if the project folder ever moves).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exePath = Join-Path $root "CareerOps.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "CareerOps.exe not found at $exePath -- run 'npm run build:exe' first."
    exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Career Ops.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7  # Minimized -- the exe itself opens no visible window, but this avoids any flash
$shortcut.Description = "Career Ops dashboard"
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
