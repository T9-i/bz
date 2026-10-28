/* ============================================================
 * bz · 插件安装目录解析（core/plugin-path.ts）
 *
 * 一切「把文件写到插件目录」的事（在线资源 downloads/、便携 Node、目录包解包、
 * 自更新三件套）都以本模块为**唯一口径**。
 *
 * 为什么不能写死 `${configDir}/plugins/bz`：插件目录名**由用户决定**。
 *   - 手动装的：文件夹可能叫 `bz`，也可能叫 `包仔`、`bz-test`、`bz (1)`；
 *   - BRAT / 插件商店装的：一定是 `<configDir>/plugins/bz`。
 * 写死 `bz` 的后果不是报错，是**静默错位**：文件写进一个不存在/不该写的目录，
 * 或者读不到自己明明已经下好的资源——表现为「下载成功但功能不可用」，最难查。
 *
 * 三层来源，优先级从高到低：
 *   1. `setPluginRelDir()` 注入的**运行中真实目录**（main.ts onload 传 `this.manifest.dir`，
 *      Obsidian 自己记录的、当前加载的那份插件的相对路径）；
 *   2. `app.plugins.manifests.bz.dir`（Obsidian 的插件清单里记着同一个值，做备份来源）；
 *   3. `<configDir>/plugins/bz`（商店标准位置兜底；`configDir` 也可能是自定义的）。
 *
 * 拿到的永远是 **vault 相对路径**；转绝对路径统一走 `pluginDirOf()`（spawn 与 fs 才需要）。
 * ============================================================ */

/** 注入的插件相对目录（vault 相对，如 `.obsidian/plugins/bz`）；空 = 还没注入 */
let injectedRelDir = '';

function trimSlashes(p: string): string {
  return String(p || '').replace(/^[\\/]+|[\\/]+$/g, '');
}

/**
 * 注入运行中插件的相对目录（main.ts onload 调用一次）。
 * 传空/非串 = 回到自动解析（测试与早期调用都能跑）。
 */
export function setPluginRelDir(rel: string | null | undefined): void {
  injectedRelDir = trimSlashes(String(rel || ''));
}

/** 当前注入值（诊断用；空串 = 未注入，走了自动解析） */
export function injectedPluginRelDir(): string {
  return injectedRelDir;
}

/** 插件相对目录（vault 相对）；三层来源见文件头 */
export function pluginRelDirOf(app: unknown): string {
  if (injectedRelDir) return injectedRelDir;
  const fromManifests = trimSlashes(
    String((app as { plugins?: { manifests?: Record<string, { dir?: string }> } })?.plugins?.manifests?.bz?.dir || ''),
  );
  if (fromManifests) return fromManifests;
  const configDir = trimSlashes(String((app as { vault?: { configDir?: string } })?.vault?.configDir || '.obsidian'));
  return `${configDir || '.obsidian'}/plugins/bz`;
}

/** vault 根的文件系统绝对路径（adapter 提供；拿不到 → 空串） */
export function vaultBasePathOf(app: unknown): string {
  const adapter = (app as { vault?: { adapter?: { getBasePath?: () => string; basePath?: string } } })?.vault?.adapter;
  try {
    const p = adapter?.getBasePath?.() || adapter?.basePath || '';
    return trimSlashes(String(p || ''));
  } catch {
    return '';
  }
}

/** 插件安装目录的**绝对**路径（spawn / fs / chmod 用）；vault 根拿不到 → 空串 */
export function pluginDirOf(app: unknown): string {
  const base = vaultBasePathOf(app);
  if (!base) return '';
  return `${base}/${pluginRelDirOf(app)}`;
}

/** 插件目录内的文件（vault 相对路径；写盘/读盘走 adapter 时用这个） */
export function pluginVaultPath(app: unknown, rel: string): string {
  const dir = pluginRelDirOf(app);
  return `${dir}/${trimSlashes(rel)}`;
}
