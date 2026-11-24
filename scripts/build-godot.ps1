param(
    [string]$GodotExe = $env:AETHERLOOM_GODOT_EXE,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sceneRoot = Join-Path $projectRoot 'frontend\godot\academy'
$assetVersion = 'academy-art-v2'
$exportPath = Join-Path $projectRoot "frontend\public\renderers\academy\$assetVersion"
$manifest = Join-Path $exportPath 'manifest.json'
$sources = @(Get-ChildItem -LiteralPath $sceneRoot -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\(\.godot|assets|__pycache__)\\' -and $_.Extension -in @('.gd','.tscn','.godot','.py','.js')
}) + @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'frontend\public\assets\academy') -Recurse -Filter '*.png' -File)
if (-not $Force -and (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    $exported = $null
    try { $exported = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    $exportTime = (Get-Item -LiteralPath $manifest).LastWriteTimeUtc
    $missing = @('index.html', 'index.js', 'index.pck', 'index.wasm', 'bridge.js') | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $exportPath $_) -PathType Leaf)
    }
    if ($exported.asset_version -eq $assetVersion -and $exported.version -eq 'academy-renderer-v1' -and
        -not $missing -and -not ($sources | Where-Object { $_.LastWriteTimeUtc -gt $exportTime })) {
        Write-Host 'Godot 学院资源已就绪。'
        return
    }
}
if (-not $GodotExe) { $GodotExe = 'D:\Godot\4.7.2\Godot_v4.7.2-stable_win64_console.exe' }
if (-not (Test-Path -LiteralPath $GodotExe)) { throw '需要 Godot 4.7.2。请设置 AETHERLOOM_GODOT_EXE，或用 -GodotExe 指定 console.exe。' }
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.cache\godot\4.7.2\web_nothreads_release.zip'))) {
    & $python (Join-Path $sceneRoot 'fetch_web_templates.py')
    if ($LASTEXITCODE -ne 0) { throw 'Godot Web 模板准备失败。' }
}
& $python (Join-Path $sceneRoot 'build.py') --godot $GodotExe
if ($LASTEXITCODE -ne 0) { throw 'Godot 学院资源构建失败。' }
