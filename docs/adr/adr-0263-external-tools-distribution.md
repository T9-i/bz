# ADR-0263：对外分发——外部工具进在线资源、自更新走 tag、插件标记桌面端专属

- 日期：2026-10-28
- 状态：已采纳
- 相关：ADR-0203（下载清单与在线资源组）· ADR-0199（皮肤远端分发）· ADR-0195（外部工具路径键）· ADR-0242（值守进程）
- 代码：`src/core/{bundle-asset,tar,tool-runtime,tool-setup,env-check,about-group,self-update}.ts` · `scripts/build-tools-pack.mjs` · `src/settings-panel/online-resources.ts`

## 背景

插件从「自用」转向「给别人用」。自用阶段有三件事是默认成立的，对外分发时三件都不成立：

1. **外部工具住在 PATH 上**。`bili-dl`（知识盒）、`bz-face`（脸谱）、`node`（值守）都靠
   `npm install -g` / `npm link` 装到全局；装了才能用，没装就报「找不到命令」，而安装指引
   写的是一条需要终端、npm、权限的命令。对外等于没有指引。
2. **自更新直接覆盖 main.js/styles.css/manifest.json**，且从 `master` 拉。等于作者每推一次
   主干，所有用户的插件当场换代码——包括半成品；而且没有回滚，推一次坏包所有人焊死
   （自更新代码本身就在坏包里，没人能自救）。
3. **`isDesktopOnly: false`**，但一半功能依赖 `window.require('child_process' / 'fs')`。
   手机端装得上、打得开，然后一部分功能静默无反应。

## 决策

### 1. 目录包（bundle）作为在线资源的第二种形态

清单 `docs[]` 加可选字段 `kind: 'doc' | 'bundle'`（缺省 doc）：

- `doc`：单文件文本/JSON，落盘即用（手册、日志、分类表、RSS 源库）——不变；
- `bundle`：`.tar.gz` 目录包，下载 → 字节 sha256 校验 → 解包到
  `<插件目录>/downloads/tools/<id>/` → 写 `.bz-bundle.json` 就绪标记。

**为什么是 tar.gz 而不是 zip**：Node 内置只有 gzip，没有 zip 解包；tar 的头是一个 512 字节
定长结构，解析器不到百行、可单测（`core/tar.ts`）。zip 要中央目录 + deflate 流 + CRC，
同一目标下代码量与出错面都更大。

**为什么就绪看标记不看逐文件 hash**：脸谱包 224 个文件，每次开面板算 224 次 sha256 是纯浪费。
标记记着「这份目录从哪个 sha256 的归档解出来」——清单变了标记就对不上，状态自动变「有更新」；
解包中途崩溃留下半份目录但没有标记，下次照样重解（自愈）。

**为什么哈希分两套口径**：文本资源走 `textSha256`（先归一换行，CRLF/LF 不会算出两个值）；
二进制包走 `sha256Bytes`（归一换行会把压缩流改坏）。构建脚本与插件端必须成对使用。

### 2. 运行时探测：本地包优先，PATH 兜底

`core/tool-runtime.ts` 解析「用谁跑」：

| 条件 | 结果 |
|---|---|
| 包在 + 有 Node | 绝对路径 + 参数数组（`shell:false`） |
| 没包 / 没 Node | 回落 PATH 上的命令名（`shell:true`，与 2026-10-28 之前完全一致） |

**为什么不用 Obsidian 自己的 exe 当 node**：实测不可行。Obsidian 关掉了 Electron 的
`runAsNode` fuse，`ELECTRON_RUN_AS_NODE=1 obsidian.exe script.js` 会被当成 Obsidian 自己的
CLI 命令，回一句 `Command "…" not found`。所以解释器只能另找：插件内便携 node → 系统 node。

`shell:false` 是顺带的红利：此前 `.cmd` shim 必须走 shell，而 cmd 对引号、空格、中文、`&`
的解析是 Windows 上最经典的一类坑（vault 路径带空格或中文是常态）。数组参数没有这一层。

### 3. 「下载完自动初始化」按工具分档，不假装齐平

| 工具 | 下载后 | 是否真能「下载即用」 |
|---|---|---|
| B站下载器（~26KB，零 npm 依赖） | 无 | 是（前提：有 Node） |
| 工具坞值守（~46KB，纯 Node） | 注册登录自启（跑包里的 install.ps1） | 是，但**必须经人确认**（它在改系统状态） |
| 脸谱工具包（~177KB，Node 外壳 + vendored Python） | 生成 shim 由 tool-runtime 承担；Python 依赖（funasr/torch/pycryptodome）装不了 | **否**——只能做到「外壳就位 + 如实说还差什么」 |

脸谱的 Python 依赖是 GB 级 pip 安装 + ffmpeg + 模型文件，不可能「下载即初始化」。诚实的做法是
不弹「安装成功」，而是把缺口写在面板上（`tool-setup.ts` 的 `toolSetupBlurb`）。

**已移植进插件的工具不上架**：`news-watcher`（聚合讯）、`obsidian-douban-poster`（影视）
的运行逻辑已移植进 `src/clipbook/news-fetcher.ts` 与 `src/cinema/douban-fetcher.ts`，运行时零
依赖；上架只会让用户白下几十 MB 却没有任何功能变化。

### 4. 自更新：发布指针 + tag，缺省关，覆盖前备份

- **指针**：master 上的 `downloads/version.json` = `{ version, tag }`（几百字节，双源拉取）。
  不用 GitHub API 的 `releases/latest`：那个域名限流（未登录 60 次/小时，按 IP，同一出口整个
  局域网共用）且国内常在超时名单里；本指针走与在线资源同一套双源。
- **产物**：该 tag 下的三件套（`refs/tags/<tag>/…` 与 jsDelivr `@<tag>`）。
- **开关** `autoUpdate`，**缺省关**：关着也照查（那是「查」不是「装」），发现新版只记在面板；
  启动巡检不再自动覆盖。面板「检查并更新」是人显式点的，等同于同意装。
- **备份**：覆盖前把旧三件套存 `<插件目录>/downloads/.backup/<旧版本>/`。

tag 名约定 `v<manifest.json 的 version>`。**发布流程因此多两步**：先 bump `manifest.json`
→ 构建 → 打同名 tag → push。指针里的 tag 由 `pnpm manifest` 从 `manifest.json` 推出来，
两者不同步会被 `--check` 拦下。

### 5. `isDesktopOnly: true`

把「装了跑不起来」变成「装不上，请用桌面端」。手机端的只读场景（工具坞看数据）随此关闭——
如果将来要恢复，正确做法是逐域补「桌面端专属」空态，而不是让 manifest 再对大家撒谎。

### 6. 关于组 + 环境自检

通用页最上面新增「关于」组：版本（含「已下载 vX，重载后生效」）、自动更新开关、
环境自检、反馈（GitHub issues）、赞赏（**目前只有位置，没有内容**；将来放收款码，
图片走在线资源下发，不塞进 main.js）。

环境自检（`core/env-check.ts`）一次说清「这台机器缺什么」：运行环境 / vault 路径 /
插件目录可写 / 数据目录可写 / Node 运行时 / 三个工具的状态。**不联网**，只测本地事实。

## 后果

- 新增外部工具 = 在 `scripts/build-tools-pack.mjs` 加一个白名单 + `build-manifest.mjs` 的
  DOCS 与 ROW_ORDER 各加一行，插件端代码零改动。
- 发布顺序变成：`tools-pack → skin-pack → changelog → catalog → manifest → build`，
  且要打 tag。**少跑 `tools-pack` 会让旧包继续被登记**（manifest 对产物算 hash，产物没重出
  就还是老 hash，用户端看起来「已是最新」但内容没更新）。
- 没有 Node 的机器，B站下载器/值守/脸谱仍然跑不起来。环境自检会直说这一条，
  不在下载流程里假装解决。
