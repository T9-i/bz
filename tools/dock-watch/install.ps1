<#
工具坞值守进程的安装脚本（ADR-0242）。

做四件事，一次做完：
  1. 写下 `%LOCALAPPDATA%\bz-dock-watch\config.json`（告诉值守进程服务哪个 vault、多久扫一次表、多久看一眼条件）；
  2. 生成 `watch.vbs` —— **隐藏窗口**的启动包装（node 是控制台程序，直接挂计划任务会闪黑框）；
  3. 注册登录自启的计划任务（当前用户权限，不需要管理员）；
  4. 注册被拒时（标准用户上常见）**回退到「启动」文件夹** —— 同样是登录自启，不需要管理员。

注：本文件必须存成 **UTF-8 with BOM**。PowerShell 5.1 按系统代码页读脚本，
无 BOM 的含中文脚本会整篇解析失败（报"字符串缺少终止符"那类莫名其妙的错）。

用法（PowerShell 里跑，不需要管理员）：
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -Vault "E:\Obsidian\叫我包仔"
  powershell -ExecutionPolicy Bypass -File install.ps1 -IntervalSeconds 60 -NoStart

不给 -Vault 时会从 Obsidian 自己的 vault 列表（`%APPDATA%\obsidian\obsidian.json`）里挑最近打开的那个，
**并把挑中的路径打印出来** —— 挑错了就带 `-Vault` 重跑一次，覆盖安装是幂等的。
#>
[CmdletBinding()]
param(
  # vault 根目录（不给则从 Obsidian 的 vault 列表里猜）
  [string]$Vault = '',
  # **扫描**间隔（秒）：多久重读一遍规则表、重算下次到期时刻。定点任务是到点即醒，跟它无关；
  # 它只决定「别人改了规则表之后多久被看见」。30 秒足够，也兜得住面板上的改动。
  [int]$IntervalSeconds = 30,
  # **条件**间隔（毫秒）：事件型规则（关闭 Obsidian）看一眼的成本。1 秒是缺省值 ——
  # 判据只有一次 `kill(pid,0)` 系统调用，不碰磁盘；设成 2000 能把唤醒砍半，人眼没区别
  [int]$ConditionMs = 1000,
  # 计划任务名
  [string]$TaskName = 'bz-dock-watch',
  # node 可执行文件（不给则从 PATH 里找，找不到就报错 —— **不猜**
  [string]$Node = '',
  # 只写配置与包装，不注册计划任务（排障用）
  [switch]$NoTask,
  # 装完立刻起一次（不等下次登录）
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
  Write-Host "✗ $msg" -ForegroundColor Red
  exit 1
}

# ---------- 1. 找 node：绝对路径，写进 vbs（契约 §6：不依赖 PATH） ----------

if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail 'PATH 里找不到 node。用 -Node "C:\path\to\node.exe" 指定一个。' }
  $Node = $cmd.Source
}
if (-not (Test-Path -LiteralPath $Node)) { Fail "node 不在：$Node" }

# ---------- 2. 定 vault ----------

function Get-RecentVault {
  $listFile = Join-Path $env:APPDATA 'obsidian\obsidian.json'
  if (-not (Test-Path -LiteralPath $listFile)) { return '' }
  try {
    $json = Get-Content -LiteralPath $listFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return ''
  }
  if (-not $json.vaults) { return '' }
  $all = @()
  foreach ($p in $json.vaults.PSObject.Properties) {
    $all += [pscustomobject]@{ path = $p.Value.path; ts = [int64]$p.Value.ts; open = [bool]$p.Value.open }
  }
  # 优先「当前开着的」，其次最晚打开过的
  $pick = $all | Where-Object { $_.open } | Select-Object -First 1
  if (-not $pick) { $pick = $all | Sort-Object ts -Descending | Select-Object -First 1 }
  if ($pick) { return $pick.path }
  return ''
}

if (-not $Vault) {
  $Vault = Get-RecentVault
  if (-not $Vault) { Fail '猜不出 vault。请带 -Vault "E:\...\你的库" 再跑一次。' }
  Write-Host "· vault 是从 Obsidian 最近打开的库里猜的：$Vault" -ForegroundColor Yellow
  Write-Host '  不对就带 -Vault 重跑（覆盖安装是幂等的）' -ForegroundColor DarkGray
}
$Vault = $Vault.TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $Vault)) { Fail "vault 目录不存在：$Vault" }

# 插件数据文件要在 —— 值守进程靠它拿 storagePath 与信任表；不在说明 vault 选错了
$pluginData = Join-Path $Vault '.obsidian\plugins\bz\data.json'
if (-not (Test-Path -LiteralPath $pluginData)) {
  Write-Host "! 没找到 $pluginData" -ForegroundColor Yellow
  Write-Host '  （bz 插件没在这个库里启用过？值守进程会读不到 storagePath 与信任表）' -ForegroundColor DarkGray
}

# ---------- 3. 写配置（按 vault 分家） ----------

<#
为什么要分目录：一台机器上常常有多个 vault。早前所有状态都写在同一层
（`%LOCALAPPDATA%\bz-dock-watch\config.json`），第二个库装值守时直接把第一个的配置盖掉 ——
先装的那个库从此再没被值守过，而两边界面都显示「已启用」。一个进程只能服务一个库（规则表、
账本都在库里），所以正确形状是：每个库各有一份状态目录，根上放一个「当前服务谁」的指针。

目录键必须与 tools/dock-watch/runtime.js 的 vaultKeyOf、src/dock/watchdog-status.ts 算出
同一个值（FNV-1a 32 位，取 UTF-8 字节）。三处由 tests/dock/watchdog-path.test.ts 钉住。
#>
function Get-VaultKey([string]$path) {
  $norm = ($path.Trim() -replace '\\', '/') -replace '/+$', ''
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($norm)
  $h = [uint64]2166136261
  foreach ($b in $bytes) {
    $h = $h -bxor [uint64]$b
    # 必须用 decimal 乘：PowerShell 的整数乘法会溢出成负数（UInt64 -band 当场抛错），
    # 而 [uint64] 在本机实测直接报「值对于 UInt64 太大或太小」。decimal 有 96 位尾数，
    # 4.29e9 × 1.68e7 = 7.2e16 完全精确，取模后再转回 uint64。
    $h = [uint64](([decimal]$h * [decimal]16777619) % [decimal]4294967296)
  }
  return ('{0:x8}' -f $h)
}

$root = Join-Path $env:LOCALAPPDATA 'bz-dock-watch'
$vaultKey = Get-VaultKey $Vault
$dir = Join-Path (Join-Path $root 'vaults') $vaultKey
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# 之前服务的是别的库？说清楚（不阻止切换，但别让人以为两个库都在跑）
$activePath = Join-Path $root 'active.json'
$prevVault = ''
if (Test-Path -LiteralPath $activePath) {
  try {
    $prev = Get-Content -LiteralPath $activePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prev.vault) { $prevVault = ([string]$prev.vault).TrimEnd('\', '/') }
  } catch { $prevVault = '' }
}
if ($prevVault -and $prevVault -ne $Vault) {
  Write-Host "! 值守现在改为服务这个库：$Vault" -ForegroundColor Yellow
  Write-Host "  之前服务的是：$prevVault" -ForegroundColor Yellow
  Write-Host '  一台机器同时只跑一个值守进程，所以那个库的定时任务之后不再执行（它的配置与日志都留着，' -ForegroundColor DarkGray
  Write-Host '  再在那边点一次启用就切回去）。' -ForegroundColor DarkGray
}

$configPath = Join-Path $dir 'config.json'
$config = [ordered]@{
  # 契约版本，与 runtime.js 的 CONTRACT_VERSION 对齐（2 = 判据核心独立成 dock-core.cjs）
  v             = 2
  vault         = $Vault
  intervalMs    = [int]($IntervalSeconds * 1000)
  conditionMs   = [int]$ConditionMs
  installedBy   = 'install.ps1'
  installedAt   = (Get-Date).ToString('s')
}
# **UTF-8 无 BOM**：PowerShell 5.1 的 `-Encoding UTF8` 会带 BOM，而 BOM 会让 JSON.parse 当场失败
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8NoBom)
Write-Host "✓ 配置：$configPath"

# 「当前服务谁」的指针（runtime.js 的 readConfig 先读它）
$active = [ordered]@{ vault = $Vault; key = $vaultKey; at = (Get-Date).ToString('s') }
[System.IO.File]::WriteAllText($activePath, ($active | ConvertTo-Json), $utf8NoBom)

# 老形态的根配置留着会让「到底读哪份」变成两个真相，删掉（内容已写进 per-vault 那份）
$legacyConfig = Join-Path $root 'config.json'
if (Test-Path -LiteralPath $legacyConfig) {
  Remove-Item -LiteralPath $legacyConfig -Force
  Write-Host "✓ 已把老配置迁到本库目录并删除根上的 config.json"
}

# ---------- 4. 生成隐藏窗口启动器 ----------

$cliPath = Join-Path $PSScriptRoot 'cli.js'
if (-not (Test-Path -LiteralPath $cliPath)) { Fail "找不到 cli.js（本脚本要和它同目录）：$cliPath" }

$vbsPath = Join-Path $dir 'watch.vbs'
$vbsTemplate = @'
' 由 install.ps1 生成 —— 隐藏窗口启动值守进程（node 是控制台程序，直接挂计划任务会闪黑框）
' 守卫（2026-10-28）：插件卸载后这个自启项不会自己消失（计划任务归系统管，不归插件管）。
' 没有守卫的话，每次登录都会拉起一个立刻失败的进程，wscript 还会弹错误框 —— 卸载插件的人
' 从此每开机被骂一次。这里先确认 node 与入口脚本都还在，不在就静默退出。
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists("{0}") Then WScript.Quit 0
If Not fso.FileExists("{1}") Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
cmd = """" & "{0}" & """ """ & "{1}" & """"
' 0 = 隐藏窗口，False = 不等待它结束
sh.Run cmd, 0, False
'@
$vbs = $vbsTemplate -f $Node, $cliPath
# 用系统 ANSI（中文 Windows 上就是 GBK）：wscript 读 .vbs 时按代码页解释，
# 写成 UTF-8 反而会让含中文的路径（用户名/库名）变乱码
[System.IO.File]::WriteAllText($vbsPath, $vbs, [System.Text.Encoding]::Default)
Write-Host "✓ 启动器：$vbsPath"

# ---------- 5. 注册计划任务 ----------

if ($NoTask) {
  Write-Host '· 跳过了自启动注册（-NoTask）' -ForegroundColor DarkGray
} else {
  # 首选：计划任务（看得见、可 Start/Stop、失败重试 3 次）
  try {
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -RestartCount 3 `
      -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
      -Description 'bz 工具坞值守：Obsidian 关着时按同一份规则表跑外部工具（判据复用插件的 ruleDue）' `
      -Force -ErrorAction Stop | Out-Null
    Write-Host "✓ 计划任务：$TaskName（登录时启动，隐藏窗口，失败重试 3 次）"
    $script:taskOk = $true

    # 上一次安装若回退过「启动」文件夹，那条现在必须清掉：否则登录时
    # 计划任务和启动文件夹各拉起一个值守，两个 node 常驻、日志互相盖。
    $staleVbs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\$TaskName.vbs"
    if (Test-Path -LiteralPath $staleVbs) {
      Remove-Item -LiteralPath $staleVbs -Force
      Write-Host "✓ 已清掉上一次回退留下的启动文件夹条目：$staleVbs"
    }
  } catch {
    Write-Host "! 注册计划任务失败：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host '  常见原因：当前不是管理员（Register-ScheduledTask 要提升的权限）。改用「启动」文件夹。' -ForegroundColor DarkGray
    $script:taskOk = $false
  }

  # 回退：启动文件夹（标准用户可写，同样是登录自启）
  if (-not $script:taskOk) {
    $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    New-Item -ItemType Directory -Force -Path $startup | Out-Null
    $startupVbs = Join-Path $startup "$TaskName.vbs"
    Copy-Item -LiteralPath $vbsPath -Destination $startupVbs -Force
    Write-Host "✓ 启动文件夹：$startupVbs"
    Write-Host '  （登录即启动，隐藏窗口。卸载时 uninstall.ps1 会一并清掉）' -ForegroundColor DarkGray
  }
}

if (-not $NoStart) {
  if ($NoTask) {
    Write-Host '· 直接起一次（前台验证）：' -ForegroundColor DarkGray
    & $Node $cliPath --once
  } elseif ($script:taskOk) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host '✓ 已起一次。看它认不认得你的规则表：' -ForegroundColor Green
    Write-Host "  & `"$Node`" `"$cliPath`" --status"
  } else {
    # 没有计划任务可 Start：直接用 node 起一个隐藏窗口的常驻进程
    Start-Process -FilePath $Node -ArgumentList "`"$cliPath`"" -WindowStyle Hidden
    Write-Host '✓ 已起一次（隐藏窗口的常驻进程）。看它认不认得你的规则表：' -ForegroundColor Green
    Write-Host "  & `"$Node`" `"$cliPath`" --status"
  }
}

Write-Host ''
Write-Host '完成。接下来：' -ForegroundColor Cyan
Write-Host "· 状态：  & `"$Node`" `"$cliPath`" --status"
Write-Host "· 日志：  $dir\logs\watch.log"
Write-Host '· 关掉它： 在 Obsidian 里「设置 → 工具坞 → 自动运行 → 离线值守」关掉开关（不用卸载）'
Write-Host '· 卸干净：powershell -ExecutionPolicy Bypass -File uninstall.ps1'
