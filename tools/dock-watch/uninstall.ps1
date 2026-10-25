<#
卸载工具坞值守进程（ADR-0242）。

默认只做「停掉并注销自启」——配置、状态与日志都留着（重装即可继续，也便于事后翻日志）。
要连目录一起清掉就加 `-Purge`。

用法：
  powershell -ExecutionPolicy Bypass -File uninstall.ps1
  powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'bz-dock-watch',
  # 连 %LOCALAPPDATA%\bz-dock-watch 整个目录一起删（配置、状态、日志都不留）
  [switch]$Purge
)

$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'bz-dock-watch'

# ---------- 1. 先注销自启动（计划任务，或回退时用的「启动」文件夹） ----------
#
# 顺序是硬要求：**先让自启动失效，再杀进程**。
# 计划任务注册时带了 -RestartCount 3 -RestartInterval 1 分钟 —— 先杀进程的话，
# 调度器会在一分钟内把它重新拉起来；随后任务虽被注销，那个新进程已经成了没人管的孤儿，
# 常驻不退。反过来做，杀完就没有下一个人来拉它。

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "✓ 已注销计划任务：$TaskName"
} else {
  Write-Host "· 没有名为 $TaskName 的计划任务"
}

# install.ps1 注册计划任务被拒时会回退到「启动」文件夹 —— 两条路都要清，否则卸完还会自启
$startupVbs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\$TaskName.vbs"
if (Test-Path -LiteralPath $startupVbs) {
  Remove-Item -LiteralPath $startupVbs -Force
  Write-Host "✓ 已删除启动文件夹里的启动器：$startupVbs"
}

# ---------- 2. 停掉在跑的进程 ----------

$lockFile = Join-Path $dir 'watch.lock'
if (Test-Path -LiteralPath $lockFile) {
  try {
    $lock = Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8 | ConvertFrom-Json
    # 别用 $pid —— 那是 PowerShell 的自动变量（当前进程）
    $watchPid = [int]$lock.pid
    $proc = Get-Process -Id $watchPid -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $watchPid -Force
      Write-Host "✓ 已停止值守进程（pid $watchPid）"
    }
  } catch {
    Write-Host '· 锁文件读不出来，跳过停进程（它可能本来就没在跑）' -ForegroundColor DarkGray
  }
} else {
  Write-Host '· 没有锁文件，说明它当前没在跑'
}

# ---------- 3. 收拾目录 ----------

if ($Purge) {
  if (Test-Path -LiteralPath $dir) {
    Remove-Item -LiteralPath $dir -Recurse -Force
    Write-Host "✓ 已删除：$dir"
  }
} else {
  Write-Host "· 保留：$dir（配置/状态/日志；重装时会覆盖配置）" -ForegroundColor DarkGray
  Write-Host '  想全清就加 -Purge 再跑一次'
}

Write-Host ''
Write-Host '完成。Obsidian 的设置页里那一行会回到「还没装值守进程」。' -ForegroundColor Cyan
