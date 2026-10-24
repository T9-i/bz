# 给 bz 工具坞写一个外部工具（契约 v2）

> 这一版**不兼容 v1**。旧的 `runs.json`、`dock-state.json`、声明里的 `schedule` 一律不再被读取。
> 老工具照着本文重写一遍即可 —— 逻辑不用动，动的是「怎么说话」和「怎么落账」。

工具坞不关心你的脚本是什么语言、做什么事。它只认五份文件、四个标记、一条退出规则。

---

## 0. 一分钟版

| 你要做的 | 在哪 |
|---|---|
| 告诉 bz 你是谁、怎么启动你 | `manifest.json` |
| 收用户填的参数 | 命令行 `--key=value` + 环境变量 `BZ_DOCK_SECRET_*` |
| 说话（进度、结果） | stdout 四个标记 |
| 留下这次运行的证据 | `runs.jsonl` **追加一行** |
| 证明你还活着 | `heartbeat.json` 每 5 秒盖一次 |
| 画一块自己的界面（可选） | `panel.html` |

**记录和心跳必须由你写，bz 只读。** 这是硬边界：bz 一旦代写，「这次到底干成没有」就变成两个作者吵架。

---

## 1. 目录

默认 `<vault>/CONFIG/SCRIPTS/DockTools/<工具名>/`，放 vault 外也行（登记的是绝对路径）。
整个目录搬到哪都不坏 —— 所有路径都由 `manifest.json` 的位置推出来。

```
my-tool/
├── manifest.json     手写
├── main.mjs          手写
├── data.json         bz 写（用户填的参数值）
├── runs.jsonl        你写（追加）
├── heartbeat.json    你写（运行期间）
└── panel.html        你写（可选）
```

---

## 2. `manifest.json`

```jsonc
{
  "v": 2,                          // 必须是 2。写 1 会被整份拒绝
  "id": "my-tool",                 // ^[a-z0-9][a-z0-9-]*$，≤64，与脚本里的 ID 一致
  "name": "我的工具",
  "description": "一句话说清它干什么",   // ≤20 字，卡片只显示两行
  "icon": "zap",                   // lucide 名字
  "entry": { "cmd": "node", "args": ["main.mjs"] },
  "params": [ /* 见 §3 */ ],
  "defaultRules": [                // 可选：用户第一次打开时抄进他的规则表
    { "id": "r-daily", "trigger": { "kind": "daily", "at": "09:00" }, "action": { "kind": "run" } }
  ]
}
```

- **没有 `entry` 就只能看不能跑。** 不再有「目录里有 main.mjs 就自动当入口」这条约定 —— 不猜。
- `entry.cwd` 缺省是声明文件所在目录；`entry.shell` 缺省按扩展名判（`.cmd` / `.bat` 走 shell）。
- `description` 只写「做什么 + 留下什么」，20 字封顶。多出来的字是被截掉的，不是省略号。

---

## 3. 参数

只放三类：**凭据**、**用户偏好**、**因机器而异的值**（模拟器路径、代理）。
判据一句话：用户看到这个框，能凭自己填对吗？填不对的（接口 URL、请求体字段名、超时）写死在脚本里。

| type | 控件 | 下发方式 |
|---|---|---|
| `text` / `number` / `choice` / `path` / `multiline` / `multichoice` | 对应控件 | `--key=value` |
| `bool` | 勾选 | 真时发 `--key`，假时不发 |
| `secret` | 密码框 | **环境变量** `BZ_DOCK_SECRET_<KEY>` |

### 凭据为什么走环境变量

命令行在任务管理器 / `ps` 里人人可见。截图发群求助时，`--cookie=...` 就跟着出去了。
环境变量只有同用户（Windows 上还要提权）能读。

```js
const cookie = String(
  arg('cookie') || process.env.BZ_DOCK_SECRET_COOKIE || ''
).trim();
```

参数名大小写敏感：`deepseek_key` → `BZ_DOCK_SECRET_DEEPSEEK_KEY`（大写、非字母数字换成 `_`）。

---

## 4. 说话：stdout 四行协议

一行一个标记，冒号后一个空格：

| 标记 | 用途 |
|---|---|
| `[bz-step] 文本` | 一步做完的流水（面板实时日志） |
| `[bz-p] {"phase":"签到","pct":40}` | 阶段与百分比 |
| `[bz-info] {...}` | 结构化数据，可多条 |
| `[bz-result] {...}` | 最终结果，一条 |

```js
const say = {
  step: (t) => process.stdout.write(`[bz-step] ${t}\n`),
  p: (phase, pct) => process.stdout.write(`[bz-p] ${JSON.stringify({ phase, pct })}\n`),
  info: (d) => process.stdout.write(`[bz-info] ${JSON.stringify(d)}\n`),
  result: (d) => process.stdout.write(`[bz-result] ${JSON.stringify(d)}\n`),
};
```

**只用 `process.exitCode`，不要 `process.exit()`。** stdout 走管道是异步的，立刻退出会把最后几行截断 ——
面板上就是你辛苦发的步骤一条都没有。

---

## 5. 记录：`runs.jsonl`

bz 会注入：

| 环境变量 | 含义 |
|---|---|
| `BZ_DOCK_RUN_ID` | **这次运行的工单号**，必须原样写进记录 |
| `BZ_DOCK_RUNS_FILE` | 记录文件的绝对路径 |
| `BZ_DOCK_HEARTBEAT_FILE` | 心跳文件的绝对路径 |
| `BZ_DOCK_TOOL` | 工具 id |
| `BZ_DOCK_TRIGGER` | `auto` 或 `manual` |
| `BZ_DOCK_VAULT` | vault 根目录（可能没有） |
| `BZ_DOCK_CONTRACT` | `2` |

**一行一次运行，只写终态**（`ok` / `failed` / `timeout` / `stopped`）。跑着的时候用 `heartbeat.json` 表达，
不要往记录里塞 `running` 行 —— 那会让每次心跳都重写一遍文件，还会在历史里留下半条。

```js
function writeRun(rec) {
  const file = process.env.BZ_DOCK_RUNS_FILE || path.join(HERE, 'runs.jsonl');
  const line = JSON.stringify({
    ...rec,
    runId: process.env.BZ_DOCK_RUN_ID || `local-${Date.now().toString(36)}-${process.pid}`,
    tool: 'my-tool',
    trigger: process.env.BZ_DOCK_TRIGGER === 'auto' ? 'auto' : 'manual',
  }) + '\n';
  fs.appendFileSync(file, line);          // 追加：崩了最多坏最后一行
  trim(file);                              // 自己裁到 200 行
}
```

字段：

```jsonc
{
  "runId": "r1a2b3-9f8e7d6c",   // 必填，bz 给的那个
  "tool": "my-tool",            // 必填
  "trigger": "auto",            // auto | manual
  "status": "ok",               // 必填：ok | failed | timeout | stopped
  "startedAt": "2026-10-24T01:02:03Z",
  "finishedAt": "2026-10-24T01:02:45Z",
  "durationMs": 42000,
  "exitCode": 0,
  "message": "签到成功，积分 +12",       // 给人看的一句话
  "error": { "kind": "auth", "detail": "...", "stderr": "尾部 2KB" },
  "steps": [{ "text": "打开首页", "at": "...", "status": "ok" }],
  "info": [ /* [bz-info] 的内容 */ ],
  "result": { /* [bz-result] 的内容 */ },
  "metrics": { "credit": 1280 }
}
```

- `error.kind` 只认 `auth` / `network` / `config` / `timeout` / `aborted` / `unknown`。
  **这是「汇报完成情况」最值钱的一个字段** —— bz 靠它直接告诉你「去重新填凭据」还是「网络不通」。
- **不要写 stdout 原文**，失败时只留 stderr 尾部 2KB。
- **凭据不能出现在记录里**（`params` 里也不行）。

---

## 6. 心跳：`heartbeat.json`

跑着的时候每 5 秒盖一次：

```js
function beat(step) {
  fs.writeFileSync(process.env.BZ_DOCK_HEARTBEAT_FILE, JSON.stringify({
    runId: RUN_ID, at: new Date().toISOString(), step: step || '',
  }));
}
const timer = setInterval(() => beat(), 5000);
timer.unref?.();
process.on('exit', () => clearInterval(timer));
```

它只回答一个问题：**你还活着吗**。

**说清楚它不干什么**：bz **不拿心跳判死刑**。这次到底干成没有，由进程退出 + 你那一条 `runs.jsonl`
记录决定（`judgeRun` 只看 `runId` 那一条）；超时强杀线是 10 分钟，也不看心跳。
心跳的用处是**让人看得见**：你在跑长任务、七八分钟不吭声，面板与日志靠它区分「还在干」和「早死了」。
所以别拿它替代记录 —— 也不要因为「心跳还在写」就以为这次算成功。

---

## 7. 展示板：`panel.html`（可选）

详情页最上方那块整宽区域，装在沙箱 iframe 里。

- 单文件自包含：样式、图片都内联（外链在这个语境里拿不到）。
- 上限 512 KB。
- 框里可以跑脚本（`allow-scripts`），但**没有 `allow-top-navigation`**。
- 数字在写文件时算好写死，比「页面里现算」稳：板子不需要等你打开才加载数据。
- 没有这个文件 = 那块整块不出现，不要交一个空白 HTML。

---

## 8. 超时与中止

- bz 的单次运行上限 **10 分钟**，到点整棵进程树会被收掉（`taskkill /T /F`）。
- 自己留足余量：预算别贴着 10 分钟，收尾（写记录、关模拟器）也要算进去。
- 被强杀时写不到记录 —— 所以**关键中间结果要早点落盘**，别攒在最后一次性写。
- 用户点「停止」时同样是强杀。想优雅收尾就监听 `SIGINT` / `SIGTERM`（Windows 上收不到，靠早落盘）。

---

## 9. 询问用户（可选）

跑到一半要人拍板时，往 stdout 发一行：

```
[bz-ask] {"id":"a1","title":"要关掉 Steam 吗","body":"会写 12 个分类，需要先退出 Steam"}
```

bz 弹框，把答案写回 stdin 一行 `[bz-answer] {"id":"a1","ok":true}`。

三条纪律：

1. **没人应答 = 取消**。自动运行、值守拉起都没有弹窗，bz 会立刻回 `ok:false`。
   所以脚本必须有超时与 EOF 兜底，别在启动时无条件读 stdin。
2. 等得起才问：从自己的预算里扣得出「等确认 + 写入」再问。
3. 问之前把话说全：写几款、进哪几个框、会不会关掉 Steam —— 否则那个「确认」是让人盲签。

---

## 10. 交活前自检

- [ ] `manifest.json` 的 `v` 是 2，`id` 合法，`entry` 指得对
- [ ] 命令行自测能跑通（`node main.mjs --key=value`）
- [ ] 用 `BZ_DOCK_RUN_ID=test-1 BZ_DOCK_RUNS_FILE=./tmp.jsonl node main.mjs` 跑一次，
      确认记录里 `runId` 就是 `test-1`
- [ ] 跑一次面板「运行」，确认日志一行行出来（不是跑完才一起冒）
- [ ] 失败路径也写记录（`status:'failed'` + `error.kind`）
- [ ] 跑完删掉 `tmp.jsonl`
- [ ] `panel.html` 打开不报错，且不超过 512 KB
