# 552 · 离线简报把签到成功报成失败 —— 值守侧判成败只看退出码，从没跟工具记录对账

## 症状

Obsidian 关着的那段时间跑了 iamtxt 签到，回来弹出的离线简报写着：

```
iamtxt 每日签到                     1 次 · 1 失败
10-17 11:59 · 签到成功
```

同一行里，「失败」与「签到成功」自相矛盾。工具自己的记录也是 `status: ok`、
`exitCode: 0`、`message: 签到成功` —— 站内确实签上了。

## 根因：issue 544 的对账只补在插件侧，值守侧漏了

`runner.ts` 在 544 里加了 `reconcileWithRecord()`：退出码只是推断，判决以工具自己那条
`runs.json` 记录为准。但离场那条路径（`tools/dock-watch/watch.js`）**另一份实现**，
它一直只写：

```js
const ok = outcome.ok === true;   // ← 退出码，没读记录
```

而 ADR-0242 存在的全部理由就是「同一个工具在面板里能跑、关掉 Obsidian 就跑不起来」
是这类双层实现最贵的缺陷 —— 判定口径两边不一致，正是它要防的东西。544 修了通知，
简报这条同源路径没跟着改。

## 那次非零退出是什么（顺带回答 544 留下的问号）

544 的「还没能回答的」写着：复现不出、也没证据可查。这次有证据了 ——
`%LOCALAPPDATA%\bz-dock-watch\logs\watch.log` 里留着 stderr 尾部：

```
2026-10-17T03:59:26.078Z 跑完 iamtxt 每日签到：失败（签到成功）
2026-10-17T03:59:26.079Z   stderr 尾部：Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

iamtxt 的 `die()` 用 `process.exit()` 硬退（`main.mjs:349`）。stdout 走管道时是异步写，
`process.exit()` 在 Windows 上偶尔会撞上 libuv 的 async handle 收尾断言 —— 进程以非零码
结束，但**活干完了、记录也写了**（记录是同步 `writeFileSync` + `rename`，先落地）。

契约 §6 第 4 步早就写着「**不要 `process.exit()`**，stdout 走管道是异步的」，工具自己
违反了这条。所以根因有两层：

1. **bz 侧（本票）**：退出码不该是唯一判决 —— 与插件侧同一把尺子才对；
2. **工具侧（本机 vault，另改）**：`process.exit()` → `process.exitCode`，不再撞那个断言。

## 修法

`tools/dock-watch/watch.js` 新增 `resolveOk(outcome, note)`，口径与 `runner.ts` 的
`reconcileWithRecord` 逐条对齐：

| 现场 | 判决 |
|---|---|
| 有本次记录 | 看记录 `status`（`ok` 才算成功） |
| 本次没留记录 / `status` 不是字符串 | 回落退出码（问不出就别猜） |
| `stopped`（超时强杀） | 恒失败，不参与对账（是 bz 掐的） |

配套两处：

- **`launch.readRunNote` 的容差 60 秒 → 2 秒**（对齐 `runner.ts` 的
  `RECORD_MATCH_GRACE_MS`）。原来那 1 分钟是为了迁就「工具时钟/时区写歪」，代价却是
  「本次进程压根没起来时，上一分钟内刚成功的那条会被当成本次」—— 报成功比报失败更难查。
  同一次起跑留多条时也改成取 `startedAt` 最晚的那条，不按数组下标猜。
- **日志留线索**：记录说成功、退出码却不干净时，多记一行
  `退出码 N，但工具记录写的是成功 —— 以记录为准`。判决按记录，但「工具其实崩了」这件事
  不能因此消失。

`docs/dock-tool-guide.md` §4.2 补上「成败的最终判决在你写的 `status`，退出码只在没记录时
兜底」，§6 第 4 步补上 libuv 断言的实物证据。

## 没做

- 没改 iamtxt 自己的 `trigger: 'auto'` 硬编码（544 已记，仍属工具侧独立缺陷）。
- 没把「记录说成功但退出码非零」升级成警告通知：它已经不影响判决，弹两次只会更吵；
  写进日志够排障了。

## 验证

- `node --test tools/dock-watch/test/*.test.mjs`：24 项全过，其中新增 3 项 ——
  记录成功 + 退出码 1 → 队列 `ok: true` 且台账不攒失败；记录失败 + 退出码 0 → 判失败；
  没记录 + 退出码 0 → 回落 `退出码 0` 兜底文案。
