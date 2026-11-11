# deploy.ps1 - Auto deploy to GitHub + Google Apps Script
param([string]$Msg = "auto")

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location $PSScriptRoot

# 1 GitHub push
Write-Host "[1/4] GitHub Push" -ForegroundColor Cyan
git add -A
if (git status --porcelain) {
    git commit -m $Msg
    git push origin main
    Write-Host "OK: GitHub push done" -ForegroundColor Green
} else { Write-Host "INFO: No changes to push" -ForegroundColor Gray }

# 2 Refresh OAuth token from .clasprc.json
Write-Host "[2/4] Refreshing auth token" -ForegroundColor Cyan
$rc   = Get-Content "$env:USERPROFILE\.clasprc.json" | ConvertFrom-Json
$p    = @{
    client_id     = $rc.oauth2ClientSettings.clientId
    client_secret = $rc.oauth2ClientSettings.clientSecret
    refresh_token = $rc.token.refresh_token
    grant_type    = "refresh_token"
}
$tok  = (Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method POST -Body $p).access_token
Write-Host "OK: Token refreshed" -ForegroundColor Green

# 3 Push Apps Script code via clasp
Write-Host "[3/4] Pushing Apps Script" -ForegroundColor Cyan
clasp push --force
Write-Host "OK: Apps Script pushed" -ForegroundColor Green

# 4 Create new version and redeploy
Write-Host "[4/4] Creating version and redeploying" -ForegroundColor Cyan
$sid = "1Vp6Wv0d3p8bXKQDAJU4vAGy6DEzqRIYwJUNl_ESqxnGJIithIE6AnTCU"
$did = "AKfycbyvlbMc5s8AZ-qpT7d_vEUli1p66dFoi6R1HfHHcuIAGMWP1S43eKNduEbs3gtFUO8"
$h   = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$vb  = ConvertTo-Json @{ description = "auto" }
$vn  = (Invoke-RestMethod -Uri "https://script.googleapis.com/v1/projects/$sid/versions" -Method POST -Headers $h -Body $vb).versionNumber
$db  = ConvertTo-Json @{ versionNumber = $vn; description = "v$vn"; manifestFileName = "appsscript" }
Invoke-RestMethod -Uri "https://script.googleapis.com/v1/projects/$sid/deployments/$did" -Method PUT -Headers $h -Body $db | Out-Null
Write-Host "OK: Redeployed at version $vn" -ForegroundColor Green

Write-Host ""
Write-Host "=== DEPLOY COMPLETE ===" -ForegroundColor Green
Write-Host "Site: https://aliusseins.github.io/post-account-st-bill" -ForegroundColor White
Write-Host "API:  https://script.google.com/macros/s/AKfycbyvlbMc5s8AZ-qpT7d_vEUli1p66dFoi6R1HfHHcuIAGMWP1S43eKNduEbs3gtFUO8/exec" -ForegroundColor White
