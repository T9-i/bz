# ADR-0264 首次引导：一次同意，全部就位

- 状态：采纳
- 日期：2026-10-28
- 相关：ADR-0263（外部工具分发）、ADR-0195（外部工具路径键）、ADR-0242（工具坞值守）

## 背景

ADR-0263 把三个外部工具做成了在线资源，但整条链路上仍有一个空洞：**下载是手动的**。
干净机器上装完插件，用户看到的是一个能打开、但一半功能静默失效的插件——
出错信息散在五个地方（Node 在终端、目录权在文件管理器、工具在面板报错里、Python 在 AI 页、vault 路径谁也看不见）。

对外分发时这条不能留：**「能打开」和「能用」是两件事**，用户没有义务自己拼起来。

同时暴露三个实现缺陷：

1. 插件目录被写死成 `${configDir}/plugins/bz`。用户手动安装时文件夹可能叫任何名字
   （`包仔` / `bz-test` / `bz (1)`），写死的结果不是报错而是**静默错位**：文件写进错误目录，
   症状是「下载成功但功能不可用」，最难归因。
2. 三个工具此前靠 PATH 上的全局 npm 包。对外分发等于没有安装路径。
3. 无人处提示「需要 Node 运行时」却没有获取它的入口（`nodeMissingHint` 指向一个不存在的资源行）。

## 决策

### 1. 首次启动四屏引导（core/setup-wizard）

`① 检测 → ② 清单 → ③ 安装 → ④ 完成`，触发条件：桌面端 + `setupDone !== true` + `onLayoutReady` 后 3 秒。

- **① 检测**：先探网络（GitHub raw 主通道 / jsDelivr 备用，各拉 `downloads/version.json`，6 秒超时按不可达算），
  再探本机（运行环境 / vault 路径 / 插件目录可写 / 数据目录可写 / Node / 三个工具 / Python / AI）。
- **② 清单**：要下什么、多大、下到哪，一屏看完。**这里是唯一的「同意」动作**。
- **③ 安装**：同意后全部自动，不再逐项确认；串行，单项失败不影响其他项。
- **④ 完成**：就绪清单 + 仍需手工的项（脸谱的 Python）。

不做逐项确认的理由：这些动作都不改系统状态（只往插件自己的目录写文件），逐项问等于把同一件事问五遍。
**唯一会改系统状态的是「值守注册登录自启」，那一步不在本流程内**，下载完单独确认（core/tool-setup.ts）。

### 2. 插件目录单一事实源（core/plugin-path）

三层来源，优先级从高到低：`main.ts onload` 注入的 `this.manifest.dir` → `app.plugins.manifests.bz.dir` →
`<configDir>/plugins/bz`。`remote-asset` / `tool-runtime` / `bundle-asset` / 自更新全部经此解析。
`pluginVaultPath()` 给写盘用的相对路径，`pluginDirOf()` 给 spawn 用的绝对路径。

### 3. 便携 Node 运行时（core/zip + core/node-runtime-install）

- Obsidian **不能**当 Node 用（`runAsNode` fuse 被关，实测 `Command "..." not found`），所以只能自带。
- 版本常量 `v24.14.1`；双源 `registry.npmmirror.com`（国内）→ `nodejs.org`（兜底）。
- Windows 官方只发 `.zip` → 自实现极简 zip 读取（stored/deflate，只解指定条目，不整包展开）；
  macOS / Linux 走现成的 `core/tar.ts`。
- 落位 `<插件目录>/downloads/tools/node-runtime/`（Windows `node.exe`，其余 `bin/node`），与探测口径逐字对应。
- 三道验证：条目 crc32 → 字节量级 → 落盘后跑一次 `-v`。**跑不起来就删掉并报错**，
  留一个坏 exe 会让人以为「已经装好了」。

### 4. Python：只探测，不代装

脸谱的依赖是 funasr/torch 一档（pip 下来 GB 级，另需 ffmpeg 与模型文件）。
自动装等于替用户下一个几 GB 的包再赌网络——不能藏在「一键」后面。
`env-check` 里 Python 行**永不判红**，只如实说有没有；完成页给一句提示 + 去哪装。

## 影响

- 新设置键：`setupDone`（含「以后再说」也置 true——不能每次启动都拿同一张清单拦人）。
- 新文件：`core/plugin-path.ts`、`core/zip.ts`、`core/node-runtime-install.ts`、`core/setup-wizard.ts`。
- `core/env-check.ts` 改为**纯探测**（返回带 `fix` 的结构化行），视图迁到 `setup-wizard`；
  「设置 → 关于 → 环境自检」与首次引导共用同一套行渲染与补齐队列。
- `d3-write-gate` 白名单新增 `node-runtime-install.ts`（写的是运行时二进制，不是域数据）。

## 后果与已知限制

- 无网的机器：只能补 Node 之外什么都做不了，界面如实说「等网络恢复后在在线资源里补」。
- Node 归档 36 MB、解出的 node.exe ~80–110 MB，装在插件目录：重装插件会丢，可重下（自愈）。
- 便携 Node 只服务「跑工具」，不含 npm——脸谱要的 pip 依赖与此无关。
