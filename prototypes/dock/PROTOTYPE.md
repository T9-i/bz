# 工具坞 · UI 原型基准（PROTOTYPE.md）

> 通用规则见 `docs/prototype-first.md`；本文件只写工具坞（dock）域的落地形态。

## 基准文件（共用 CSS，单源）

- **`prototype.html`** — 工具坞 UI 的评审壳（两个真行为 iframe：桌面 1280×900 / 移动 412×915）。
- **`prototype-view.html`** — iframe 视图页：只加载 CSS + 行为包 + `bootDockSim(); openDockPanel();`。
- **`prototype-behavior.js`** — 构建产物（`node scripts/build-preview.mjs dock`），入口 `fake-sim.ts`，
  alias `obsidian → fake/fake-obsidian.ts`。**它把插件同款的 `src/dock` 依赖链
  （`ui / view / kernel / exec / rules / registry`）整套打进浏览器**——所以壳里跑的是真行为，
  不是另写一套。
- **`prototype-icons.js`** — 图标兑现表（手写 JS 对象，改 `ui.ts` 加图标就要补表；改完先
  `node --check prototype-icons.js`）。
- **`src/dock/styles.css`** — 唯一样式源（`bz-dock-*` 前缀），壳 `<link>` 直连，改样式刷新即见。

⚠️ 本域**没有** `src/dock/render.ts`（markup 全在 `ui.ts` 内拼），所以只登记在 `build-preview.mjs`
的 `BEHAVIOR_DOMAINS`、**不进** `PREVIEW_DOMAINS`。

## 壳里演了什么、没演什么

| | 壳里 | 插件里 |
|---|---|---|
| vault 文件系统 | `FakeVault`（localStorage 后端，`core/storage` 真实现跑在上面） | 真实 vault |
| 运行记录 `runs.jsonl` | **种子里预置** + 假子进程跑完追加 | 工具自己写（追加，只写终态） |
| 工具目录五份文件 | 种子：localStorage 里预置声明 / 参数值 / 意图 / 运行账 / 记录 / 心跳 / 展示板 | 工具目录里的真文件 |
| 登记表路径 | 种子里写**可移植形态**（`vault:CONFIG/...`），靠 FakeVault 的 `adapter.getBasePath()` 还原 | 桌面写 + 手机读，同一套还原 |
| 子进程 | 假 `child_process`（吐 `[bz-step]`、盖心跳、自己落账、`close`） | 真 `cp.spawn` |
| 系统选择器 | 假 `@electron/remote` dialog + `setSystemFolderPicker` | 真系统对话框 |
| 图标 | `prototype-icons.js` 内联 SVG | `setIcon` + lucide |
| 主题 | 壳按钮切 `body.theme-dark` | 跟随 Obsidian |

**钉住的不变量**：假子进程跑完是**由它自己**往 `runs.jsonl` 追加记录的——bz 全程没写过这份文件。
这正是本域的核心约束（每份文件只有一个写者），壳把这条不变量演出来，防止将来「顺手补一刀」。

**自检（`?selftest=1`）断言的是新面板的真实 DOM**，并且要求每种状态都有卡能看见
（正在跑 / 待授权 / 声明坏 / 熔断 / 已停用）。改面板类名时这段必须同步——上一版就是没同步，
自检静默空转了一整轮重写。

## 铁流程

1. 改 `src/dock/*.ts` 或 `styles.css` → `node scripts/preview-live.mjs 5177` →
   开 `http://localhost:5177/prototypes/dock/prototype.html`（热更新，SSE 自动 reload）；
2. 桌面 / 移动各过一遍，亮暗各一遍；
3. `node scripts/build-preview.mjs dock` 重出行为包 —— **改了 `src/core/**`（本域的包内联了
   `core/`）或 `src/settings.ts` 时，`gameshelf / home / memo / review / settings-panel` 的包也会
   随之过期**（它们同样内联 `core/`），守卫 `tests/preview-freshness.test.ts` 会红，照它给的命令重出。

## 域内注意事项（踩过的坑）

- **`Buffer` polyfill**：`core/external-tool.ts` 的行缓冲按字节切分，用到 Node 的 `Buffer`。
  浏览器没有，`fake-sim.ts` 里装了一个最小实现（只兑现 `from/concat/length/indexOf/subarray/toString`）。
  刻意**不继承** `Uint8Array`——静态 `from` 的签名与 `Uint8ArrayConstructor.from` 不兼容（TS2417）。
- **假进程 kill 必须补 `close`**：`core/external-tool` 只在 `close` 事件上终结。不补的话
  「停止」会让运行永远停在 running（真机上被 kill 的进程是会 `close` 的）。
- **壳内自检按 `window.DOCK_SEED` 现算期望值**（`fake-sim.ts` 外露种子事实），别在壳里硬编码
  一份会漂的数字——尤其「待关注」的档位数是日期相关的，只能与 DOM 里的 `.is-due` 互校。
- **两分区（自动运行 / 手动）是 UI 概念**：由「有没有启用中的规则」现推（`ui.ts` 的 `section()`），
  不是登记里的字段。所以只留手动工具时只有一个分区——这不是 bug。
