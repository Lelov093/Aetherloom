# Aetherloom

Aetherloom 是面向小说作者与世界构建创作者的本地桌面工作台。把正文、设定和大纲整理在同一个世界中，沿人物、地点、时期和出处浏览，再用一条文本世界线推演「如果他们现在见面会怎样」。推演片段可带回灵感库，正式设定由作者直接编辑。

## 能做什么

| 模块 | 用法 |
|---|---|
| 世界与作品 | 在一个世界下整理多部作品、章节、场景和资料。导入 TXT、Markdown、DOCX 或 PDF，保留来源版本及可下载的原件。 |
| 对象与探索 | 管理人物、地点、事件等对象。按分类、关系、时期和作者地图浏览，从对象回查相关作品、片段和设定。 |
| 文本模拟 | 从正文或世界首页选定背景、角色、位置和开场，冻结出发资料。按规则推进或暂停，查历史、分叉、重开、比较分支。角色使用各自可知的信息。 |
| 灵感与导出 | 把选中的已提交消息带回章幕侧栏，从灵感打开原步和冻结出处。作者可将灵感关联到改写后的正文，按目录选择内容，交付读者稿或导出世界资料。 |

## Windows 源码运行

安装 **Node.js 22.12 或更高版本**（含 npm）和 **uv**。首次准备依赖需要联网。uv 按仓库配置准备 Python 3.12，并将 Python 依赖安装到项目内的 `.venv`。[Node.js 下载](https://nodejs.org/en/download) · [uv 安装](https://docs.astral.sh/uv/getting-started/installation/)

在 GitHub 仓库选择 **Code → Download ZIP**，解压后进入含 `pyproject.toml` 的目录。如果已安装 Git，也可以用下面的命令获取源码。[GitHub 下载源码说明](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)

```powershell
git clone https://github.com/Lelov093/Aetherloom.git
Set-Location Aetherloom
```

### 打开工作区

在源码目录双击 [Start.cmd](Start.cmd)。首次运行会准备锁定依赖、创建本地工作区、构建界面并打开桌面。此后从同一目录启动即可打开原工作区。应用已经运行时，再次双击会显示现有窗口。

### 从世界到读者稿

1. 从「世界库 → 创建世界」进入工作区。在「创作」建立一部作品并导入资料，录入会出场的人物和地点。用「探索」查对象关系及原文出处。
2. 打开要推演的章幕，点「更多正文操作 → 从此处准备模拟」。选择背景、角色、地点和开场，确认资料与角色所知，再保存起点。也可从世界首页点「准备文本模拟」。
3. 在世界线里提交角色行动或按规则推进。对感兴趣的已提交消息点「回查原话 → 保存为灵感」，再回到发起章幕的灵感侧栏。
4. 用灵感辅助改写正文。到作品的「导出作品」选「读者稿」，预览目录后选择导出位置。可直接打开导出的正文和随稿资源。

## 配置

### 工作区路径

默认工作区数据库是 `.data/workspace/aetherloom.db`，导入原件保存在数据库旁的 `imports/`。桌面配置位于 `.data/desktop/`。整理、写作、浏览与规则推进可以直接使用默认配置。

要打开其他工作区，先退出当前桌面，在含 `Start.cmd` 的源码目录打开 PowerShell，将 `AETHERLOOM_DB` 设为目标数据库的绝对路径，再执行 `Start.cmd`。

```powershell
$env:AETHERLOOM_DB = 'D:\我的工作区\aetherloom.db'
.\Start.cmd
```

### 可选模型服务

文本模拟默认使用无模型路径。要配置可选模型服务，在源码目录将 [`.env.example`](.env.example) 复制为 `.env`。如果已有 `.env`，请直接编辑该文件。真实密钥只放在本机的 `.env`。

| `.env` 字段 | 填写内容 |
|---|---|
| `AETHERLOOM_PROVIDER` | 服务协议。使用模板中的 `openai-compatible`。 |
| `AETHERLOOM_API_BASE_URL` | 服务提供的 API 根地址。若要求版本路径（如 `/v1`），将其一起填入。 |
| `AETHERLOOM_API_KEY` | 该服务颁发的密钥。 |
| `AETHERLOOM_CREATOR_MODEL` | 服务接受的完整模型标识。 |
| `AETHERLOOM_REQUEST_TIMEOUT_SECONDS` | 可选的单次请求超时时间，单位为秒。 |

模型运行依赖 [Runtime 适配器](src/aetherloom/runtime/model_provider.py)支持的服务和模型，并要求本地宿主已批准并分配本轮额度。已具备这些条件时，可在 PowerShell 指定独立的模型账本并启用模型，再启动应用。请将账本示例路径改成自己的账本位置。

```powershell
$env:AETHERLOOM_VNEXT_MODEL = '1'
$env:AETHERLOOM_VNEXT_MODEL_LEDGER = Join-Path (Get-Location).Path '.data\model-ledger.db'
.\Start.cmd
```

模型账本和工作区数据库使用不同文件。实际模型调用会把本场需要的上下文发给你配置的服务。要切回无模型运行，退出桌面，把 `AETHERLOOM_VNEXT_MODEL` 设为 `0`，再启动。

## 保存与退出

- 关闭窗口会收起到系统托盘。双击 [Stop.cmd](Stop.cmd) 或从托盘选择「暂停保存并退出」，应用会先确认暂停保存，再退出。
- 更新源码前先退出应用并[备份工作区](#备份与恢复工作区)。更新后可在源码目录用 `npm --prefix frontend ci` 同步锁定的前端依赖，再从同一路径启动。

## 备份与恢复工作区

先双击 `Stop.cmd` 或从托盘选择「暂停保存并退出」。等应用退出后，在源码目录打开 PowerShell。如果刚解压源码，先运行 `uv sync --frozen` 准备项目内的 `.venv`。

### 备份

下面以默认资料库为例。如果通过 `AETHERLOOM_DB` 使用了其他库，把 `$workspaceDb` 改成实际资料库的绝对路径。每次备份选择一个尚不存在的目录。

```powershell
$workspaceDb = Join-Path (Get-Location).Path '.data\workspace\aetherloom.db'
$backupDir = Join-Path $env:USERPROFILE 'Aetherloom-backups\before-update'
.\.venv\Scripts\python.exe -X utf8 -m aetherloom.workspace_backup backup --database $workspaceDb --destination $backupDir
```

备份目录内的 `database.db` 和 `resources` 应一起保留。`resources` 包含工作区保存的导入原件。

### 恢复并打开

让 `$backupDir` 指向完整备份，用另一个尚不存在的目录接收恢复工作区。恢复成功后，在同一 PowerShell 窗口设置 `AETHERLOOM_DB` 并启动。

```powershell
$backupDir = Join-Path $env:USERPROFILE 'Aetherloom-backups\before-update'
$restoreDir = Join-Path $env:USERPROFILE 'Aetherloom-restored'
.\.venv\Scripts\python.exe -X utf8 -m aetherloom.workspace_backup restore --backup $backupDir --destination $restoreDir
if ($LASTEXITCODE -eq 0) {
    $env:AETHERLOOM_DB = Join-Path $restoreDir 'aetherloom.db'
    .\Start.cmd
}
```

恢复后可打开原作品正文，从资料侧栏下载导入原件，并从已有灵感回到原模拟步骤。若命令提示资料库损坏或缺少原件，换一份完整备份再恢复。以后从新的 PowerShell 窗口打开恢复库时，重新设置 `AETHERLOOM_DB` 再运行 `Start.cmd`。

## 项目结构与技术栈

| 源码路径 | 职责 |
|---|---|
| [`frontend/electron`](frontend/electron) | Electron 桌面入口。启动本地服务，处理窗口、托盘、保存退出和本机文件对话框。 |
| [`frontend/src/features`](frontend/src/features) | React 与 TypeScript 的世界库、编辑器、探索、文本模拟、灵感和导出界面。正文编辑使用 Tiptap，Vite 负责构建。 |
| [`src/aetherloom`](src/aetherloom) | Python 3.12 服务。FastAPI 与 Uvicorn 通过本机回环地址提供接口，SQLite 保存工作区和版本记录。 |
| [`src/aetherloom/runtime`](src/aetherloom/runtime) | 管理世界线冻结起点、角色知情、行动裁决、已提交事件和分支。可选模型只提出行动，具体结果由 Runtime 依规则提交。 |
| [`scripts/start.ps1`](scripts/start.ps1) | Windows 源码启动流程。准备锁定依赖，选择或创建共享工作区，构建并启动桌面。 |

## 启动遇到问题

- 提示找不到 `uv` 或 `npm` 时，重新打开 PowerShell，用 `uv --version`、`node --version` 和 `npm --version` 核对工具。
- 可在源码目录打开 PowerShell 运行 `.\Start.cmd` 和 `.\Stop.cmd` 查看命令输出。
- 提示需准备共享资料库时，确认 `AETHERLOOM_DB` 指向已存在的共享库。
- 首次启动需要从 GitHub 下载 Electron。如果网络通过代理访问 GitHub，在同一个 PowerShell 窗口设置网络提供的 `HTTPS_PROXY`，再运行 `.\Start.cmd`。[Electron 代理说明](https://www.electronjs.org/docs/latest/tutorial/installation#proxies)
- 桌面服务未能启动时，查看启动窗口的输出和 `.logs/desktop-service.log`。
- 启用模型后启动失败时，检查适配器支持范围、`.env` 和账本路径。需要继续整理或写作时，可先将 `AETHERLOOM_VNEXT_MODEL` 设为 `0`，再启动桌面。

## 许可证

项目采用 [Apache License 2.0](LICENSE)，版权信息见 [NOTICE](NOTICE)。第三方软件适用各自的许可证，作者保有自己导入资料的权利。
