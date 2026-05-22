# update.ps1
# Pull the latest code for the current branch, clear the Next.js cache,
# install deps if they changed, and start the dev server.
#
# Usage (from the project folder):
#   .\update.ps1
#
# If you get "running scripts is disabled on this system", run once:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"

# Always work from the folder this script lives in.
Set-Location -Path $PSScriptRoot

# Detect the current git branch.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Branch: $branch" -ForegroundColor Cyan

# Pull with simple retry/backoff for flaky networks.
$delays = @(2, 4, 8, 16)
$pulled = $false
for ($i = 0; $i -le $delays.Count; $i++) {
    git pull origin $branch
    if ($LASTEXITCODE -eq 0) { $pulled = $true; break }
    if ($i -lt $delays.Count) {
        $wait = $delays[$i]
        Write-Host "git pull failed. Retrying in $wait s..." -ForegroundColor Yellow
        Start-Sleep -Seconds $wait
    }
}
if (-not $pulled) {
    Write-Host "git pull failed after retries. Aborting." -ForegroundColor Red
    exit 1
}

# Install dependencies only if package-lock.json changed in this pull.
$changed = git diff --name-only "HEAD@{1}" HEAD 2>$null
if ($changed -match "package-lock.json" -or $changed -match "package.json") {
    Write-Host "Dependencies changed. Running npm install..." -ForegroundColor Cyan
    npm install
}

# Clear the Next.js build cache to avoid stale server output.
if (Test-Path ".next") {
    Write-Host "Clearing .next cache..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force ".next"
}

Write-Host "Starting dev server (Ctrl+C to stop)..." -ForegroundColor Green
npm run dev
