/* ============================================================
 * bz · 环境自检（core/env-check.ts）
 *
 * 对外分发前最要紧的一件事：**别人机器上到底缺什么**，要能一次说清楚。
 * 此前这些信息散在五个地方——Node 在终端里、插件目录在文件管理器里、Python 在 AI 页的
 * 三行路径设置里、工具装没装在面板的报错里、vault 路径谁也看不见。
 *
 * 这里只做「测 + 说」，不做任何修复动作：每一项给出通过/不通过和一句人话，
 * 该去哪补写在 value 里。**不联网**（网络问题用在线资源组的「检查更新」自己撞一次更直观）。
 *
 * 三条检查口径：
 *  - **可写**要真写一次再删掉：`exists()` 通过不代表能写（只读盘、iCloud 占位、权限位）。
 *  - **移动端**不报错，如实说「这一项在手机上不适用」——手机端能装是 manifest 决定的，
 *    但一半功能依赖桌面端 Node，这个事实必须让人看到，而不是让人在报错里自己猜。
 *  - **不把「没配」当「坏了」**：Python / ffmpeg 是可选项，没配只提示，不计红。
 * ============================================================ */
import { openFlowDialog } from './flow-dialog';
import { isMobileEnv } from './mobile';
import { probeNodeRuntime, pluginDirOf, runtimeDiagnostics, vaultBasePathOf } from './tool-runtime';

/** 一行检查结果 */
export interface EnvCheckRow {
  key: string;
  value: string;
  /** true = 正常；false = 需要处理；null = 不适用/仅提示（不计红） */
  ok: boolean | null;
}

/** 真写一次再删掉（`exists()` 不代表可写：只读盘、占位文件、权限位都能骗过它） */
async function canWrite(app: unknown, relPath: string): Promise<boolean> {
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

/** 跑一遍全部检查（纯读 + 一次写探针；不联网） */
export async function environmentCheck(app: unknown): Promise<EnvCheckRow[]> {
  const rows: EnvCheckRow[] = [];
  const mobile = isMobileEnv();
  const base = vaultBasePathOf(app);
  const pluginDir = pluginDirOf(app);

  rows.push({
    key: '运行环境',
    value: mobile ? '移动端（部分功能需要桌面端 Obsidian）' : '桌面端',
    ok: mobile ? null : true,
  });

  rows.push({
    key: 'vault 路径',
    value: base || '取不到（插件可能不在桌面端运行）',
    ok: base ? true : null,
  });

  if (!mobile) {
    // 插件目录在 vault 内的相对位置（configDir 可能不是 .obsidian）——自更新要写它，
    // 所以「可写」是自更新能不能工作的前提，值得单列一行。
    const configDir = String((app as { vault?: { configDir?: string } }).vault?.configDir || '.obsidian');
    const pluginRel = `${configDir}/plugins/bz`;
    const pluginWritable = await canWrite(app, pluginRel);
    rows.push({
      key: '插件目录可写',
      value: pluginWritable ? pluginDir || pluginRel : `${pluginDir || pluginRel}（写不进去：自更新与资源下载都会失败）`,
      ok: pluginWritable,
    });
  }

  const storeDir = await storageDirOf();
  const storeOk = await canWrite(app, storeDir);
  rows.push({
    key: '数据目录可写',
    // 数据目录是 vault 相对路径 —— 别人拿到 vault 时它可能只读、可能被同步盘占位
    value: storeOk ? storeDir : `${storeDir}（写不进去：检查是否只读 / 被同步盘占用）`,
    ok: storeOk ? true : false,
  });

  if (!mobile) {
    const node = probeNodeRuntime(app, { fresh: true });
    rows.push({
      key: 'Node 运行时',
      value:
        node.kind === 'none'
          ? '未找到（B站下载器、值守、脸谱都靠它跑）'
          : `${node.kind === 'bundled' ? '插件内' : '系统'}${node.version ? ` ${node.version}` : ''}`,
      ok: node.kind === 'none' ? false : true,
    });
    // 三个工具的状态由 runtimeDiagnostics 统一给（与面板同一口径）
    for (const r of runtimeDiagnostics(app).slice(2)) {
      const notInstalled = r.value === '未安装';
      rows.push({ key: r.key, value: r.value, ok: notInstalled ? null : true });
    }
  }

  return rows;
}

/** 面板上的「环境自检」按钮 → 一次性把结果摊开（多行文本，界面上就是一张清单） */
export async function openEnvironmentCheck(app: unknown): Promise<void> {
  const rows = await environmentCheck(app);
  const mark = (ok: boolean | null): string => (ok === true ? '✓' : ok === false ? '✗' : '·');
  const bad = rows.filter((r) => r.ok === false).length;
  const body = rows.map((r) => `${mark(r.ok)} ${r.key}：${r.value}`).join('\n');
  await openFlowDialog({
    title: bad > 0 ? `环境自检：${bad} 项要处理` : '环境自检：全部通过',
    message: body,
    actions: [{ label: '知道了', value: 'ok', cta: true }],
  });
}
