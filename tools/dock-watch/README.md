# dock-watch —— 工具坞值守进程

**Obsidian 没开的时候，替它按同一份规则表跑工具坞里的工具。**

它不是一个工具坞工具（那些是被调度的），它是**调度方本身** —— 但它没有自己的调度逻辑：
判据、排班、起进程、判成功、记账全在 `dock-core.cjs` 里，那是从 `src/dock/watch-core.ts`
打出来的**同一份源码**，插件里跑的是同一段 `tickOnce`。它只多管两件插件管不到的事：
**等网**（登录瞬间网卡常没就绪）与**本机状态**（`status.json` / 日志，不进 vault）。

设计背景见 `docs/adr/adr-0242-dock-watchdog-offline-scheduling.md`，契约 v2 的改动见
`docs/adr/adr-0252-dock-contract-v2.md`。

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

装完在 Obsidian 里确认一次：**设置 → 工具坞 → 关掉 Obsidian 也让自动任务跑**（开关），
下面那行「值守状态」会显示它现在到底在不在跑、上次心跳是什么时候。
没装的话那一行会直说「没装或从没启动过」—— 开关开着也不会有人接手。

## 看它在干嘛

```powershell
node tools/dock-watch/cli.js --status    # 配置、账本路径、工具个数、心跳、上次跑成什么样
node tools/dock-watch/cli.js --once      # 只拍一次就退出（排障：看它认不认得你的规则表）
```

`--once` 和常驻走的是同一段内核，所以**带抖动的规则只会在这一次被排上队**（记账），不会当场跑 ——
下一次常驻启动后到点才跑。`--once` 看到的是「判据认不认这些规则」，不是「结果好不好」。

日志：`%LOCALAPPDATA%\bz-dock-watch\logs\watch.log`（**只在有事件时写**，不复述每一拍）。
`--status` 或 `BZ_DOCK_WATCH_VERBOSE=1` 会把过程打到终端。

`mode=busy` 表示锁在插件（或某次手动运行）手里，这一拍它什么都没做 —— 这是**正常状态**，不是坏了。
两边抢的是同一把执行权锁，没有「让位」这种靠自觉的机制。

## 网络没通的时候

计划任务是在**登录那一刻**拉起它的，而那时 Wi-Fi / 拨号常常还没就绪。所以**每一拍之前先等网络接通**：

- 探测：TCP 直连几个公网 443（IP 直连、不走 DNS），任一通即算通；
- 最多等 5 分钟，每 3 秒探一次（`config.json` 的 `net` 块可改，见下）；
- 等到就照跑；**等不到就不记账**，把这次留给下一拍 —— 「到点没网」不等于「今天跑过了」。
  这是这个功能的核心：只加等待、照旧记账，等于把失败换成静默跳过；
- 通了之后 5 分钟内不再重探（开机那一串任务只握一次手）；等不到则静默 60 秒再试；
- 没网时**整拍不拍**（不只跳过某个工具）：这一拍判据都不走，自然也不会记账。
  代价是不需要联网的本地工具也会被挡 —— 值守分不出哪个要联网，而错跑一个联网任务比晚跑几分钟贵。

日志会把两种收场分开写：`等网 N 秒后接通，继续跑 …` / `等网 N 秒仍未接通，… 留到下一拍（这次不记账）`。
不会伪装成一次「跑失败」。`--once` 也一样等 —— 排障时要看清它是在等网。

配置可选，不写就用上面的缺省值（老安装的 `config.json` 里没有这段，不需要重装）：

```json
"net": {
  "waitMs": 300000,
  "probeEveryMs": 3000,
  "connectTimeoutMs": 3000,
  "hosts": ["223.5.5.5:443", "119.29.29.29:443", "1.1.1.1:443"]
}
```

## 它不认识的那些规则

| 触发 | 离场 | 说明 |
|---|---|---|
| 每天某时 / 每隔一段时间 | ✅ | |
| 某个数值达到条件 | ✅ | 直读 vault 里的 json |
| 某个工具成功/失败后 | ❌ | 暂不支持：一拍之内不再重跑判据（插件侧也一样） |
| **启动 Obsidian 后** | ❌ | 语义是「Obsidian 启动后」；离场拿不到这个时刻 |
| **打开工具坞时** / **某个事件发生时** | ❌ | 需要插件进程里的面板与域总线 |
| **某个目录有变动** | ❌ | 第一版没做（没事件时规则自然不命中，不会乱跑） |

`只提醒` 类规则在离场**记账但不投递** —— 提醒的价值在「当时」，隔一天补一条只是噪音。

## 和插件怎么不打架

靠**一把锁**，不靠客气。

- 两边每拍都抢 `<数据目录>/dock.lock`（排他创建，90 秒没续期就算过期，持有者每 20 秒续期）；
- 抢到的那一个才调度，另一个这一拍什么都不做（`mode=busy`），下一拍再抢；
- 持有者崩了，锁 90 秒后能被抢走 —— 不会把调度永久锁死；
- 续期失败（锁被别人拿走了）→ **不再起新的**：每跑完一个就看一眼锁还是不是自己的，
  不是就收手。正在跑的那一个会跑完并落账（它已经启动了，半路砍掉才是真丢）。

第二道防线是共享记账：`lastFiredAt` 在各工具目录的 `dock.runtime.json` 里，
`pending`（已排队未跑）也在那里 —— 谁跑完谁清，两边读到的是同一份事实。

**旧版的「租约让位」已经删掉**：那是「我看见你在，我就让」的礼貌，不是互斥。

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

`test/watcher.test.mjs` 是**端到端**的：造一个真临时 vault（插件设置 + `dock.json` + 一个真能跑的
假工具），真的 tick 一次，断言工具记录里的 `runId` 就是内核给的那个、账本里的 `pending` 被清掉、
关着开关时不跑、锁不在手里时不抢、没网时不记账。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File tools/dock-watch/uninstall.ps1          # 停进程 + 注销自启，留配置与日志
powershell -ExecutionPolicy Bypass -File tools/dock-watch/uninstall.ps1 -Purge   # 连目录一起清
```

不想卸载只想停：在 Obsidian 里把「关掉 Obsidian 也让自动任务跑」关掉即可（值守读到开关会停在 `mode=off`）。
