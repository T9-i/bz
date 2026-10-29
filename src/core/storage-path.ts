/**
 * `storagePath` 的解析口径 —— **零依赖**，所以插件进程之外的东西（值守）也能用同一份。
 *
 * 为什么要单独一个文件：`core/storage.ts` 那条链要 `getApp()` 与插件设置，值守进程拿不到。
 * 但「缺省目录是什么」「误配成 `.json` 时剥到尾段」这两条规则必须是同一个答案 ——
 * 否则插件算出的登记表路径与值守算出的不是同一个文件，症状是「面板里有工具，值守说一个都没有」。
 *
 * ---------- 2026-10-29：缺省目录 = `<插件目录>/storage`（小写） ----------
 *
 * 缺省值只服务**还没设过 storagePath 的库**，也就是新装用户在引导页里看到的那份初值
 * （引导的「存放」一步允许改，改了就按他填的落）。data.json 里已经有值的库一律不动：
 * 哪怕值是插件早期自己写进去的老 `CONFIG/STORAGE`，那也是库里数据的实际位置，改它等于搬家。
 *
 * 盘上残留的老 `CONFIG/STORAGE` **不认领**：没有 storagePath 就是没设过，
 * 一律落到新缺省。那里面就算有文件也是历史遗留，凭目录名去猜「这库想用老位置」
 * 只会让 CONFIG 这个目录在界面上继续出现——用户明确不要它。
 *
 * 常量里那个 `.obsidian/plugins/bz` 只是「谁都没说」时的答案：真正落盘时调用方都传
 * `initialStorageDir(pluginRelDirOf(app))`，插件文件夹叫什么就落在哪。
 */

/** 缺省数据目录（vault 相对）：`<插件目录>/storage`。没有 app 可问的地方拿它兜底 */
export const DEFAULT_STORAGE_DIR = '.obsidian/plugins/bz/storage';

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
 * 已经是显式值的一律原样透传（老 `CONFIG/STORAGE` 也一样）：那是库里数据的真实位置，
 * 在这里偷偷改写只会让「路径显示一处、文件在另一处」。
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
