# 工具坞外部脚本接入指南（dock 契约 v1）

**读者：要写一个能被 bz「工具坞」登记、运行、观测的外部脚本的 agent 或人。**

你写三件事：**一份 `manifest.json` 声明自己是谁、有哪些参数、该怎么跑；运行时按四行协议往 stdout 说话；再自己往目录里写一份运行记录。** 想让详情页里也显示点自己的东西（积分、今日条数……），可以再画一块**展示板**（§5）。不 import 任何 bz 代码，bz 也不关心你脚本里是什么。

真理源：`src/dock/schema.ts`（校验）、`src/dock/declaration.ts`（文件与路径）、`src/core/external-tool.ts`（协议）、`src/dock/runner.ts`（拉起与环境变量）、`src/dock/rules.ts` + `src/dock/scheduler.ts`（规则表与自动触发）、`src/dock/watchdog.ts`（离线值守的租约与状态）。**本文与代码冲突以代码为准**，并顺手改这里。

## 0. 五份文件，四个写者

| 文件 | 位置 | 谁写 | 内容 |
|---|---|---|---|
| `manifest.json` | 工具目录 | **你**（手写） | id / 名字 / 参数表 / 怎么跑 / 种子节奏 |
| `runs.json` | 工具目录 | **你**（运行时写） | 每次运行一条记录 |
| `panel.html` | 工具目录 | **你**（手写或运行时写） | 详情页里那块展示板，爱画什么画什么（§5） |
| `data.json` | 工具目录 | **bz** | 用户填的参数值（凭据的家，不在 vault 里） |
| `dock-state.json` | 工具目录 | **bz** | 这个工具在本机的排期：规则表 / 规则记账 / 熔断台账 / 停用与总闸（ADR-0248）——**只读都别读**，更别写 |
| 索引（id / path）+ 三个全域开关 | bz 数据目录的 `dock.json` | **bz** | 跟你无关 |

- **读声明不执行任何东西**，所以用户先看到命令与参数表，再决定信不信。
- 旧名 `dock.json` / `dock.settings.json` / `dock.runs.json` 读侧仍回落认，新工具一律用新名。

## 1. id

`^[a-z0-9][a-z0-9-]*$`，长度 ≤ 64。**两处必须逐字一致**：`manifest.json` 的 `id` 与 `runs.json` 的 `tool`。不符 → 记录整份被拒。

## 2. `manifest.json`

必填：`v`（**必须是 1**）、`id`、`name`（非空）。缺任一项整份拒绝。

选填（**未知字段一律保留**，前向兼容）：

| 字段 | 说明 |
|---|---|
| `description` | 展示在卡片与详情 ✅ |
| `icon` | lucide 图标名 ✅ |
| `run` | 怎么跑，见 2.1。**缺省**：目录里有 `main.mjs` 就当 `node main.mjs`；都没有 → 只能看、不能跑 ✅ |
| `params` | 参数表，见 2.2 ✅ |
| `schedule` | 种子节奏，见 2.3 ✅ |
| `weekly` 之外的 `author` / `toolVersion` / `group` / `docs` / `produces` / `runtime` / `desktopOnly` | ⚠️ 只解析，**当前无消费方** —— 别把行为押在它们身上 |

> ✅ = 面板真的用；⚠️ = 收下了但没人消费。

### 2.1 `run`

```jsonc
{ "run": { "cmd": "node", "args": ["main.mjs"] } }
```

- `cmd` 必填（空则整段丢弃）；`args` 原样传给进程，参数值**另拼在后面**。
- `cwd` 缺省 = 声明文件所在目录 → 目录搬到哪都不用改。
- `shell` 缺省按扩展名判（`.cmd` / `.bat` 自动开），可不写明。
- 约定入口只认 `main.mjs`（`.mjs` 无条件按 ESM 解析）。**python 等其它运行时必须写 `run`，bz 不猜。**

> ⚠️ **信任绑的是命令签名**（`cmd + args`），不是工具身份。改了 `run.cmd` / `run.args`，或依赖的 `main.mjs` 增删 → 旧信任作废，自动运行被拦（手动也要先在详情页重新确认）。

### 2.2 `params`

```jsonc
{ "key": "mode", "label": "模式", "type": "choice",
  "default": "fast", "options": [{"value":"fast","label":"快"}],
  "help": "…", "placeholder": "…", "required": false }
```

`key` / `label` / `type` 缺一或 type 不认识 → 该条丢弃（不连累别的参数）。同 key 只留第一个。八种类型：

| type | 控件 | 专属字段 | argv |
|---|---|---|---|
| `text` | 单行 | `placeholder` | `--key=值` |
| `multiline` | 多行 | `rows` | `--key=值`（可含换行） |
| `number` | 数字 | `min`/`max`/`step` | `--key=值` |
| `bool` | 开关 | — | `true` → `--key`（无值）；`false` → 不发 |
| `choice` | 单选 | `options` | `--key=值` |
| `multichoice` | 多选 | `options` | `--key=值1 --key=值2` |
| `path` | 文件/目录选择器 | `mode`: `file`/`dir` | `--key=路径` |
| `secret` | 密码框 | — | `--key=值`（bz 不写进记录） |

值等于 `undefined`/`null` 跳过；空串跳过（`required: true` 除外）。**参数只在启动时下发**，没有 stdin、没有运行中注入。

> **argv 的名字就是 `key` 本身，逐字**：`key: "user_id"` → `--user_id=…`，**不是** `--user-id`。下划线 key 不会变成连字符，大小写也不会动 —— 脚本里解析参数名必须**从 manifest 的 key 抄过去**，别凭语感换写法。（实例：key 写 `user_id`、脚本解析 `--user-id`，命令行手工传参时又恰好按连字符传 → 自测全绿，面板一点就「配置错误」。）

**该放参数的只有三类**：凭据（`secret`）、用户偏好、因机器而异的环境值（代理等）。**接口 URL、请求体、字段名、超时一律写死在脚本里** —— 判据一句话：用户看到这个框，能凭自己填对吗？

### 2.3 `schedule`（**只是一粒种子**）

```jsonc
{ "schedule": { "kind": "daily", "hour": 12 } }
```

bz 侧的自动化是**规则表**（3.1）：工具还没有任何规则时，bz 按这条 `schedule` 折一条种子规则。

| 你写的 | 结果 |
|---|---|
| `daily`（hour → `"HH:00"`） | 折出 `{ trigger: { kind: 'daily', at }, action: { run } }` ✅ |
| `interval`（everyHours × 60 → `everyMin`） | 折出 `{ trigger: { kind: 'interval', everyMin } }` ✅ |
| **`weekly`** | **折不出**（新模型没有「每周某天」这个触发）→ 落在手动区 ⚠️ |
| `on-demand` / `unknown` / 没写 | 折不出 → 手动区 |

用户一旦自己加了规则，规则表说了算，你日后改 `schedule` 不再影响它；bz 不回写你的 `manifest.json`。

## 3. 自动化：规则表 `触发条件 → 执行`

每个工具一张规则表，调度器一分钟一拍逐条问「现在该不该跑」（纯函数 `ruleDue`）。**有启用中的规则 = 自动化区；没有 = 手动区**（`hasActiveRule`，派生，没有第二个开关）。

| 东西 | 谁定 | 在哪定 |
|---|---|---|
| 全局总闸 `autoRun` | 用户 | 设置 → 工具坞 → 自动运行 →「启动后自动运行」 |
| 规则表 | 用户（初值来自你的种子） | 工具详情页「自动运行」块 → 添加规则 |
| 熔断恢复 | bz 自动 + 用户手动 | 详情页「恢复并重试」 |

### 3.1 触发条件

| kind | 含义 | 参数 |
|---|---|---|
| `daily` | 每天某时刻 | `at`: `"HH:MM"`（本地时区） |
| `interval` | 固定间隔 | `everyMin`: 1–43200 |
| `on-launch` | Obsidian 启动后 N 分钟，本会话一次 | `delayMin`: 0–1440 |
| `panel-open` | 打开工具坞面板时 | — |
| `tool-ok` / `tool-fail` | 指定工具成功 / 失败后 | `toolId` |
| `domain-event` | 域事件总线通道 | `channel` |
| `vault-file` | 某目录 / 某类文件变动 | `target` |
| `data-threshold` | 某 json 数值越阈值 | `path` / `key` / `op`（`>` `<` `=`）/ `value` |

- 每条规则**各自记账**（`lastFiredAt`），不共享欠账。
- `tool-ok` / `tool-fail` **指向自己会被拦**（防无限套娃）；指向别的工具是合法的联动通道。
- `data-threshold` 读不到值 → 不跑（判不出就不跑）。

### 3.2 执行

| action | 含义 |
|---|---|
| `run` | 真的拉起来跑；`notify`: `never` / `fail`（缺省）/ `always` |
| `remind` | 只发一条可跳转的通知，**不拉进程** |

`jitterMin`：到点后随机再等 0~N 分钟（错峰），缺省不抖。

### 3.3 跑之前的门槛（任一不满足就不跑）

`disabled`（停用）· `untrusted`（没信任）· **`trust-stale`（命令变了，见 2.1）** · `no-run` · `paused`（熔断）· `running` · `cooldown`（失败后 15 分钟）· `params`（`required` 参数没填，bz 会提醒一次）。

**失败处理**：15 分钟冷却 → 连续 **3 次**熔断暂停 → **一次成功**即恢复；单次超时 **10 分钟**强杀。并发恒为 1，失败不连坐。

### 3.4 离线值守（Obsidian 关着的时候）

装好**值守进程**（`tools/dock-watch/`，挂在 Windows 登录自启上）后，**Obsidian 关着时它替你拍** ——
用的是同一份规则表、同一份 `ruleDue`（打包成 `dock-core.cjs`）。对你的脚本而言**没有任何新东西要学**：
环境变量、参数下发、超时、记录写法全都不变，契约这一份照旧。

它认识哪些触发、不认识哪些：

| 触发 | 离场 | 为什么 |
|---|---|---|
| `daily` / `interval` / `data-threshold` | ✅ | 靠时钟或直读 vault 里的 json |
| `tool-ok` / `tool-fail` | ✅ | 值守自己跑完接着判联动 |
| `on-launch` | ❌ | 语义是「Obsidian 启动后」，离场没有这个时刻 |
| `panel-open` / `domain-event` | ❌ | 需要插件进程里的面板与域总线 |
| `vault-file` | ❌ | 第一版没做（没事件时规则自然不命中，不会乱跑） |

两条与「在场」不同的地方，你的脚本**不需要**适配（列出来只为让你知道自己在哪一端）：

- **`remind`（只提醒）离场不投递** —— 提醒的价值在「当时」，隔一天补一条只是噪音；
- 离场那次的 `BZ_DOCK_TRIGGER` 仍是 `auto`（没人手点它），「谁拉起的」由 `runs.json` 的时间戳回答。

所以 §4.3 那条要求（`info` / `result` **一定要写进记录**）在离线值守下更值钱：离场没有 stdout，
记录就是全部。

## 4. 运行中的契约

### 4.1 环境变量（bz 注入；**不继承宿主环境**，别依赖 `PATH`）

| 变量 | 值 |
|---|---|
| `BZ_DOCK_CONTRACT` | `1` |
| `BZ_DOCK_TOOL` | 你的 id |
| `BZ_DOCK_RUNS_FILE` | 记录文件**绝对路径**（= 你目录下的 `runs.json`） |
| `BZ_DOCK_VAULT` | vault 根绝对路径 |
| `BZ_DOCK_TRIGGER` | `auto` / `manual` —— 直接抄给记录里的 `trigger`，别自己猜 |

### 4.2 四行协议（stdout，每行一个）

| 行 | 体 | 效果 |
|---|---|---|
| `[bz-step] 检查登录态` | 纯文案 | 步骤（空文案忽略） |
| `[bz-p] {"phase":"签到","pct":35}` | JSON 对象 | 阶段进度；**拿不到进度写 `null`，别编** |
| `[bz-info] {"mode":"fast"}` | JSON 对象 | 结构化信息体 |
| `[bz-result] {"balance":52}` | JSON 对象 | 结果体（一次运行取最后一次） |

- 非协议行原样透传为日志；坏行静默忽略（永不抛）；CRLF 会剥 `\r`；单行上限 1 MiB。
- 退出码 0 且未被停止 = `ok`；被停止 = `stopped`；其它 = `failed`，**stderr 尾部 2KB** 会被留下展示 —— 把最有用的话写在最后。
- **成败的最终判决不在退出码，在你写的 `status`**（契约 §4.3）：有本次记录时以记录为准，退出码只在
  「这次没留记录」时兜底。所以**记录一定要写**，而且要在结束前写完 —— 记录说成功、进程却以非零码
  收场时，bz 按记录判成功（同时把退出码留在日志里）。反过来记录说失败、退出码是 0，也按失败算。
- 不需要支持任何子命令；声明不从 stdout 吐。

### 4.3 `runs.json`（你写、bz 只读）

```jsonc
{ "v": 1, "tool": "<你的 id>", "updatedAt": "2026-10-04T10:34:41+08:00", "runs": [/* 新的在前 */] }
```

每条必备：`status`（`ok`/`failed`/`stopped`/`running`/`timeout`，不认识则整条丢弃）、`startedAt`。常用：`runId`（建议 `${startedAt}-${pid}`）、`trigger`（读环境变量）、`finishedAt` / `durationMs`、`exitCode`、`message`（给人看的一句话，写「签到成功，+2 分」别写「done」）、`steps`、`progress`、`result`、`info`（**记录里是数组** `[{at,data}]`）、`metrics`、`artifacts`、`error`。未知字段保留。

**两条硬要求**：① **原子写**（写 `<file>.<pid>.<n>.tmp` 再 rename）；② **自己裁剪到 200 条**（`slice(0,200)`），超了 bz 只提示不代删。

**`error.kind` 是最值钱的字段** —— 失败时别省：

| kind | 面板提示 |
|---|---|
| `auth` | 登录态失效，重新导出凭据 |
| `network` | 网络不通，检查代理或稍后重试 |
| `config` | 命令或参数配错了 |
| `timeout` | 执行超时 |
| `aborted` | 被手动中止 |
| `unknown` | 看记录里的 stderr 尾部定位 |

### 4.4 在场 vs 离场

判据是**谁启动**：bz 拉起的都是在场（含自动触发，实时回显、能停止）；**值守进程**在 Obsidian 关着时拉起 = 离场（只有记录，没有 stdout）。**所以 `info` / `result` 一定要写进记录**，否则离场那次就丢了。

### 4.5 工具问人：`[bz-ask]` 出去，`[bz-answer]` 回来

有些动作非经人点头不可（例：往 Steam 写东西得先把它关掉）。让人事后去翻清单再手动执行是割裂的，
所以四行协议之外还有一条**回程**（ADR-0244）：

```jsonc
// 工具 stdout（一行）：
[bz-ask] {"id":"apply","title":"把分类写进 Steam","body":"纯文本兜底…","bodyHtml":"<div>…</div>",
          "confirmText":"写入 Steam","cancelText":"取消","timeoutSec":300}
// bz 弹窗 → 人点按钮 / 超时；插件再往你的 stdin 写一行：
[bz-answer] {"id":"apply","ok":true}
```

- **没人应答 = 取消，不是同意。** 三种场合没有弹窗：调度器/值守拉起的自动运行（bz 立刻回
  `ok:false`）、手跑在终端里、stdin 已被关掉。**所以工具侧必须有超时与 EOF 兜底**：等不到回答就
  当取消、什么都不做地体面收尾 —— 别在启动时无条件读 stdin，那只会挂到自己超时。
- 写完 `[bz-ask]` 就继续读 stdin 那一行；`id` 原样带回，认 id 再采信。
- 正文两条路：`body` 是纯文本（按 `\n` 分段渲染，**不当 HTML**，工具输出不可信）；
  `bodyHtml` 是一段 HTML 片段，摆在**沙箱 iframe** 里 —— 同展示板那套（ADR-0243）：**不给
  `allow-scripts`**，`<script>` / `on*` / `javascript:` 一律不执行，样式也只影响框内。
  想画表格、分组、自己的版式就给 `bodyHtml`；两样都给时 HTML 胜，纯文本那份当兜底
  （进记录、以及 HTML 超上限被退回时用）。
- `bodyHtml` 的尺寸：**128 KB** 上限（超了退回 `body` 并在框里说明，不静默）。**没有高度上限** ——
  框按内容长到多高就多高，正文区（超一屏时）自己滚，按钮与倒计时始终钉在下面。框宽：纯文本
  460 px、HTML 560 px。
- 别给 `html` / `body` 写 `height:100%`（或任何写死的高度）：框的高度是**量出来的**
  （bz 读你文档的内容高度），写死了就量不到，框会停在默认高度、里头反而长出滚动条。
- **框里没有滚动条**：bz 按自己的界面口径把它隐藏了（只隐藏条，滚动功能还在 —— ADR-0122），
  框是独立文档，那条界面级规则本来够不着，所以在框文档的**根元素**上补了一条
  （`scrollbar-width: none`；它不继承，挂在 `<body>` 上是无效的 —— 实测）。所以别指望「内容多了
  会出现一根条提示用户」，它不会出现；该让用户看见的东西，就摆进一屏里。
  另：**别在自己的 HTML 里写 `<html>` / `<body style>` 那一层**去改这两个基线 —— 内层标签的
  属性会被外层忽略掉。
- 写整份文档也能用：浏览器会忽略你内层的 `<html>` / `<body>` 标签，**基线仍是 bz 裹的那层 body**
  （`margin` / `padding` / 字体 / 字号 / 行高，主题变量也挂在那儿）。但**别依赖任何外部资源**：
  相对路径解析不到你的工具目录（外面套着一层 iframe），图片 / 字体一律内联。
- 想跟面板一个观感就用灌进来的**主题变量**（与展示板同一组，见 §5.3）：`--bz-surface-*` /
  `--bz-text-*` / `--bz-border` / `--bz-brand` / `--bz-radius-*` / `--bz-font-*` / `--bz-space-*`。
- **按钮与倒计时永远归 bz**：`confirmText` / `cancelText` 只能改那两个钮上写的字，工具画的只是
  中间那一块内容 —— 这一屏的答案必须由 bz 收回，不能由工具自己画两个钮。

## 5. 展示板：给工具一块画布

详情页**最上方**有一块**整宽**区域（在统计条之前），内容完全由你决定：工具目录里有 `panel.html`
就渲染它，没有（或只有空白）就整块不出现。这一块**没有标题** —— 摆最前就是为了让你一眼看见，
再加一行「展示板」是面板在自说自话。签到脚本在这儿显示「总积分 530 点」、抓取脚本显示「今日入库 12 条」，
都是它。

### 5.1 最小的一个

`panel.html`（与 `manifest.json` 同目录）：

```html
<div style="display:flex;align-items:baseline;gap:8px">
  <span style="font-size:28px;font-weight:600;color:var(--bz-brand)">530</span>
  <span style="color:var(--bz-text-3);font-size:12px">本月积分</span>
</div>
```

写完就有了 —— 不用在 `manifest.json` 里声明什么，也不用通知 bz。

### 5.2 三条硬约束

**① 框里能跑脚本了（2026-10-22 起），但仍然单文件、仍然别指望外部资源。** 面板用一个
`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"` 的 iframe 装它
（ADR-0249）：`<script>`、`onclick`、`javascript:` **都会执行** —— 想画搜索框、批量勾选这类
「读输入、改列表」的交互，就在框里写。三条配套纪律：

- 脚本只跑在框内文档里，**别去碰 `parent`**（同源，技术上做得到，但那是在动插件的 DOM，
  一旦有人这么写，这条口子就会被收回去）；
- 外链照旧用 `<a href="https://…" target="_blank">`（宿主接管，`shell.openExternal` 开系统浏览器）；
- **想让用户点了就干活**（移除一条、重跑单款），仍然用 `#bz-act:` 动作链接（§5.5）——
  动作要过 bz 的白名单与参数掐口，别自己在框里拼命令行。

内容要更新就**重写文件**：脚本跑完把新数字写进去，面板在运行结束后会自动重读。

**② 单文件自包含。** 相对路径解析不到你的工具目录（外面套着一层 iframe）——
图片、字体、额外的 CSS 都得内联（图片用 `data:` URI）。`<style>` 标签**可以**用，它只影响框内。

**③ 上限 512 KB，高度封顶 560 px。** 超 512 KB 不渲染（面板不是浏览器，别拿它当第二个手册）。
高度按内容量（bz 量出来、还会跟着后续变高纠正），但**超过 560 px 就在框里滚**（2026-10-20 起）——
框文档里注入了隐藏滚动条的样式（`html` / `body` 两根规则 + `::-webkit-scrollbar` 兜底），所以你
**看不到条，滚得动**。列表类展示板正好：一屏放得下就整块铺开，
放不下就在框里往下滚，详情页不会被顶成一堵墙。滚动条不可见这一点要认：该在末尾写一句「还有多少条」。
（同一条纪律：别给 `html` / `body` 写 `height:100%`，框高是量出来的。）

### 5.3 跟着主题走

面板会把自己当前的 CSS 变量灌进框里，直接用就是，深浅色自动跟随：

| 变量 | 用途 |
|---|---|
| `--bz-text-1` / `--bz-text-2` / `--bz-text-3` | 主 / 次 / 弱文字 |
| `--bz-surface-0` … `--bz-surface-3` | 四档底色（0 最深） |
| `--bz-border` | 描边色 |
| `--bz-brand` / `--bz-success` / `--bz-warning` / `--bz-danger` | 品牌 / 成功 / 警告 / 危险 |
| `--bz-radius-sm` / `--bz-radius-md` | 圆角 |
| `--bz-font-ui` / `--bz-font-mono` | 字体 |
| `--bz-space-xs` … `--bz-space-lg` | 间距 |

框的基线（透明底 / 内边距 / 字号 / 行高 / 文字色 / 字体）挂在 `body` 的**内联样式**上，优先级
高于任何选择器 —— 要改它们得用 `!important`。摆布自己的内容请在**自己的元素**上写样式，
那不受内联基线影响。`<style>` 标签可以用，它只影响框内。
**只灌了这些** —— 面板内部还有别的变量，别依赖它们（那些不是给你的，会变）。

### 5.4 谁来写、什么时候写

**你写，bz 只读**（同 `runs.json`）。数据变了就重写：

```js
// 跑完拿到结果之后
fs.writeFileSync(path.join(DIR, 'panel.html'), renderPanel({ points: 530 }));
```

**原子写**（tmp + rename）—— 与记录同一条纪律：面板随时可能正在读它，写到一半的 HTML
会让展示板当场崩一下。静态展示板也可以在交付时手写一份，之后由脚本按需更新。

**文案是给人看的最终产物**（真踩过：模板字符串里写了行 `//` 注释，用户在展示板上看到了它）：

- `panel.html` 若由脚本拼出来（模板字符串 + 变量），**JS 注释绝不能写在模板字符串里** ——
  那不是注释，是字符串的一部分，会原样渲染在面板上。注释写在模板字符串**外面**。
- 面板上的一切文案（标题、说明、数字标签），以及记录里的 `message` / `steps`，都用**平实的中文**，
  不带 `//`、`**`、反引号这类记号 —— 它们是写给读代码的人的标记，渲染出来就是乱入的符号。
  自检一句话：用户读这行，能不能一遍读懂、且不看到任何代码记号？

### 5.5 动作：让框里的链接点一下就干活

展示板里没法跑脚本（§5.2 ①），但**可以让人点一下就把一次运行发起来**（ADR-0247）。
面板会拦住以 `#bz-act:` 开头的链接，查你的声明、掐一遍参数、然后带着参数跑一次脚本。

`bz` 在这条链路上**只做两件事**：挡住没声明的参数、把声明里写好的模板填上值。
确认界面、误删补救、业务判断——全是你的。

**第一步：在 `manifest.json` 里声明动作**（声明即注册，没声明的 id 点了不会执行）：

```jsonc
"actions": {
  "wish:remove": {
    "args": { "appid": { "type": "appid" } },
    "run": { "args": ["--unwish={{appid}}"] }
  }
}
```

| 字段 | 说明 |
|---|---|
| `args` | 允许出现的参数名 → 类型。`appid` 只收数字，`text` 禁 `-` 开头、禁控制字符、≤200 字 |
| `run.args` | **必填**。追加到命令行的模板，`{{名字}}` 换成 href 里同名的值。引用了没声明的名字 → **整条动作失效** |

这张表里**没有一句人话** —— 没有 `label`、没有 `confirm`。那些属于展示板。

**第二步：在 `panel.html` 里放链接**：

```html
<a href="#bz-act:wish:remove?appid=1332010">移除</a>
```

点击 → bz 校验 → 用 `run.args` 拼参数跑一次。**跑的就是你声明里那条命令**，
参数表单里的值照旧带上，动作参数拼在最末尾，而且**不写进 `data.json`**（一次性的，不会变成常驻开关）。

**第三步：确认自己画**。`bz` 不弹「真的要删吗」—— 那个框该由你写，而且一行 JS 都不用
（与表头那些 `vtab` radio 同一个套路）：

```html
<input type="checkbox" id="cfm-1332010" class="cfm">
<label for="cfm-1332010" class="act">移除</label>
<div class="cfm-row">
  <span>真的从愿望单删掉？删了要手动加回来。</span>
  <a href="#bz-act:wish:remove?appid=1332010" class="danger">确认</a>
  <label for="cfm-1332010">算了</label>
</div>
```

```css
.cfm:checked ~ .cfm-row { display: flex; }  /* 不勾不显示 */
```

点「移除」展开确认行，点「确认」才产生 `#bz-act:` 链接。`input` / `label` 天然不做导航，
bz 只看得到最后那一下。

三条边界，写的时候心里要有数：

- **只有声明过的 id 能执行**。链接里写了一个表外的 id，点了只会得到一句「没声明这个动作」。
- **参数不能自由拼**。href 里出现表外的参数名，或值不合类型，整条拒 —— 这是这条通道唯一的注入面。
- **多值用逗号**：`?appid=1,2,3` 会在 `args.type: "appid"` + `many: true` 下逐个校验，
  拼回模板时仍是 `1,2,3`（脚本自己拆），上限 50 个。

**兜底也是你的事。** bz 不拦误触、不做二次确认；可靠的保险是「删了能加回来」：
把动作删掉的东西记进记录，下一轮在展示板上给一个反向动作的链接。

**动作触发的那一轮，记录要自己写清楚发生了什么。** `runs.json` 是你写的，bz 不额外记
「谁点了哪个动作」；`message` / `steps` 里不交代，事后看记录跟手动跑一轮长得一模一样。

```js
// 收到 --unwish=1332010 时，别跑整轮抓取 —— 那条路要 90 秒，点一下等不起
if (P.unwish) {
  const ids = String(P.unwish).split(',').filter(Boolean);
  for (const id of ids) await removeFromWishlist(id);
  say.step(`从愿望单移除 ${ids.length} 款`);
  say.result({ 移除: ids.length });
  process.exit(0);
}
```

同理：**动作要走自己的短路分支**。一轮抓取 + 比对动辄一两分钟，用户点的是「删这一条」，
不是「重跑全部」。

## 6. 示例：照着抄

**完整可跑的样板**（四行协议 + 原子写记录 + exitCode 收尾，三件事都在里面）：

- `E:\Obsidian\叫我包仔\CONFIG\SCRIPTS\DockTools\iamtxt-signin\` —— `manifest.json` + `main.mjs`（Node 18+，零依赖）。接口写死、参数只留 Cookie、`secret` 不入记录、`[bz-p]` 拿不到进度就发 `null`。

脚本骨架只有四步，与语言无关（Python 用 `json.dump` + `os.replace` 换掉 `writeFileSync` + `renameSync` 即可，契约表格 4.1–4.3 就是全部）：

1. 路径：`RUNS_FILE = env.BZ_DOCK_RUNS_FILE ?? <脚本同目录>/runs.json`；`TRIGGER = env.BZ_DOCK_TRIGGER`（只有值等于 `auto` 才算 `auto`）。
2. 干活时用 stdout 发 `[bz-step]` / `[bz-p]` / `[bz-info]` / `[bz-result]`（各一行，JSON 体）。
3. 收尾**一定**写一条记录（含 `status` / `startedAt` / `message`，失败补 `error.kind`）：tmp + rename，`runs` 截到 200 条。
4. 用 `process.exitCode = 1` / `sys.exit(1)` 收尾 —— **不要 `process.exit()`**，stdout 走管道是异步的，立刻退出会截断输出。
   真踩过（iamtxt 签到，issue 552）：`process.exit()` 在 Windows 上偶发 libuv 收尾断言
   （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），进程以非零码收场 ——
   看起来像工具崩了，其实活全干完了。改 `process.exitCode` 就不会撞上。

## 7. 不要做

- 不要让 id 与 `runs.json` 的 `tool` 不一致。
- 不要把 `secret` 写进记录的 `params`。
- 不要把声明从 stdout 吐出来（`--manifest` 通道已取消）。
- 不要直接覆写记录文件（半截 JSON）；别指望 bz 替你裁剪。
- 不要依赖 `PATH` / 宿主环境变量，需要什么就在脚本里写绝对路径。
- 不要把接口 URL、请求体、字段名、超时做成参数 —— 写死在脚本里。
- 不要解析与 `key` 拼写不一致的参数名：argv 就是 `--<key>` 逐字，`user_id` 不会变成 `--user-id`（见 2.2）。
- `schedule` 不要用 `weekly`（折不出种子）；依赖 PATH 之外也一样。
- **不要自己再配一份系统计划任务**（两个触发源，记录翻倍）。想让脚本在 Obsidian 关着时也按时跑，
  用的是**值守进程**（§3.4，`tools/dock-watch/`）—— 它与插件靠租约和共享记账共存，
  你自己另配一份计划任务没有这层保护。
- 记录里别写死 `trigger`；别编进度（拿不到写 `null`）。
- 别 try/catch 吞掉异常后 `exit 0`（bz 会判成功）。
- 别在脚本里做「今天跑过了就跳过」以外的调度判断 —— 该不该跑是 bz 的活。
- 改了 `run` 段记得去详情页重新确认信任，否则表现为「突然不跑了」。
- 框里的脚本能跑（§5.2），但**别去动 `parent`**：那是插件的 DOM。展示板是一块内容，
  不是第二个插件。
- 别在 `panel.html` 里引外部资源（相对路径与 `file://` 都拿不到，见 §5.2）—— 要什么就内联进去。

## 8. 提交前自检

1. `manifest.json` 能 `JSON.parse`，`v===1`、id 合法、`name` 非空。
2. id 与记录里的 `tool` 逐字一致。
3. `run.cmd` 能独立跑起来（cwd 缺省是工具目录）。
4. 面板「导入声明」核对框里的名字、命令、参数个数对得上；详情页看到一条种子规则。
5. 跑一次：出 `[bz-step]` / `[bz-p]`，拿不到的 pct 是 `null`。
6. `runs.json` 多一条，`tool === id`，`status` 在枚举内，secret 已剔除，`trigger` 取自环境变量。
7. 记录是 tmp + rename 写的，`runs` ≤ 200 条。
8. 造一个失败：`exit 1` + stderr 末行是原因 + `error.kind` 贴切。
9. 关掉全局总闸再手动跑一次 —— 手动路径也得通。
10. 参数表逐项自问：用户看到能凭自己填对吗？填不对的回脚本里写死。
11. **从面板点一次「运行」验证传参链**，别只靠命令行自测 —— 手工传参容易顺手用了和 `key` 不同拼写的名字（连字符 vs 下划线），把不一致正好盖住（实例见 2.2）。

## 9. 相关

- **参考实现**：`E:\Obsidian\叫我包仔\CONFIG\SCRIPTS\DockTools\iamtxt-signin\`（`manifest.json` + `main.mjs`，接口写死、参数只留 Cookie）。工具放 vault 内只是这位用户的习惯 —— 放 vault 外一样能登记。
- 源码：契约 `src/dock/schema.ts` · 文件路径 `src/dock/declaration.ts` · 协议 `src/core/external-tool.ts` · 拉起与环境变量 `src/dock/runner.ts` · 规则表 `src/dock/rules.ts` · 调度与熔断 `src/dock/scheduler.ts`
- **离线值守**：进程本体与装法 `tools/dock-watch/README.md` · 租约与状态接口 `src/dock/watchdog.ts` · 判据打包面 `src/dock/watch-core.ts`（改判据要重跑 `node scripts/build-dock-watch.mjs`）
- **展示板**：文件名与读取 `src/dock/declaration.ts` 的 `PANEL_FILENAME` / `readPanelText` · 渲染 `src/dock/ui.ts` 的 `boardSection`（沙箱口径与主题变量清单都在那一段注释里）
- 面板数据住**数据目录** `dock.json`（ADR-0239，只剩索引 + 三个全域开关）；**排期状态住工具目录的 `dock-state.json`**（ADR-0248，规则表 / 记账 / 台账跟着工具走）；**信任住本机插件设置** —— 换 vault / 换机器要重新确认。
- ADR：0235（声明文件自描述）、0236（bz 调度 + 记录归工具目录）、0237（文件名对齐插件惯例 + `main.mjs`）、0239（面板数据搬出插件设置、信任留本机）、0242（离线值守：判据复用 + 租约互斥）、0243（展示板：脚本画 `panel.html`，沙箱 iframe 内嵌）、0248（排期状态跟着工具走）
