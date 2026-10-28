# ADR-0266 设置面板三处返工：版本检查有反馈、外部工具独立成组、镜像源下线

- 状态：采纳
- 日期：2026-10-28
- 相关：ADR-0263（外部工具分发）、ADR-0264（首次引导）、ADR-0265（分发硬化）

## 背景

对外首版发出去之后，用户在自己的 vault 里实测，报回三件事：

1. 「关于 → 版本 → 检查并更新」点下去**没有任何反应和提示**；
2. 「外部工具」组里混着一条「镜像源」，且三个工具和文档资源排在同一张卡里；
3. 镜像源这一行多余。

第一条是**功能失效**级别的：用户没法判断按钮是坏了、在跑、还是没网。查下来是三个
独立缺陷叠在同一个按钮上：

- `info` 行的 `actions` **没有接 `stateful`**（两个渲染器都只写了 `onClick`，没有 busy/✓/✕）。
  `stateful` 是 2026-09 为 text 行做的（issue 434），info 行当时没跟上。
- `requestUrl` **没有超时参数**。国内网络下 raw 与 cdn.jsdelivr.net 同时不通时，请求会挂到
  用户放弃为止；五条通道串行，等于**几十分钟内一个字都不说**。
- 结果分支不全：只有 `current` 和抛异常才提示，`available`（发现但没装）静默。

第二条的根因是一次**用错了主键**的过滤：

```ts
const bundleIds = new Set(docs.filter(d => d.kind === 'bundle').map(d => d.id)); // tool-dock-watch
const toolRows = meta.rows.filter(r => bundleIds.has(String(r.name)));           // 工具坞值守
```

行名给人看、id 给机器用，两者永远不相等 → `toolRows` 恒为空 → 「外部工具」组是空的，
三个工具全落进「在线资源」。用户看到的「工具和镜像源挤在一张卡里」就是这个空组的下游症状。

## 决策

### 1. 版本检查：全过程都要说话（且不能无限等）

- **`info` 行接上 `stateful`**（两个渲染器同口径）：点击即 busy 转圈并禁用（顺带防连点），
  resolve 绿✓、reject 红✕ + 短原因，2 秒后复原。
- **`setRowBtnState` 增加 `okText`**：缺省「已连通」是给「测试连接」类按钮的，
  版本检查成功得写「已是最新」，否则读成另一个意思。
- **`requestUrl` 外包一道 6 秒硬时限**（`withTimeout`）：底层请求无法真正取消，
  但调用方不再无限等。第一条通道单独试（保持 raw 最新鲜），失败后**其余通道并发**打出去
  ——串行试五条时用户要盯着转圈半分钟才知道「没网」。
- **一条常驻通知全程接管**：点下即弹「正在检查更新…」（progress 态、不自动消失），
  结束时原地改成结果（success / error + 原因）。`checkSelfUpdate` 新增 `silent`，
  面板自己说的时候它不再另弹一条。
- **动作完成后就地重写版本行的描述**（`paintVersionDesc`）：`desc` 是字符串，重建面板读到的
  还是旧文案；而「现在是最新版还是已下载待重载」正是这一刻唯一想看的东西。

### 2. 外部工具独立成组（修主键）

按 **id** 取行（`meta.entries` 里才有 id），不按行名：

```ts
const toolRows = meta.entries.filter(e => bundleIds.has(e.id)).map(e => e.row);
```

「外部工具」（三个目录包）在前，「在线资源」（操作行 + 文档 + 皮肤）在后，两组各只有自己的行。
行对象仍是同一批引用——状态机、`runAll`、检查更新、落盘事件同步都不分叉。

### 3. 镜像源下线（能力保留）

面板不再露出「镜像源」这一行。**设置键与读取逻辑保留**：

- 企业网用户仍可改 `data.json` 的 `resourceMirror`（比界面更省事的还有一条：
  把仓库 `downloads/` 拷到 vault 下的 `bz-offline/`，`core/offline-source` 直接读本地）；
- 删掉这一行不影响任何既有用户（默认值就是空串 = 只走官方通道）。

理由：日常用户看不懂「基址要与仓库结构一致」，摆在「在线资源」里只是噪音；
而真正需要它的人（内网、无外网）本来就在改配置文件。

## 顺手修掉的一处

`SettingsPanelUI.renderDomain` 在 `await loadSchemaCached()` 之后**没有检查宿主是否还在**。
面板关闭 / Obsidian 退出 / 测试 teardown 期间 schema 才 resolve 时，下一句 `createElement`
抛 `Cannot read properties of undefined`——一条与用户操作毫无关系的未处理拒绝。
现在 await 之后先看 `document` 是否还在，失败分支同样先看。

## 后果

- 「检查并更新」最坏情况下 12 秒内一定有结论（6s 首通道 + 6s 并发兜底），且从第一毫秒起就
  有转圈和通知。**不再存在「点了像没点」的状态。**
- 设置面板的通用页组序：关于 → 功能域 → 通知 → 数据存储路径 → **外部工具** → **在线资源**。
- `sp-contract-lock` 的 global 基线 10 → 9（镜像源 text 行下线）。
- 新增测试：`info` 行 stateful 三态、点击同步段即有提示、失败带原因、两组按 id 分家。
