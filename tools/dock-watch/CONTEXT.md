# Dock Watch

工具坞的离线值守进程 —— Obsidian 关着时按同一份规则表跑外部工具的常驻 node 程序。

## Language

**值守进程 (dock-watch)**:
`tools/dock-watch/` 这个 node 程序本身。挂在 Windows 登录自启上的常驻进程，每 30 秒一拍。
**它不是工具坞工具**（工具是被调度方，它是调度方），所以不写 `manifest.json`、不进登记表。
_Avoid_: 守护进程, 后台服务, 定时任务

**租约 (lease)**:
`%LOCALAPPDATA%\bz-dock-watch\lease.json` —— 插件写的「我在场」声明（pid + 时刻 + vault）。
值守看到一份新鲜的、且属于**本 vault** 的租约就让位。它是两个调度者之间唯一的仲裁物。
_Avoid_: 锁, 心跳（心跳是它刷新的动作，不是这个文件）

**让位 (defer)**:
值守判定「插件此刻在拍」后什么都不做的那个状态（`status.json` 的 `mode=defer`）。
**这是正常状态**，不是故障 —— Obsidian 开着的时候它本来就该让位。
_Avoid_: 暂停, 跳过

**在场 / 离场 (in-session / off-session)**:
判据是**谁启动的**（契约 §4.4，ADR-0236 起）：bz 插件亲手拉起的（含它按规则自动触发）都是在场，
有实时流、能停止；值守拉起的都是离场，只有记录。
_Avoid_: 在线/离线, 自动/手动（那是触发方式的轴，不是这一根）

**离线总闸 (watchdog switch)**:
`dock.json` 的 `watchdog` 键（缺省开）—— 只管**离场那一半**让不让值守接手。
与 `autoRun` 分两层：`autoRun` 是「自动运行」这个行为的开关（在场离场都管），
两个都开才真的离场跑。开关只在设置页，面板那条是只读的。
_Avoid_: 值守开关（非 canonical，容易与它读的 `autoRun` 混）

**判据核心 (dock-core)**:
`dock-core.cjs` —— 从 `src/dock/watch-core.ts` 打包出来的判据模块（`ruleDue` 等）。
**生成物**，改判据要重跑 `node scripts/build-dock-watch.mjs`。
存在的唯一理由是：判据只能有一份实现。
_Avoid_: 共享库, 核心包

**待播报队列 (pending queue)**:
`pending.json` —— 值守把每次离场运行追加进去，插件启动时补报（开关复用 `notifyMissed`），
补完**只删自己播过的**那几条（值守可能正在追加新的）。
_Avoid_: 通知队列, 消息队列

**熔断 (breaker)**:
连续 3 次失败后台账里的 `pausedAt`。离场跑失败也会入账 —— 不然它会一直重试到天亮，
而用户第二天早上看到的是一串「失败」而不是「已经停了」。
_Avoid_: 暂停, 禁用
