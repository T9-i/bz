/* ============================================================
 * bz · 环境探测（core/env-check.ts）
 *
 * 只做「测 + 说」，不碰 UI、不写盘（唯一的写是一次性写探针文件验证可写性）。
 * 视图在 core/setup-wizard.ts（首次引导与「环境自检」共用同一套行渲染）。
 *
 * 每条结果带一个 `fix`：告诉界面「这一项缺了该拿什么补」——
 *   node   → 下便携 Node 运行时
 *   tools  → 下外部工具目录包（B站下载器 / 值守 / 脸谱外壳）
 *   docs   → 下文档与大索引（手册/更新日志/分类表/RSS/豆瓣索引）
 *   ai     → 去设置里填密钥（不是下载）
 * 界面按 fix 决定按钮，不靠关键词猜。
 *
 * 三条口径（沿用前版）：
 *  - **可写**要真写一次再删掉：`exists()` 通过不代表能写（只读盘、iCloud 占位、权限位）。
 *  - **移动端**不报错，如实说「这一项在手机上不适用」。
 *  - **不把「没配」当「坏了」**：AI 密钥是可选项，只提示，不计红。
 * ============================================================ */
import { REPO_BASES } from './remote-base';
import { tryGetSettings } from './settings-provider';
import { pluginRelDirOf } from './plugin-path';
import { isMobileEnv } from './mobile';
import { probeNodeRuntime, runtimeDiagnostics, vaultBasePathOf } from './tool-runtime';

/** 缺项的可补方式（见文件头） */
export type EnvFix = 'node' | 'tools' | 'docs' | 'ai';

/** 一行检查结果 */
export interface EnvCheckRow {
  /** 稳定 id（重检后按 id 就地更新，不整表重建） */
  id: string;
  key: string;
  value: string;
  /** true = 正常；false = 需要处理；null = 不适用/仅提示（不计红） */
  ok: boolean | null;
  /** 缺了怎么补；null/undefined = 只展示 */
  fix?: EnvFix | null;
}

/** 网络探测结果（第一屏第一件事就是它：不通的话后面全是白忙） */
export interface NetworkProbe {
  /** GitHub raw 是否可达（主通道） */
  github: boolean;
  /** jsDelivr 是否可达（备用通道） */
  jsdelivr: boolean;
  /** 主通道耗时（ms；不可达 = -1） */
  githubMs: number;
  /** 备用通道耗时（ms；不可达 = -1） */
  jsdelivrMs: number;
}

/** 单次探测的超时（requestUrl 没有 abort，用 race 兜住；超时按不可达算） */
const PROBE_TIMEOUT_MS = 6000;

/** 拉一个小文件试通道（`downloads/version.json`，46 字节，代价可忽略） */
async function timedFetch(url: string): Promise<number> {
  const t0 = Date.now();
  const ok = await Promise.race([
    (async () => {
      try {
        const { requestUrl } = await import('obsidian');
        await requestUrl({ url, method: 'GET', throw: true });
        return true;
      } catch {
        return false;
      }
    })(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)),
  ]);
  return ok ? Date.now() - t0 : -1;
}

/**
 * 探两条通道（并发）。**不抛错**：两条都不通也是一种正常结果，
 * 界面据此给出「检查代理/VPN」的说明而不是一个异常。
 */
export async function probeNetwork(): Promise<NetworkProbe> {
  // 全通道并发探（raw + jsDelivr 的四个边缘域名）。逐个串行探会让「两条都不通」的结论
  // 慢三倍，而这一步是首次引导的第一屏——等不起。
  const urls = REPO_BASES.map((b) => `${b}/downloads/version.json`);
  const results = await Promise.all(urls.map((u) => timedFetch(u)));
  const raw = results[0] ?? -1;
  // jsDelivr 一侧取**最快**的那个入口（国内实测 cdn 不通、fastly/gcore/testingcf 通）
  const cdn = results.slice(1).filter((ms) => ms >= 0);
  const cdnMs = cdn.length ? Math.min(...cdn) : -1;
  return { github: raw >= 0, jsdelivr: cdnMs >= 0, githubMs: raw, jsdelivrMs: cdnMs };
}

/**
 * 真写一次再删掉（`exists()` 不代表可写：只读盘、占位文件、权限位都能骗过它）。
 * 导出给首次引导的「存放位置」一屏用——用户改完路径当场验，不合格就不许往下走。
 */
export async function probeWritableDir(app: unknown, relPath: string): Promise<boolean> {
  const adapter = (app as {
    vault?: {
      adapter?: {
        write?: (p: string, d: string) => Promise<void>;
        remove?: (p: string) => Promise<void>;
        mkdir?: (p: string) => Promise<void>;
      };
    };
  }).vault?.adapter;
  if (!adapter?.write) return false;
  const dir = relPath.replace(/\/+$/, '');
  // 目录可能还不存在（首次运行，数据目录尚未建）——逐级建一遍再写探针，
  // 否则「还没建」会被误报成「不可写」，那是两件完全不同的事。
  let cur = '';
  for (const part of dir.split('/').filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      await adapter.mkdir?.(cur);
    } catch {
      /* 已存在 */
    }
  }
  const probe = `${dir}/.bz-write-probe`;
  try {
    await adapter.write(probe, 'ok');
    await adapter.remove?.(probe);
    return true;
  } catch {
    return false;
  }
}

/** 读设置里的数据目录（不 import 域，只读 provider） */
async function storageDirOf(): Promise<string> {
  try {
    const { tryGetSettings } = await import('./settings-provider');
    const { normalizeStorageDir } = await import('./storage-path');
    return normalizeStorageDir(tryGetSettings()?.storagePath);
  } catch {
    return 'CONFIG/STORAGE';
  }
}

/**
 * 找 Python（脸谱导入微信记录要用）。
 *
 * **只探测、不安装**：脸谱的依赖是 funasr/torch 这一档（pip 装下来 GB 级，还要 ffmpeg 与
 * 模型文件），自动装等于替用户下一个几 GB 的包再赌网络——这种事不能藏在「一键」后面。
 * 所以这一行永远不判红，只如实说「有没有」。
 *
 * 一个必须避开的坑：Windows 10/11 的 `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`
 * 是**应用商店别名占位符**，每台机器都有、跑起来什么都不做（要么弹商店，要么直接退出）。
 * 只看 `where python` 会把它当成「已装 Python」，等脸谱真跑起来才报一个看不懂的错。
 * 所以拿到路径后必须真跑一次 `-V`，认输出里的版本号。
 */
export function isRealPythonOutput(out: string): boolean {
  return /Python\s+3\.\d+/i.test(String(out || ''));
}

function pythonProbe(): { found: boolean; value: string } {
  const configured = String(tryGetSettings()?.pythonPath || '').trim();
  if (configured) return { found: true, value: `已配置：${configured}` };
  if (typeof window === 'undefined') return { found: false, value: '未知（非桌面端）' };
  let cp: any = null;
  try {
    cp = (window as any).require?.('child_process');
  } catch {
    cp = null;
  }
  if (!cp?.spawnSync) return { found: false, value: '未知' };

  const win = typeof process !== 'undefined' && process.platform === 'win32';
  const finder = win ? 'where' : 'which';
  for (const name of ['python', 'python3']) {
    let path = '';
    try {
      const r = cp.spawnSync(finder, [name], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
      path = String(r?.stdout || '')
        .split(String.fromCharCode(10))
        .map((x: string) => x.trim())
        .filter(Boolean)[0] || '';
    } catch {
      path = '';
    }
    if (!path) continue;
    // 真跑一次：占位符/坏装在 `where` 里也有，只有 `-V` 会说话
    try {
      const v = cp.spawnSync(path, ['-V'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      const out = `${v?.stdout || ''}${v?.stderr || ''}`;
      if (isRealPythonOutput(out)) {
        return { found: true, value: `${out.trim().split(String.fromCharCode(10))[0]}（${path}）` };
      }
    } catch {
      /* 跑不起来 = 不是真 Python，继续找下一个 */
    }
  }
  return { found: false, value: '未找到可用的 Python 3（脸谱导入微信记录时需要，其余功能不受影响）' };
}

/** 读 AI 是否已配（按当前服务商判；ollama 本地无鉴权视为已配） */
async function aiConfigured(): Promise<{ ok: boolean; value: string }> {
  try {
    const s = await import('./settings-provider').then((m) => m.tryGetSettings());
    const provider = String(s?.aiProvider || 'deepseek');
    if (provider === 'ollama') return { ok: true, value: '本地 Ollama（无需密钥）' };
    const key = provider === 'zhipu-plan' ? s?.zhipuPlanApiKey : s?.deepseekApiKey;
    return key && String(key).trim()
      ? { ok: true, value: provider === 'zhipu-plan' ? '智谱 Coding 套餐' : 'DeepSeek' }
      : { ok: false, value: '未配置（摘要、小橘等 AI 功能不可用）' };
  } catch {
    return { ok: false, value: '未配置' };
  }
}

/** 跑一遍全部检查（纯读 + 一次写探针；不联网） */
export async function environmentCheck(app: unknown): Promise<EnvCheckRow[]> {
  const rows: EnvCheckRow[] = [];
  const mobile = isMobileEnv();
  const base = vaultBasePathOf(app);

  rows.push({
    id: 'runtime',
    key: '运行环境',
    value: mobile ? '移动端（部分功能需要桌面端 Obsidian）' : '桌面端',
    ok: mobile ? null : true,
  });

  rows.push({
    id: 'vault',
    key: 'vault 路径',
    value: base || '取不到（插件可能不在桌面端运行）',
    ok: base ? true : null,
  });

  if (!mobile) {
    // 插件目录名由用户决定（core/plugin-path）——展示真实那一条，别给一个「标准路径」
    const pluginRel = pluginRelDirOf(app);
    const pluginWritable = await probeWritableDir(app, pluginRel);
    rows.push({
      id: 'plugin-writable',
      key: '插件目录可写',
      value: pluginWritable ? pluginRel : `${pluginRel}（写不进去：自更新与资源下载都会失败）`,
      ok: pluginWritable,
    });
  }

  const storeDir = await storageDirOf();
  const storeOk = await probeWritableDir(app, storeDir);
  rows.push({
    id: 'storage',
    key: '数据目录可写',
    value: storeOk ? storeDir : `${storeDir}（写不进去：检查是否只读 / 被同步盘占用）`,
    ok: storeOk,
  });

  if (!mobile) {
    const node = probeNodeRuntime(app, { fresh: true });
    rows.push({
      id: 'node',
      key: 'Node 运行时',
      value:
        node.kind === 'none'
          ? '未找到（B站下载器、值守、脸谱都靠它跑）'
          : `${node.kind === 'bundled' ? '插件内' : '系统'}${node.version ? ` ${node.version}` : ''}`,
      ok: node.kind === 'none' ? false : true,
      fix: node.kind === 'none' ? 'node' : null,
    });
    // 三个工具的状态由 runtimeDiagnostics 统一给（与面板同一口径）；前两行不是工具，跳过
    for (const r of runtimeDiagnostics(app).slice(2)) {
      const notInstalled = r.value === '未安装';
      rows.push({
        id: `tool-${r.key}`,
        key: r.key,
        value: r.value,
        ok: notInstalled ? false : true,
        fix: notInstalled ? 'tools' : null,
      });
    }
  }

  // Windows 的 MAX_PATH 是 260：脸谱包解出来的最深路径大约再叠 100 字符，
  // vault 放得太深（比如一层层套在 OneDrive\文档\项目\… 下）就会解包到一半失败，
  // 报错是 ENOENT/mkdir 失败，看不出跟「路径太长」有关。这里提前量一下。
  if (!mobile && typeof process !== 'undefined' && process.platform === 'win32') {
    const deep = `${base}/${pluginRelDirOf(app)}/downloads/tools/obsidian-face/python/funasr/models/`.length;
    if (deep > 180) {
      rows.push({
        id: 'path-length',
        key: '路径长度',
        value: `vault 路径较长（约 ${deep} 字符），Windows 260 上限下可能解包失败；建议把 vault 放到更浅的目录`,
        ok: deep < 240 ? null : false,
      });
    }
  }

  const python = pythonProbe();
  rows.push({
    id: 'python',
    key: 'Python 环境',
    value: python.value,
    ok: null, // 可选项：没装不判红，但要让人看见（脸谱导入需要）
  });

  const ai = await aiConfigured();
  rows.push({
    id: 'ai',
    key: 'AI 服务',
    value: ai.value,
    ok: ai.ok ? true : null, // 没配不算坏：主体功能不依赖它
    fix: ai.ok ? null : 'ai',
  });

  return rows;
}
