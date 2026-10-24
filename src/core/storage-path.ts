/**
 * `storagePath` 的解析口径 —— **零依赖**，所以插件进程之外的东西（值守）也能用同一份。
 *
 * 为什么要单独一个文件：`core/storage.ts` 那条链要 `getApp()` 与插件设置，值守进程拿不到。
 * 但「`CONFIG/STORAGE` 是缺省」「误配成 `.json` 时剥到尾段」这两条规则必须是同一个答案 ——
 * 否则插件算出的登记表路径与值守算出的不是同一个文件，症状是「面板里有工具，值守说一个都没有」。
 */

/** 共享数据目录缺省值（storagePath 未设/空/剥空时回退） */
export const DEFAULT_STORAGE_DIR = 'CONFIG/STORAGE';

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
