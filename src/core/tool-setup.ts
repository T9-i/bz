/* ============================================================
 * bz · 外部工具的下载后初始化（core/tool-setup.ts）
 *
 * 「下载完就能用」这句话对三个工具不是一个意思：
 *
 * | 工具 | 下载后还要做什么 | 这一层怎么处理 |
 * |---|---|---|
 * | B站下载器 | 没有。纯 Node 脚本、无依赖、无配置 | 直接算完成 |
 * | 工具坞值守 | **要注册登录自启**（计划任务），否则「Obsidian 关着也跑」不成立 | 弹确认 → 跑包里的 install.ps1 |
 * | 脸谱工具包 | Node 外壳已就位；Python 依赖（funasr / torch / pycryptodome）装不了 | 不算失败，返回一句「还差什么」 |
 *
 * 三条边界：
 *  1. **改系统状态必须经人点头**。注册计划任务/开机自启不是「下载一个文件」，它是「这台
 *     机器以后每次登录都会起一个后台进程」——静默做掉是不诚实的。所以这里先 confirm。
 *  2. **失败要说人话**。install.ps1 自己会回退到「启动」文件夹（标准用户常见），所以
 *     「计划任务注册失败」不等于「没装成」——退出码非 0 才报错。
 *  3. **Python 依赖不能假装装好了**。脸谱没有 Python 环境时，工具能起来但一转写就
 *     ModuleNotFoundError。这里如实返回提示，不弹「安装成功」。
 * ============================================================ */
import { openFlowDialog } from './flow-dialog';
import { notice } from './notice';
import { probeNodeRuntime, pluginDirOf, TOOL_ENTRIES, vaultBasePathOf, type ToolId } from './tool-runtime';
import { vaultKeyOf } from './vault-key';

/** 初始化结局：`skipped` = 无需/用户放弃；`done` = 做完；`failed` = 做了但没成 */
export type ToolSetupOutcome = 'skipped' | 'done' | 'failed';

/** 值守的本机会话态根目录（口径与 tools/dock-watch/runtime.js 的 watchdogDir() 逐字一致） */
export function watchdogDirPath(): string {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const local = String(env.LOCALAPPDATA || '').trim();
  if (local) return `${local.replace(/[\\/]+$/, '')}/bz-dock-watch`;
  const home = String(env.USERPROFILE || env.HOME || '').trim();
  if (home) return `${home.replace(/[\\/]+$/, '')}/AppData/Local/bz-dock-watch`;
  return 'bz-dock-watch';
}

/** 某个库自己的状态目录（`<root>/vaults/<key>`；空 vault → 根目录，兼容老形态） */
export function watchdogVaultDirPath(vault: string): string {
  const root = watchdogDirPath();
  const key = vaultKeyOf(vault);
  return key ? `${root}/vaults/${key}` : root;
}

/** 桌面端 fs（拿不到 → null） */
function nodeFs(): {
  readFileSync?: (p: string, enc: string) => string;
  existsSync?: (p: string) => boolean;
} | null {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  try {
    return w?.require?.('fs') ?? null;
  } catch {
    return null;
  }
}

/** 读一份 JSON（读不到 / 坏 → null） */
function readJsonAt(file: string): Record<string, unknown> | null {
  const fs = nodeFs();
  try {
    if (!fs?.readFileSync) return null;
    const raw = JSON.parse(String(fs.readFileSync(file, 'utf8'))) as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface PsResult {
  code: number | null;
  out: string;
}

/** 跑一段 PowerShell（数组参数，路径不过 cmd 解析）；起不来 → code null */
function runPowerShell(args: string[], cwd: string): Promise<PsResult> {
  return new Promise((resolve) => {
    const w = typeof window !== 'undefined' ? (window as any) : null;
    let cp: any = null;
    try {
      cp = w?.require?.('child_process');
    } catch {
      cp = null;
    }
    if (!cp?.spawn) {
      resolve({ code: null, out: '当前环境不能起外部进程（需要桌面端）' });
      return;
    }
    let out = '';
    let child: any;
    try {
      child = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: null, out: (e as Error)?.message || String(e) });
      return;
    }
    child.stdout?.on('data', (d: any) => (out += String(d)));
    child.stderr?.on('data', (d: any) => (out += String(d)));
    child.on('error', (e: Error) => resolve({ code: null, out: out || e.message }));
    child.on('close', (code: number | null) => resolve({ code, out }));
  });
}

/** 读这个库自己的值守配置（判断「已经装过了」用）；坏读/不存在 → null */
async function readWatchdogConfig(vault: string): Promise<{ vault?: string } | null> {
  const cfg = readJsonAt(`${watchdogVaultDirPath(vault)}/config.json`);
  if (cfg) return cfg as { vault?: string };
  // 老安装（还没有 vaults/ 分层）配置在根上：只在 active.json 也没有时才认，
  // 否则「服务着别的库」会被误判成「这个库已经装过」
  if (readJsonAt(`${watchdogDirPath()}/active.json`)) return null;
  return readJsonAt(`${watchdogDirPath()}/config.json`) as { vault?: string } | null;
}

/** 值守现在服务的是哪个库（读 active.json；没有 → 空串） */
export function activeWatchdogVault(): string {
  const raw = readJsonAt(`${watchdogDirPath()}/active.json`);
  return String((raw?.vault as string) || '').trim().replace(/[\\/]+$/, '');
}

/**
 * 下载后的初始化（在线资源组在 bundle 装完之后调）。
 * 只对「工具」条目有意义；非工具条目调用方不必调。
 */
export async function setupAfterInstall(app: unknown, id: ToolId): Promise<ToolSetupOutcome> {
  if (id !== 'dock-watch') {
    // B站下载器 / 脸谱：落盘即完成（脸谱的 Python 依赖在面板上另有说明，不在这里假装装好）
    return 'skipped';
  }

  const node = probeNodeRuntime(app);
  const vault = vaultBasePathOf(app);
  const dir = pluginDirOf(app);
  if (node.kind === 'none') {
    notice('值守已下载，但本机没有 Node 运行时：装好 Node.js 后再启用值守', 'warning');
    return 'failed';
  }
  if (!vault || !dir) {
    notice('值守已下载，但取不到 vault 路径：无法为它生成配置', 'warning');
    return 'failed';
  }

  // 已经装过（同一 vault）→ 不重复注册，也别再弹一次确认
  const existing = await readWatchdogConfig(vault);
  if (existing && String(existing.vault || '').replace(/[\\/]+$/, '') === vault) return 'skipped';

  // 值守正服务着**另一个**库：一台机器只跑一个值守进程，继续装等于把那个库的定时任务顶掉。
  // 不阻止（用户可能就是想要这个），但必须说清楚是「切过去」，不是「两个都跑」。
  const other = activeWatchdogVault();
  const switching = !!other && other !== vault;
  const go = await openFlowDialog({
    title: switching ? '把值守切到这个库' : '启用工具坞值守',
    message: switching
      ? `值守现在服务的是另一个库：\n${other}\n\n` +
        '一台机器同时只跑一个值守进程，继续会把它切到这个库来 —— 那个库的定时任务之后不再执行' +
        '（它的配置与日志都留着，在那边再点一次启用就切回去）。\n\n' +
        '继续吗？'
      : '值守进程会在后台按你的规则表跑工具，Obsidian 关着也照跑。\n' +
        '启用后会注册一个登录自启项（计划任务；标准用户自动回退到「启动」文件夹）。\n' +
        '不想现在启用可以点取消，之后在工具坞面板里随时再开。',
    actions: [
      { label: '取消', value: 'cancel' },
      { label: switching ? '切过来' : '启用', value: 'ok', cta: true },
    ],
  });
  if (go !== 'ok') return 'skipped';

  const script = `${dir}/downloads/tools/dock-watch/install.ps1`;
  const r = await runPowerShell(['-File', script, '-Vault', vault, '-Node', node.path], `${dir}/downloads/tools/dock-watch`);
  if (r.code === 0) {
    notice('值守已启用：登录后自动在后台运行', 'success');
    return 'done';
  }
  const tail = r.out.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 200);
  notice(`值守启用失败（退出码 ${r.code ?? '—'}）：${tail || '没有输出'}`, 'error');
  return 'failed';
}

/** 面板上的一句话状态（工具是否就绪、还差什么）——供在线资源行/工具坞面板复用 */
export function toolSetupBlurb(id: ToolId): string {
  if (id === 'dock-watch') return '下载后需启用一次（注册登录自启）';
  if (id === 'obsidian-face') return '下载后另需 Python 环境与 ffmpeg';
  return '';
}

/** 工具 id → 是否是本模块认识的运行时工具（在线资源里还有其他 bundle 时给调用方一个判据） */
export function isToolBundleId(id: string): id is ToolId {
  return Object.prototype.hasOwnProperty.call(TOOL_ENTRIES, id);
}
