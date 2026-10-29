/**
 * `storagePath` 的解析口径 —— **零依赖**，所以插件进程之外的东西（值守）也能用同一份。
 *
 * 为什么要单独一个文件：`core/storage.ts` 那条链要 `getApp()` 与插件设置，值守进程拿不到。
 * 但「缺省目录是什么」「误配成 `.json` 时剥到尾段」这两条规则必须是同一个答案 ——
 * 否则插件算出的登记表路径与值守算出的不是同一个文件，症状是「面板里有工具，值守说一个都没有」。
 *
 * ---------- 2026-10-29：缺省目录 = `<插件目录>/storage`（小写） ----------
 *
 * 老口径是 vault 根的 `CONFIG/STORAGE`：那是**插件早期自己写进 data.json 的默认值**，
 * 不是用户选的。它在磁盘上留了一个跟笔记混在一起的 CONFIG 目录，也让「数据跟着插件走」
 * 这件事落空。现在这个值只作为**迁移来源**存在（`LEGACY_STORAGE_DIR`），
 * 不再出现在任何缺省路径上：`core/storage.bootstrapStorageDir` 启动时把它改成 `<插件目录>/storage`
 * （老目录里的数据先复制过去，不删原目录）。
 *
 * 常量里那个 `.obsidian/plugins/bz` 只是「谁都没说」时的答案：真正落盘时调用方都传
 * `initialStorageDir(pluginRelDirOf(app))`，插件文件夹叫什么就落在哪。
 */

/** 缺省数据目录（vault 相对）：`<插件目录>/storage`。没有 app 可问的地方拿它兜底 */
export const DEFAULT_STORAGE_DIR = '.obsidian/plugins/bz/storage';

/**
 * 旧缺省（vault 根 `CONFIG/STORAGE`）。**只用于迁移**：盘上有、且设置里正好是这个值，
 * 启动时复制到 `<插件目录>/storage` 并把设置改过去。别在任何路径计算里用它。
 */
export const LEGACY_STORAGE_DIR = 'CONFIG/STORAGE';

/** 数据目录的末段名（小写） */
export const STORAGE_DIR_NAME = 'storage';

/** 插件目录名的兜底（用户把插件文件夹改了名时只有真目录算数；这里只是「谁都没说」时的答案） */
const FALLBACK_PLUGIN_REL_DIR = '.obsidian/plugins/bz';

/**
 * 缺省数据目录的现算版本：`<插件目录>/storage`（vault 相对，`/` 分隔、无尾斜杠）。
 *
 * 插件目录名由用户决定（`bz` / `包仔` / `bz-test` 都可能），所以现算——
 * 调用方传 `pluginRelDirOf(app)`，不传才落到 `.obsidian/plugins/bz/storage`。
 */
export function initialStorageDir(pluginRelDir?: string): string {
  const base = String(pluginRelDir || FALLBACK_PLUGIN_REL_DIR)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return `${base || FALLBACK_PLUGIN_REL_DIR}/${STORAGE_DIR_NAME}`;
}

/**
 * 共享数据目录归一（纯函数，storagePath 解析唯一入口）：
 * trim 去尾斜杠；误配 .json 尾段剥到所在目录；剥空/未设回退缺省目录。
 *
 * 旧的 `CONFIG/STORAGE` **原样透传**：那是升级上来的库的真实数据位置，
 * 在这里偷偷改写只会让「路径显示一处、文件在另一处」。改路径是 bootstrap 的事（带数据迁移）。
 */
export function normalizeStorageDir(value?: string): string {
  let dir = (value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (/\.json$/i.test(dir)) {
    const idx = dir.lastIndexOf('/');
    dir = idx >= 0 ? dir.slice(0, idx) : '';
  }
  return dir || DEFAULT_STORAGE_DIR;
}

/** 数据目录下的某个文件（相对 vault 根，`/` 分隔） */
export function storageFileIn(dir: string, name: string): string {
  return `${normalizeStorageDir(dir).replace(/\/+$/, '')}/${name}`;
}
