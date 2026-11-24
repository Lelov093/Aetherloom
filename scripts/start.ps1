param([switch]$Academy)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentNames = @('UV_CACHE_DIR', 'npm_config_cache', 'electron_config_cache')
if ($Academy) {
    $environmentNames += @('AETHERLOOM_VNEXT_DB', 'AETHERLOOM_VNEXT_ENABLED', 'AETHERLOOM_VNEXT_LAYOUT', 'AETHERLOOM_VNEXT_INTERACTIVE')
}
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $projectRoot
try {
    $env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
    $env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
    $env:electron_config_cache = Join-Path $projectRoot '.cache\electron'
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境准备失败。' }
    if ($Academy) {
        $database = if ($env:AETHERLOOM_DB) { $env:AETHERLOOM_DB } else { Join-Path $projectRoot '.data\aetherloom.db' }
        $python = Join-Path $projectRoot '.venv\Scripts\python.exe'
        & $python (Join-Path $PSScriptRoot 'academy_database.py') $database
        if ($LASTEXITCODE -ne 0) {
            throw '学院入口需要已准备的共享资料库。请核对 AETHERLOOM_DB，或使用 scripts/academy_database.py 的 --new-workspace 选项创建空工作区。'
        }
        $env:AETHERLOOM_VNEXT_DB = $database
        $env:AETHERLOOM_VNEXT_ENABLED = '1'
        $env:AETHERLOOM_VNEXT_LAYOUT = 'shared'
        $env:AETHERLOOM_VNEXT_INTERACTIVE = '1'
    }
    if (-not (Test-Path 'frontend\node_modules')) {
        npm --prefix frontend ci
        if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
    }
    if ($env:AETHERLOOM_VNEXT_ENABLED -eq '1') {
        try {
            & (Join-Path $PSScriptRoot 'build-godot.ps1')
        } catch {
            if ($Academy) { throw "学院 2.5D 资源准备失败。$($_.Exception.Message)" }
            Write-Warning "学院场景准备失败。仍可启动应用并使用文本视图。$($_.Exception.Message)"
        }
    }
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw '界面构建失败。' }
    npm --prefix frontend run desktop
    if ($LASTEXITCODE -ne 0) { throw '桌面应用已异常退出。' }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
