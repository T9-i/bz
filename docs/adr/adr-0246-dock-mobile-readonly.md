# ADR-0246 · 工具坞：移动端只读 —— vault 读桥 + 收掉全部写与执行入口

日期：2026-10-20 · 状态：已采纳 · 关联：ADR-0235（外部工具契约）、ADR-0239（面板数据与信任分家）、
ADR-0242（离线值守）、ADR-0243（展示板）、ADR-0244（展示板封顶）

## 背景

工具坞一直写着「移动端只读」（`canRun() = !Platform.isMobile`），但这一条只落到**动作**上：
不起调度器、不给运行按钮。**读**这条链没人管过 —— 而它是断的。

桌面的读链走 `declaration.ts` 的 fs 缝：`window.require('fs')` 直读工具目录的绝对路径。
移动端没有 Node，`window.require` 不存在，`currentFs()` 返回 null，于是：

- `readDeclaration()` → 读不到 → `manifest` 为空 → 卡片只剩登记项的 `id` 与 `path`；
- `readRunsFile()` → 读不到 → 运行记录、KPI、点阵、成功率全是空/0；
- `readPanelText()` → 读不到 → 展示板整块不出现；
- 更糟的是**文案在报假故障**：`messageTextOf` 那句固定写「声明文件读不到，先把路径修好」，
  而路径其实是对的；`trustStale` 还会因为 `run === null` 恒判「命令已变，待重新确认」。

用户 2026-10-20 贴的手机截图就是这一屏：四个工具全是「声明文件读不到 / 命令已变」。
诉求分两步：先要能看（静态数据），再要**纯只读**（连刷新、添加、长按抽屉都不要）。

## 决策

### 1. 只读读桥：`vault.adapter` 预取 → 同步缓存

工具目录在 vault 里（`CONFIG/SCRIPTS/DockTools/<工具>/`），手机上的 `app.vault.adapter.read(rel)`
读得到。唯一的接口错位：`DockFs.readText` 是**同步**的（`readDeclaration` / `readRunsFile` /
`readSettings` / `readPanelText` 一整条链都是同步，`loadToolView` 同步拼装视图），
而 adapter 只有异步 `read`。

不去异步化 `DockFs` —— 那条链被 ui / data / settings / watchdog 四处同步调用，改签名等于把
整个域翻一遍，收益只是「少一层缓存」，不值得。

采用**预取进内存 + 同步查表**（`src/dock/vault-fs.ts`）：

- `installVaultFs(app)` 在 `Platform.isMobile` 时 `setDockFs()` 一个只读实现，`readText` 查 Map；
- `primeVaultFs(paths)` 异步把文件读进 Map（并发 6）；
- 预取清单由 `primePathsOf(entry)` 给：声明 + 新旧别名 + `main.mjs` + 记录新旧名 + 参数值新旧名
  + `panel.html`，**一个工具的读面全覆盖**（漏一个就会在 UI 上表现成「那个文件不存在」）；
- 时机两处：`onload` 里 `loadDockStore()` 之后（设置页也要读）、面板每次 `refresh()` 前
  （`resetVaultFs()` 后重取 —— 手机上的文件会被同步工具改掉，**不跨刷新保留**）。

读链本身**一行没改**：声明解析、记录解析、展示板渲染原样复用。这是这条方案最大的价值 ——
移动端不需要第二套读法，也就不会有两套口径。

### 2. 绝对路径 → vault 相对路径：basePath 优先，仓库名兜底

登记里存的是导入时那条绝对路径（`E:\Obsidian\叫我包仔\CONFIG\…`），手机上 adapter 的根是
`/storage/emulated/0/…`（SAF 下甚至是 `content://`），两者对不上。所以 `relPathInVault()` 走两步：

1. `adapter.basePath` 前缀匹配（桌面与部分移动适配器有真实根路径）；
2. 按**仓库名那一段**定位：路径里一定含 `/<vault.getName()>/`，取**最后一次**出现
   （vault 根是离文件最近的祖先，父目录重名时取深层才对）。

都失败 → `null` → 读不到。**不猜**：宁可显示「读不到」，也不把一个猜出来的相对路径交给 adapter
去读别人的文件。箱外工具（目录不在当前仓库里）在手机端因此天然不可见，UI 直说
「文件没同步到这台设备，或工具目录不在仓库里」。

### 3. 只读的边界：收掉一切写与执行入口，但**保留全部读**

移动端要的不是「少几个按钮」，而是**没有任何一个能改变状态的入口**。所以按「能不能写/跑」划：

| 位置 | 桌面 | 移动端 |
|---|---|---|
| 头部刷新 / 导入 | 有 | **无**（手机上没有文件夹可选，重读也读不出别的） |
| 卡片长按抽屉 | 有（重读/运行/重新导入/停用/移除） | **不挂**（`attachItemActions(card, [])`） |
| 运行台：运行 / 停止 / 重置参数 | 有 | **无** |
| 运行台：参数控件 | 可编辑 | **disabled**（bool/多选置灰、select 掐指针、input/textarea 禁用、路径不给「选文件夹」） |
| 无声明时的「重新读声明」 | 有 | **无** |
| 自动运行：规则行点开编辑 / 添加规则 / 恢复并重试 | 有 | **无**（规则行只剩摘要，不出箭头、不加 role） |
| 空态的「导入工具」 | 有 | **无**，文案改「工具要在桌面端导入」 |
| 展示板 / 统计 / 元信息 / 运行记录 / 参数现值 / 规则表 | 有 | **有**（这才是移动端的用途） |

「运行台」与「自动运行」**不删**：它们展示的是「这个工具现在用什么参数、按什么节奏跑」，
是静态数据的一部分。只把控件换成只读。

顺带修两处**假故障文案**：

- `messageTextOf` 在 `!manifest` 时改用 `v.declError`（真原因），不再固定写「先把路径修好」；
- `trustTagOf` 在移动端返回 null —— 手机上不跑，也没有「重新确认」的入口；而且声明读不到时
  `run` 为 null，比对必然不等，会恒亮一条假的「命令已变」。

## 明确不做

- **不做移动端运行**：进程、shell、子进程在移动端不存在，这一条不动。
- **不把 `DockFs` 异步化**：见 §1 的理由。预取缓存的代价是「首次打开面板多几十到几百毫秒」，
  比翻四条调用链便宜。
- **不缓存跨刷新**：手机上文件随时可能被同步覆盖，留着旧内容比慢一点危险得多。
- **不把工具目录搬进 vault 索引 / 不要求工具改写数据位置**：读桥只负责把已在 vault 里的文件
  读出来，数据布局一个字不动，桌面端零影响（`Platform.isMobile` 之外根本不装这个桥）。
- **不给移动端加第二套 UI**：同一份渲染代码，靠 `canRun()` 分支 —— 不然两侧会慢慢长成两个东西。

## 后果

- 新增：`src/dock/vault-fs.ts`（`relPathInVault` / `primePathsOf` / `installVaultFs` /
  `primeVaultFs` / `resetVaultFs` / `hasVaultFs`），测试 `tests/dock/vault-fs.test.ts`。
- `main.ts`：移动端 `installVaultFs()` + 启动预取一次；`ui.ts::refresh` 刷新前重置并预取。
- `ui.ts`：头部按钮、卡片抽屉、运行台参数、自动运行区、空态按 `canRun()` 分支；
  `messageTextOf` 改用 `declError`；`trustTagOf` 移动端不显示。
- `styles.css`：`.bz-dock-rule.is-readonly`、`.bz-dock-form .bz-select.is-readonly`。
- 桌面端行为**零变化**（所有分支都在 `!canRun()` 上）。
- 已知边界：① 箱外工具在手机端读不到（有意）；② 手机上首次打开面板会等一轮预取（4 个工具
  ≈ 32 次 adapter 读）；③ 移动端读的是「同步过来的那份文件」，桌面刚跑完而同步还没到时，
  手机上看到的是上一轮 —— 这是同步工具的延迟，不是读桥的问题。
