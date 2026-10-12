$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousEnvironment = @{}
foreach ($name in @('UV_CACHE_DIR', 'npm_config_cache', 'electron_config_cache')) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $projectRoot
try {
    $env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
    $env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
    $env:electron_config_cache = Join-Path $projectRoot '.cache\electron'
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境准备失败。' }
    if (-not (Test-Path 'frontend\node_modules')) {
        npm --prefix frontend ci
        if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
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
