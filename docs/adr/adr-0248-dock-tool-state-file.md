# ADR-0248 · 工具坞：排期状态跟着工具走（`dock-state.json`），`dock.json` 只留全局

日期：2026-10-20 · 状态：已采纳 · 关联：ADR-0239（面板数据搬出插件设置）、ADR-0242（离线值守）、
ADR-0236（调度台账）、ADR-0238（规则表）

## 背景

ADR-0239 把面板数据从插件设置搬进了 `<数据存储路径>/dock.json`，四把东西一起搬：
工具登记表、规则表与规则记账、调度台账、三个全域开关。

用户点破的是这四把**不是一类东西**：

> 自动运行数据应该放到脚本中啊，脚本自己的数据自己管啊
> dock.json 存全局的数据啊

拆开看确实是这样：

- **`dock.json` 该装的是「这个 vault 的全局事实」**：有哪些工具（索引）、自动运行总闸、
  漏跑提醒、离线值守。它跟着 `storagePath` 走，进 git、能整个分享出去 —— 这些都没问题。
- **规则表 / 规则记账 / 熔断台账是「某个工具在这个 vault 里的排期」**：工具目录搬到另一台
  机器、复制一份、整目录分享时，这些应该跟着工具走。留在 `dock.json` 里的后果是：
  搬走了工具，排期还留在原地（换个 vault 就丢了）；反过来把 `dock.json` 分享出去，
  别人的规则表和账也跟着走。
- 工具自己的运行记录（`runs.json`）、参数值（`data.json`）早就在工具目录里了 ——
  排期状态是同一类东西，之前只是没跟上。

## 决策

### 1. `dock.json` 升到 v2：只剩索引 + 三个全域开关

```jsonc
{
  "v": 2,
  "tools": [{ "id": "steam-cheap-radar", "path": "…/steam-cheap-radar/manifest.json" }],
  "autoRun": true,
  "notifyMissed": true,
  "watchdog": true
}
```

索引里**只有身份**（`id` / `path`）—— 标题、描述、参数、节奏、启动命令仍然只在声明里。

### 2. 每个工具一份 `dock-state.json`（住工具目录）

```jsonc
{
  "v": 1,
  "tool": "steam-cheap-radar",          // 串台自检：整目录被复制/改名后不误认
  "enabled": true,                       // 停用
  "autoRun": true,                       // 这个工具的总闸
  "rules": [ … ],                        // 规则表 v2
  "ruleState": { "seed": { "lastFiredAt": "…" } },
  "scheduleOverride": { … },             // 老节奏覆盖（规则表为空时才生效）
  "overrideDeclSig": "…",
  "runState": { "lastAttemptAt": "…", "consecutiveFailures": 0, "pausedAt": "…" }
}
```

**写者仍然只有 bz**（含离线值守进程）。工具不许碰这个文件 —— 「一个文件一个写者」
这条不变量没破，只是它挪到了离工具更近的地方。工具目录里那份 `runs.json` 仍是工具的，
两者互不越界（bz 只读 `runs.json`，工具只读都不该读 `dock-state.json`）。

### 3. 内存快照仍是「合并视图」

读侧（设置行的 `get`、调度器每轮判据、启动时的命令注册）要**同步**读，所以快照里的
`tools` 是「索引 + 该工具状态」合并后的条目、`runState` 是从各家状态文件汇起来的。
磁盘形态由 `diskFileOf()` 还原 —— 读侧一行没改。

### 4. 迁移：先写状态，全部成功才重写 `dock.json`

装载时读到 `v: 1`：逐工具把内嵌的排期状态写进它自己的目录，**全部写成功**才把
`dock.json` 重写成 v2。写不进去（工具目录只读 / fs 不可用 / 移动端）就保持 v1 原样，
下一轮再试 —— 反过来的顺序等于「排期删了但新文件没生成」，用户的规则表和熔断台账凭空消失。
进程内快照不受影响（照常判据），只是下次装载还会再试一次迁移。

老插件设置那四把键（`dockTools` / `dockRunState` / `dockAutoRun` / `dockNotifyMissed`）
的迁移路径不变：由 `migrateLegacyDockSettings` 摘出来当种子，种子落盘时同样先写状态再写索引。

### 5. 离线值守跟着改

`tools/dock-watch` 原来「直读 `dock.json` → 判一遍 → 回写两笔」，现在：

- `decide.js`：读 v2 索引，逐工具读 `dock-state.json`（`core.readToolState`）再并到 entry 上，
  与插件 `hydrate()` 同一套字段；**只认 v2**，见到 v1 一律不拍（那是插件该迁移的形态，
  值守不猜、不迁、不写）。
- `ledger.js`：两笔记账（规则命中时刻、调度台账）改成写**那个工具**的 `dock-state.json`，
  一次只动一家，不再和插件抢同一个文件。

`dock-core.cjs` 的打包入口 `watch-core.ts` 相应多导出 `tool-state` 这一组纯函数
（`readToolState` / `writeToolState` / `parseToolState` / `parseRunState` / `TOOL_STATE_FILENAME`）。

## 代价

- 每次装载多 N 次小文件读（N = 工具数，本机 4 个）。相对一次 tick 的其它读盘可以忽略。
- 工具目录不再「只读也能用」：排期状态写不进去时，规则记账只活在内存里，重启后会重跑一次
  当天的规则（参数值 `data.json` 本来也有同样的前提）。
- 卸载工具时**不删** `dock-state.json`：那是这个工具在本机的排期，重新登记时应当还在
  （与 `data.json` 同一口径）。

## 备选方案

- **把状态塞进工具的 `runs.json`**：不行，那是工具唯一写者的地盘，bz 写回去就成了第二个写者，
  `news.json` 当年（ADR-0128）就是被这个问题逼出段级合并写、最后外部写者直接退役。
- **只搬台账、规则表留 `dock.json`**：改动小一半，但「排期」本身还留在公共文件里 ——
  用户点破的正是这一点，拆一半等于没拆。
- **让工具自己写排期文件**：工具不知道 bz 的规则语义（`ruleDue` 的边界条件），
  等于把判据复制一份到每个工具里。
