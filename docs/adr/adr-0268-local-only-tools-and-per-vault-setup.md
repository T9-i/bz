# ADR-0268 外部工具只认本地包；断网时工具行不消失；引导判据按库分键

- 状态：采纳（推翻 ADR-0263 §2 的 PATH 回落）
- 日期：2026-10-28
- 相关：ADR-0263（外部工具分发）、ADR-0264（首次引导）、ADR-0265（分发硬化）、ADR-0267（自检屏返工）

## 背景

用**新仓库**（新 vault）打开插件时，用户撞上三件事：

1. **引导没弹**。那个库里 Node、工具包、文档一概没有，却直接进了主界面。
2. **工具状态说「用系统里已装的命令」**。这是 PATH 回落的口径——开发机上全局装过
   `bili-dl` / `bz-face`，于是插件显示「已就位」，而它自己一份包都没下过。
3. **断网时「外部工具」整组是空的**。三行全靠下载清单（`downloads/manifest.json`）驱动，
   清单拿不到 → 行集合为空 → 看起来像插件坏了，而不是「没网」。

三条根因互相独立：

- 引导判据的 localStorage 兜底用了**一把全局键**（`bz-setup-done`）。localStorage 是
  Obsidian 整个应用共用的（所有库同一 origin），于是「A 库走完引导」= 「B 库也算走完」。
- 运行时解析有两条路（本地包 / PATH），探测与启动都继承了这个二义性。
- 面板行集合是**纯清单驱动**：清单缺席 = 没有行。

## 决策

### 1. 外部工具只认插件目录里的包

`core/tool-runtime.ts` 删掉 PATH 回落，`via` 从 `'bundle' | 'path'` 收成 `'bundle' | 'none'`：

| 条件 | 结果 |
|---|---|
| 包在 + 有 Node | 绝对路径 + 参数数组（`shell:false`） |
| 没包 / 没 Node | `via:'none'`，**cmd 为空串** |

- `toolReadyState` 与 `resolveToolBase` 共用同一判据（探测面与启动面不再可能分歧）。
- `TOOL_ENTRIES.command`（`bili-dl` / `bz-face` / `bz-dock-watch` 三个裸命令名）删除。
- `core/external-tool.runExternalTool` 在 spawn 前拦空命令，报「去在线资源下载」。
  必须拦：Windows 下 `shell:true` 配空命令会起一个空 cmd、退出码 0 —— 看起来「跑完了」。
- `knowledge/processor` 同样在 spawn 前拦（它不走 external-tool），失败原因直接是安装指引。
- `people/prep.ts` 与 `people/recording.ts` 里两处写死的 `'bz-face'` 收回 `safeToolBase`。

**为什么不留「全局装了也能用」这条后路**：同一台机器上可能有开发期的旧版或自建版，插件
以为自己带着工具、实际跑的是别处那个；状态面也只能说「用系统里已装的命令」，用户看不出
插件到底下没下过。宁可统一成「没下就是没下，去下一份」（26–177KB，引导里一键）。

### 2. 清单拿不到时，外部工具行按磁盘事实照样出

`settings-panel/online-resources.computeRowStates` 在 `cachedManifest()` 为 null 时不再返回
空行集，而是按 `TOOL_IDS` 出三行本地兜底行（id 仍是 `tool-<id>`，归「外部工具」组）：

- 状态取 `toolReadyState`（只看磁盘），描述说「已下载，暂时无法检查更新」/「联网后可下载」；
- 按钮**恒禁用**——没有清单就没有下载地址与 sha256，可点等于骗人；
- 「检查更新」行照旧出现（`retryVisible = !hasManifest`），用户能自己重试。

工具是本机已经装好的东西，它的可见性不该取决于能不能连外网。

### 3. 引导判据按库分键

`setupDoneStorageKey(vault)` = `bz-setup-done:<vaultKeyOf(vault)>`（FNV-1a 8 位，与值守目录键同源）。
`setupAlreadyDone(settings, vault)` 与 `markDone(app)` 都走它。

- `data.json` 里的 `setupDone` 本来就是按库的，localStorage 兜底此前是唯一的跨库泄漏点；
- 旧全局键**不再读取**：老用户的库靠 `setupDone`，只有「data.json 写不进去的只读库」会
  重弹一次——那种库本来就该重弹。

## 影响

- `runtimeDiagnostics` 的值只剩「已下载 / 未安装」两种（自检屏与工具坞同一口径）。
- 本机全局装过工具的用户：升级后会看到「未安装」，去「外部工具」下一份即可（一次性）。
- 单测新增注入缝 `setToolBaseProbe`（纯函数 builder 在测试里没有 app，需要一条假命令）；
  生产不调用它。
- people / knowledge 的测试夹具统一注入「shell 口径的假工具」，因为参数引号口径仍要覆盖
  （`buildSyncSpec` 的 `opts.command` 是公开入口，仍可传 shell 口径）。

## 补记（2026-10-28）：探测本身也有两个 bug

同一次报障的另一半——用户说「网页能开 GitHub，引导却显示两条通道都不可达」。查下来网络
没问题（实测：走系统代理五条全 200；直连时 raw 被墙、jsDelivr 三个边缘域名 200），
问题在 `core/env-check.ts` 的 `timedFetch`：

1. **`await import('obsidian')` 在 Obsidian 里永远失败**。插件以 CJS 加载、渲染进程没有
   importmap，裸模块名的动态 import 解析不了（社区结论一致：Obsidian 的 Electron 环境
   无法把 `import('obsidian')` 扩展成可用形式）。那行 `await` 每次都进 catch，于是**无论
   网络多好，两条通道一律判成不可达**。全仓只有这一处这么写，其余（`remote-asset` /
   `self-update` / `douban-queue`）都是静态 import —— 改成静态 import 即可。
2. **`throw: true` 把 404 也算成断网**。探的是「通道通不通」，不是「`version.json` 在不在」。
   改 `throw: false` + 看状态码：有 HTTP 响应就是通。

顺带把「不可达」三个字拆开：`NetworkProbe` 增 `githubError` / `jsdelivrError`，
`explainNetError` 把原文折成「域名解析失败 / 超时 / 连接被重置（常见于被墙）/ 证书校验失败
（代理做了解密？）/ 代理要求认证 / 本机没有网络」，界面值列与底部说明都带原因。
只说「不可达」时，能开 GitHub 的人根本无从判断是墙、是代理还是 DNS ——
而 `github.com` 与 `raw.githubusercontent.com` 本来就是两回事。

测试钉住五条：主通道通、主被墙备通、只有慢入口通、全不通、404 也算通，外加一条读源码
断言「不许再出现动态 import 裸模块」。

## 补记二（2026-10-28）：清单拉不到 —— 串行卡死 + 备用通道事实上已死

修完探测后，引导页变成了「这台机器什么都不缺」+「资源清单没拉到」两句并存。两件事：

1. **`fetchAssetText` 是串行 `await requestUrl`，没有单通道超时**。raw 一旦卡住（被墙的
   典型形态是 TCP 连上但不回），要等 Chromium 自己的十几秒，而调用方
   `fetchManifestWithTimeout` 只等 12 s —— 一条通道卡住，后面几条根本没被试到。
   改法：单通道 8 s 封顶；清单这类 KB 级文件**并发**试（谁先通过校验用谁）；
   成功过的通道在会话内记下来排到队首（`preferredBase`）。
2. **jsDelivr 对本仓库已经停发**。实测 403 正文：
   `Package size exceeded the configured limit of 50 MB` —— 仓库 `.git` pack 284 MB，
   超了它的 50 MB 上限。**只有早年被它缓存过的文件还能出**（`version.json`、
   `belongings-categories.json` 仍 200），没缓存的一律 403。这就是「探测说备用通道可达、
   拉清单却失败」的来源：探测撞的是缓存，拉的是没缓存的。
   现在 403 正文会被识别成「通道拒绝分发（仓库超过 50 MB）」而不是「网络不通」；
   探测判据也从 `status > 0` 收成「拿到 2xx/3xx」——403 有状态码，但通道用不了。

**未解决**：`downloads/` 与插件自更新的真正备份通道。jsDelivr 已不可依赖，剩下的
`raw.githubusercontent.com` 在国内无代理时不通。根治要么瘦仓库（重写历史，tag 全废），
要么把 `downloads/` 拆到独立小仓库再让 jsDelivr 服务它 —— 都需要拍板，尚未动手。

## 补记三（2026-10-28 晚）：清单「没拉到」的真因是写不进磁盘

用户换新库后仍报「资源清单没拉到」。前两轮查网络（探测自证不可达、串行卡死、jsDelivr 停发）
都是真问题，但都不是这一现象的原因。真正的原因在本地：

```
writeAssetText(app, 'manifest.json', text)
  → ensureDir(app, 'manifest.json')      // 没有斜杠
  → const slash = relPath.lastIndexOf('/'); if (slash <= 0) return;   // 直接 return
  → adapter.write('<plugin>/downloads/manifest.json')                 // ENOENT，父目录不存在
  → refreshManifest 抛错 → 引导页 .catch(() => null) → 「清单没拉到」
```

`ensureDir` 的循环只在「路径含子目录」时进得去，而「父目录」对单文件资产来说就是
`downloads/` 本身 —— 之前没有任何一处创建它。老库里 `downloads/` 是早先版本留下的，
所以一直是绿的；**全新库第一次运行，永远拿不到清单**。同一处缺陷还会连带皮肤包
（`skins/<域>/<id>.css`：建 `downloads/skins` 时父目录不存在，逐级 try/catch 全吞掉）。

修法：`ensureDir` 第一件事先建 `downloads/` 根（幂等，已存在抛错也无所谓），再逐级建子目录。

两处配套：

- **测试换真文件系统**。`MockVault.adapter.write` 往 Map 里塞、从不校验父目录，所以既有
  测试对这一类缺陷是盲的。新增 `tests/core/downloads-dir.test.ts`：临时目录 + 非递归
  `mkdir` + `fs.writeFile`，复刻 Obsidian 的 FileSystemAdapter 语义。验证过它确实抓得住
  原缺陷（去掉修复后三条用例齐齐 ENOENT）。
- **别再把原因吞掉**。`fetchManifestWithTimeout` 从「失败返 null」改成「返 null + 原因」，
  引导页把原因附在提示句后（`（原因：…）`）。这条链上原来每个 catch 都是 `() => null`，
  三次隔着屏幕猜网络，代价就是这一轮。真出问题时，原文能立刻分清是墙、是代理、还是磁盘。

## 补记四（2026-10-28 夜）：手改 setupDone=false 不生效 + 引导弹窗的宽度与切边

**一、复位手段被自己的兜底盖住了。** 用户手改 `"setupDone": false` 重载，引导仍不弹。
判据是「设置 false → 再问 localStorage 兜底」，而他之前关过引导，`markDone` 早把兜底键
写成 `1` 了 —— 兜底本来只该服务「设置写不进去的只读库」，却反过来否决了唯一的人工复位手段。

现在把 `data.json 里到底有没有这个键` 作为第三个参数（`main.ts` 从 `loadData()` 的原始对象
判断）：有键 = 设置能写 = 设置是唯一事实源（`false` 就是没走过）；没键 = 只读库/首次，
才轮到兜底键。老库不受影响（它们的 data.json 早就有 `setupDone: true`）。

**二、弹窗宽度从来没到过 760。** `uiModal` 的 `maxWidth: 760` 只是**上限**，弹窗宽度由内容
撑 —— 实测 514px，所以用户上次说的「太窄」根本没被解决，只是上限变了。现在 `.bz-setup-modal`
给死 `width: min(760px, calc(100vw - 32px))`。

**三、九行清单在 82vh 处被齐切一行**（截图里「主题皮肤」的说明整行没了一半），而且 Windows 的
悬浮滚动条不滚就不出现 —— 看起来就是「坏了」。高度预算提到 `calc(100vh - 32px)`（遮罩内距
就是 32），行内距 9→8、分组标题收紧，常见窗口下整份装得下；真装不下时只滚内容区、底栏常驻。

对应的选择器作用域全在 `.bz-setup-modal` 下，别的弹窗一个字不动。
