/**
 * `storagePath` 的解析口径 —— **零依赖**，所以插件进程之外的东西（值守）也能用同一份。
 *
 * 为什么要单独一个文件：`core/storage.ts` 那条链要 `getApp()` 与插件设置，值守进程拿不到。
 * 但「缺省目录是什么」「误配成 `.json` 时剥到尾段」这两条规则必须是同一个答案 ——
 * 否则插件算出的登记表路径与值守算出的不是同一个文件，症状是「面板里有工具，值守说一个都没有」。
 *
 * ---------- 2026-10-29：新库的初值改成 `<插件目录>/storage`（小写） ----------
 *
 * 为什么是「初值」而不是「缺省」：`normalizeStorageDir` 的兜底必须是一个**常量**
 * （值守进程、纯函数单测、极早期调用都在没有 app 的地方调它）。所以这里保留
 * `CONFIG/STORAGE` 作兜底，另给一个 `initialStorageDir()`：插件首次启动时把
 * `<插件目录>/storage` **显式写进** data.json（`core/storage.bootstrapStorageDir`），
 * 之后一切照旧走显式值。老库（盘上已有 `CONFIG/STORAGE`）在那一刻被认领成显式值，
 * 升级后不会出现「数据全空」。
 */

/** 老的缺省目录（也是归一函数的兜底常量）：既有库里数据都在这儿，不再作为新库的初值 */
export const DEFAULT_STORAGE_DIR = 'CONFIG/STORAGE';

/** 新库数据目录的末段名（小写：与旧的 `CONFIG/STORAGE` 刻意区分开） */
export const STORAGE_DIR_NAME = 'storage';

/** 插件目录名的兜底（用户把插件文件夹改了名时只有真目录算数；这里只是「谁都没说」时的答案） */
const FALLBACK_PLUGIN_REL_DIR = '.obsidian/plugins/bz';

/**
 * 新库的初值：`<插件目录>/storage`（vault 相对，`/` 分隔、无尾斜杠）。
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
 * trim 去尾斜杠；误配 .json 尾段剥到所在目录；剥空/未设回退 CONFIG/STORAGE。
 */
export function normalizeStorageDir(value?: string): string {
  let dir = (value || DEFAULT_STORAGE_DIR).trim().replace(/\\/g, '/').replace(/\/+$/, '');
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
