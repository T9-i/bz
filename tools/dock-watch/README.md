# dock-watch —— 工具坞值守进程

**Obsidian 没开的时候，替它按同一份规则表跑工具坞里的工具。**

它不是一个工具坞工具（那些是被调度的），它是**调度方本身** —— 判据用的就是插件那份 `ruleDue`，
打包进 `dock-core.cjs`（见下）。设计与理由见 `docs/adr/adr-0242-dock-watchdog-offline-scheduling.md`。

## 装

不需要管理员：

```powershell
powershell -ExecutionPolicy Bypass -File tools/dock-watch/install.ps1
```

它会做四件事，一次做完：

1. 写下 `%LOCALAPPDATA%\bz-dock-watch\config.json`（服务哪个 vault、多久一拍）；
2. 生成 `watch.vbs` —— 隐藏窗口的启动包装（node 是控制台程序，直接挂计划任务会闪黑框）；
3. 注册**登录自启**的计划任务 `bz-dock-watch`（失败重试 3 次，不限最长运行时间）；
   **注册被拒时**（标准用户上常见：`Register-ScheduledTask` 要提升的权限）自动回退到
   「启动」文件夹 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\` ——
   同样是登录即启动，不需要管理员；
4. 立刻起一次，并打印一句 `--status` 的命令。

不给 `-Vault` 时它从 Obsidian 自己的库列表里挑**最近打开的那个**，并把挑中的路径打印出来。
挑错了就带上参数重跑，覆盖安装是幂等的：

```powershell
powershell -ExecutionPolicy Bypass -File tools/dock-watch/install.ps1 -Vault "E:\Obsidian\叫我包仔"
```

装完在 Obsidian 里确认一次：**设置 → 工具坞 → 自动运行 → 离线值守**。
装了是开关（默认开），没装是一句「还没装值守进程」。

## 看它在干嘛

```powershell
node tools/dock-watch/cli.js --status    # 配置、租约（现在归谁拍）、心跳、上次跑成什么样
node tools/dock-watch/cli.js --once      # 只拍一次就退出（排障：看它认不认得你的规则表）
```

`--once` 有个刻意的不同：**它不当场掷骰错峰**（带 `jitterMin` 的规则会立刻跑，而不是先记账、
等几分钟再跑）—— 排障入口的意义就是立刻看见结果，否则会出现「账记了、工具没跑」。
日常常驻那一拍照常抖。

日志：`%LOCALAPPDATA%\bz-dock-watch\logs\watch.log`（**只在有事件时写**，不复述每一拍）。
`--status` 或 `BZ_DOCK_WATCH_VERBOSE=1` 会把过程打到终端。

Obsidian 开着时它写的是 `mode=defer`（让位），这是**正常状态**，不是没在工作。

## 它不认识的那些规则

| 触发 | 离场 | 说明 |
|---|---|---|
| 每天某时 / 每隔一段时间 | ✅ | |
| 某个数值达到条件 | ✅ | 直读 vault 里的 json |
| 某个工具成功/失败后 | ✅ | 它自己跑完接着判联动 |
| **启动 Obsidian 后** | ❌ | 语义是「Obsidian 启动后」；离场拿不到这个时刻 |
| **打开工具坞时** / **某个事件发生时** | ❌ | 需要插件进程里的面板与域总线 |
| **某个目录有变动** | ❌ | 第一版没做（没事件时规则自然不命中，不会乱跑） |

`只提醒` 类规则在离场**记账但不投递** —— 提醒的价值在「当时」，隔一天补一条只是噪音。

## 和插件怎么不打架

两个调度者同时拍 = 同一个工具一天跑两遍，而且**两边都不觉得自己错**。所以有一张**租约**：

- 插件装载时、每拍时写 `%LOCALAPPDATA%\bz-dock-watch\lease.json`（含 pid 与写下的时刻），
  卸载时删掉；
- 值守只在租约**过期 / pid 已死 / 不是本 vault 的**时候才拍。

撤票是即时的：Obsidian 一关，值守下一拍（≤30 秒）就接管，不必等租约过期。
第二道防线是共享记账 —— `lastFiredAt` 就在同一份 `dock.json` 里，谁先记账谁跑。

## 改判据之后

`dock-core.cjs` 是**生成物**（别手改）：

```bash
node scripts/build-dock-watch.mjs      # 从 src/dock/watch-core.ts 重出（pnpm run build 也会跑）
```

改 `src/dock/rules.ts` 那类判据必须重打，否则值守用的还是旧判据。
产物里带着打包时的 bz 版本，面板与 `--status` 都比对它 —— 对不上就是该重装了。

## 测试

```bash
cd tools/dock-watch && node --test "test/*.test.mjs"
```

集成级的：造一个真临时 vault（含插件设置、`dock.json`、一个真能跑的假工具），真的 tick 一次，
断言租约让位、记账写回、环境变量注入、参数逐字下发这些**跨进程约定**。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File tools/dock-watch/uninstall.ps1          # 停进程 + 注销自启，留配置与日志
powershell -ExecutionPolicy Bypass -File tools/dock-watch/uninstall.ps1 -Purge   # 连目录一起清
```

不想卸载只想停：在 Obsidian 里把「离线值守」开关关掉即可（值守读到开关会停在 `mode=off`）。
