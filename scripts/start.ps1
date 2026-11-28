param([switch]$Academy, [switch]$TextSimulation, [switch]$SourceWorkspace)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$TextSimulation = $TextSimulation -or $SourceWorkspace
$environmentNames = @('UV_CACHE_DIR', 'npm_config_cache', 'electron_config_cache')
if ($SourceWorkspace) { $environmentNames += @('AETHERLOOM_DB', 'ELECTRON_GET_USE_PROXY') }
if ($Academy -or $TextSimulation) {
    $environmentNames += @('AETHERLOOM_VNEXT_DB', 'AETHERLOOM_VNEXT_ENABLED', 'AETHERLOOM_VNEXT_LAYOUT', 'AETHERLOOM_VNEXT_INTERACTIVE')
}
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $projectRoot
try {
    if ($SourceWorkspace) {
        node (Join-Path $projectRoot 'frontend\electron\launch.cjs') --aetherloom-focus
        if ($LASTEXITCODE -eq 0) { return }
        if ($LASTEXITCODE -ne 2) { throw '无法打开已运行的桌面窗口。' }
        if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { $env:ELECTRON_GET_USE_PROXY = '1' }
    }
    $env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
    $env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
    $env:electron_config_cache = Join-Path $projectRoot '.cache\electron'
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境准备失败。' }
    if ($Academy -or $TextSimulation) {
        $python = Join-Path $projectRoot '.venv\Scripts\python.exe'
        $workspaceTool = Join-Path $PSScriptRoot 'academy_database.py'
        if ($SourceWorkspace -and -not $env:AETHERLOOM_DB) {
            $env:AETHERLOOM_DB = Join-Path $projectRoot '.data\workspace\aetherloom.db'
            if (-not (Test-Path -LiteralPath $env:AETHERLOOM_DB)) {
                & $python $workspaceTool $env:AETHERLOOM_DB --new-workspace
                if ($LASTEXITCODE -ne 0) { throw '空工作区创建失败。请核对资料库路径。' }
            }
        }
        $database = if ($env:AETHERLOOM_DB) { $env:AETHERLOOM_DB } else { Join-Path $projectRoot '.data\aetherloom.db' }
        & $python $workspaceTool $database
        if ($LASTEXITCODE -ne 0) {
            throw '文本模拟需要已准备的共享资料库。请核对 AETHERLOOM_DB，或使用 scripts/academy_database.py 的 --new-workspace 选项创建空工作区。'
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
    if ($env:AETHERLOOM_VNEXT_ENABLED -eq '1' -and ($Academy -or -not $TextSimulation)) {
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
