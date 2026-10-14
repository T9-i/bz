# 542 · 值守安装脚本：PS 5.1 读不了无 BOM 的中文脚本，标准用户注册计划任务被拒

## 症状

第一次真装值守进程（`tools/dock-watch/install.ps1`）时两连撞：

1. 按 README 那句在 **Windows PowerShell 5.1** 里跑，脚本整篇解析失败 —— 报的是
   `","后面缺少表达式` / `字符串缺少终止符:"` 这种跟代码无关的位置（22 行 `[switch]$NoTask,`、
   149 行 Write-Host）。用 pwsh 7 跑同一个文件就正常。
2. 换 pwsh 跑通到注册那步，`Register-ScheduledTask` 直接 **拒绝访问**。

## 根因 1：脚本是 UTF-8 无 BOM，PS 5.1 按系统代码页读

PowerShell 5.1 读 `.ps1` 时**没有 BOM 就按 ANSI（中文机上是 GBK）解释字节**。脚本里中文注释和
中文字符串一多，GBK 解出的字节会吞掉引号/换行（日志里能看到 `路 鐘舵€侊細` 这种），
于是解析器在错误的位置报错 —— 看起来像语法错，其实是编码错。

同一个文件在 pwsh 7 下没问题：7 默认按 UTF-8 读。脚本自己第 121 行还专门提醒过
「vbs 要按 Default 编码写」，唯独漏了它自己这份。

## 根因 2：Register-ScheduledTask 要提升的权限

本机当前账号**不是管理员组成员**（`IsInRole(Administrator) = False`）。
`Register-ScheduledTask` 注册到任务库根目录要提升权限，标准用户拿不到 → 直接拒绝访问。
`schtasks /create` 是同一处的另一张皮（且它会交互式问密码），不是解法。

## 修法

`install.ps1`：

- 文件存成 **UTF-8 with BOM**（`uninstall.ps1` 一并处理），PS 5.1 与 pwsh 都能读；
  脚本头注释里写明这条约束，免得下次有人"顺手去掉 BOM"。
- 注册计划任务包进 `try/catch`，**失败即回退到「启动」文件夹**
  （`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\bz-dock-watch.vbs`）：
  标准用户可写，同样是登录自启、同样无窗口（`wscript` + `sh.Run ..., 0`）。
- 回退分支下没有 `Start-ScheduledTask` 可用，装完那次改成
  `Start-Process -WindowStyle Hidden` 直接起 node 常驻。

`uninstall.ps1`：注销计划任务之外，一并清掉启动文件夹里那个 vbs —— 否则卸完还会自启。

## 验证

PS 5.1 下重跑（`-NoStart`），解析通过并走到回退分支：

```
✓ 配置：C:\Users\PC\AppData\Local\bz-dock-watch\config.json
✓ 启动器：C:\Users\PC\AppData\Local\bz-dock-watch\watch.vbs
! 注册计划任务失败：拒绝访问。  常见原因：当前不是管理员……改用「启动」文件夹。
✓ 启动文件夹：…\Start Menu\Programs\Startup\bz-dock-watch.vbs
```

装完 `cli.js --status` 认得库与规则表（`mode=defer`，Obsidian 在场时正确让位）。
