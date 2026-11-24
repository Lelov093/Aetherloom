# Aetherloom

**0.7.0 · Windows 源码版**

Aetherloom 是面向小说作者与世界构建创作者的本地桌面工作台。你可以整理正文、设定和大纲，建立人物、地点、事件与关系，再从一个明确的起点观察世界如何演化。整理、阅读、检索、关联资料和体验内置学院都可以在无模型配置的情况下开始。

## 主要功能

| 模块 | 你可以做什么 |
| --- | --- |
| 创作与阅读 | 建立世界和作品，导入 TXT、Markdown、DOCX、PDF，按分类和标签浏览。把人物、地点和正式记录关联到资料版本或具体原文选区。 |
| 探索 | 在关系、时间和 Canon Map 之间导航，查看来源和正式记录。时间视图按明确年份展示，地图显示已记录的地点和连通。焦点、筛选和布局可保存到本机。 |
| 世界模拟 | 使用原有文本准备流程，或从学院模板配置并冻结起点。学院有庭院、教室、图书馆、校外街区和六个可选角色槽位。文本与 2.5D 打开同一条世界线，可查看历史、分叉和比较。 |
| 审阅与灵感 | 从已提交的世界线结果中选取内容，保存为带来源的灵感或提交审阅。正式设定在作者明确接受提案后才会更新。 |

## 准备运行环境

| 工具 | 用途 |
| --- | --- |
| Git | 获取和更新源码。[Git 下载](https://git-scm.com/download/win) |
| Node.js 22.12 或更高版本与 npm | 安装前端依赖、构建界面和运行 Electron。[Node.js 下载](https://nodejs.org/en/download) |
| uv | 按锁文件准备项目内的 Python 3.12 环境。[uv 安装指南](https://docs.astral.sh/uv/getting-started/installation/) |
| Godot 4.7.2 Standard | 体验学院 2.5D 时使用 Windows 控制台版可执行文件。启动脚本会按需获取匹配的 Web 导出模板并生成场景资源。[Godot 4.7.2 下载](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable) |

首次准备需要网络。可在 PowerShell 中用 `git --version`、`node --version`、`npm --version` 和 `uv --version` 检查工具是否可用。

## 获取并启动

在 PowerShell 中获取源码。如果你已下载源码压缩包，解压后打开其中包含 `pyproject.toml` 的目录即可。

```powershell
git clone https://github.com/Lelov093/Aetherloom.git
Set-Location Aetherloom
```

### 整理资料或使用原有文本模拟

```powershell
.\scripts\start.ps1
```

启动后先「创建世界」，再到「创作」建立作品、导入资料并核对转换结果。可以从「世界对象」建立人物与地点，补充正式记录和原文来源，再到「探索」浏览关系、时间与地图。

### 启动学院 2.5D

学院需要已准备的共享资料库。首次体验可用以下命令创建空的学院工作区。将 Godot 路径替换为你解压后的 `console.exe` 路径。

```powershell
$env:AETHERLOOM_GODOT_EXE = 'C:\Tools\Godot\Godot_v4.7.2-stable_win64_console.exe'
uv --cache-dir .cache/uv run --frozen python scripts/academy_database.py .data/academy/aetherloom.db --new-workspace
$env:AETHERLOOM_DB = (Resolve-Path -LiteralPath .data/academy/aetherloom.db).Path
.\scripts\Start-Academy.cmd
```

之后可跳过创建命令，在启动用的 PowerShell 会话指定同一个 `AETHERLOOM_DB`。已有共享资料库时也可直接指定其路径。旧版资料库可继续用常规入口打开。学院的创建命令要求目标目录全新，因此可以把新工作区与旧资料分开保存。

1. 在世界库创建或打开世界，进入「模拟 → 学院与周边街区 → 配置学院起点」。
2. 选择角色槽位、外观和初始地点，可绑定作品中的角色或地点。展开「核对本次起点」，确认采用的资料和规则后点「保存并进入世界」。
3. 世界线保存后处于暂停状态。「文本」与「2.5D」可以随时切换。在作者观察模式点击出口可浏览相邻地点。在角色参与模式，先选中角色，再点出口并在弹窗中确认移动。
4. 场景资源加载出错时，可重试、返回同一世界线的文本，或使用可用的兼容视图。

## 可选模型配置

原有文本场景需要在显式点击「继续运行」时使用适配的模型。配置文件是项目根目录下的 `.env`。首次配置可从 [.env.example](.env.example) 复制一份后编辑。

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

| 字段 | 填写内容 |
| --- | --- |
| `AETHERLOOM_PROVIDER` | 接口协议类型，需符合应用与模型服务的兼容范围。 |
| `AETHERLOOM_API_BASE_URL` | 模型服务提供的 API 基础地址。按文档填写所需的路径前缀。 |
| `AETHERLOOM_API_KEY` | 你自己的 API 密钥，保存在本机的 `.env`。 |
| `AETHERLOOM_CREATOR_MODEL` | 服务端提供且应用支持的准确模型标识。 |
| `AETHERLOOM_REQUEST_TIMEOUT_SECONDS` | 可选请求超时时间，单位为秒。 |

保存配置后从托盘退出并重启。同名进程环境变量优先于 `.env`。启用模型后，实际请求会将本次使用的资料或角色上下文发送到所配置的服务。

在「模拟 → 准备新场景」选择参与者、时间起点、角色已知信息和规则，核对后创建一条暂停的世界线。需要模型驱动它时再点「继续运行」。可在「审阅」中比较、修改、拒绝或接受选中的结果。

## 模块与设计

| 位置 | 职责 |
| --- | --- |
| [前端工作区](frontend/src) | React、TypeScript 和 Vite 提供创作、探索、模拟与审阅界面。 |
| [桌面宿主](frontend/electron) | Electron 管理桌面窗口、托盘和本地 API 进程。 |
| [本地服务](src/aetherloom) | Python、FastAPI 和 SQLite 管理资料、来源、正式记录及本地模拟。 |
| [世界 Runtime](src/aetherloom/runtime) | 冻结场景起点，按规则裁决行动，保存世界线和历史，为作者与角色分别提供授权视图。 |
| [学院表现层](frontend/godot/academy) | Godot Web 渲染学院 2.5D，兼容视图使用 Three.js。地图、镜头和动作动画只负责展示已提交的世界状态。 |

资料与作者意图、正式设定（Canon）、模拟中的世界状态分别保存。角色视图还区分本人掌握的知识、信念和听到的报告。作者可以查看获授权的世界线历史，角色参与视角只查看所在场景及自身可见内容。

## 数据保存与常见问题

- 常规资料库位于 `.data/aetherloom.db`，学院使用 `AETHERLOOM_DB` 指定的库。导入原件存放在对应资料库旁的 `imports/`，桌面偏好默认位于 `.data/desktop/`。
- 关闭窗口会将应用收起到托盘。需要结束、换资料库或更新源码时，从托盘选择「暂停保存并退出」。重开后可查看已保存的状态。
- 如果 PowerShell 阻止启动脚本，可用以下命令在本次启动时指定执行策略。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

- 学院启动提示找不到 Godot 时，检查 `AETHERLOOM_GODOT_EXE` 是否指向解压后的控制台版程序。看到共享资料库提示时，确认已执行首次创建命令，并且启动窗口能读取同一个 `AETHERLOOM_DB`。
- 如果 Electron 下载失败且你的网络通过代理访问 GitHub，请在启动用的 PowerShell 会话配置 `HTTPS_PROXY`，设置 `$env:ELECTRON_GET_USE_PROXY = '1'` 后重新启动。
- 桌面无法启动时，先看启动窗口输出，再查 `.logs/desktop-service.log`。导入 DOCX 或 PDF 后，建议核对复杂排版和识别结果。

当前空间体验限于一套固定学院场景。年份探索依赖已录入的明确年份。可执行的模拟规则、支持的模型服务和角色规模以场景设置及界面提示为准。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)，版权信息见 [NOTICE](NOTICE)。第三方软件适用各自的许可证。用户保有对自己导入的资料的权利。
