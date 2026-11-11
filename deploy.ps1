# deploy.ps1 — تنفيذ النشر التلقائي عبر Python
param(
    [string]$Msg = "auto: update and deploy"
)

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location $PSScriptRoot

python "$PSScriptRoot\auto_deploy.py" $Msg
