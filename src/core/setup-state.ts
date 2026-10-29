/* ============================================================
 * bz · 首次引导的「走没走过」判据（core/setup-state.ts）
 *
 * 单独一个文件的原因：main.ts 要在 onLayoutReady 的**同步**流程里就知道这次要不要弹引导
 * （要弹就先弹它、且这一拍不自动打开任何 bz 页面）。判据放在 setup-wizard.ts 里的话，
 * main.ts 只能 `await import()` 才知道答案——那一等，后面的 ensure* 全被推后一拍，
 * 而「先弹引导」这件事本身也就不成立了。
 *
 * 这里只有判据与兜底键，没有任何 DOM / 探测依赖，可以随手静态导入。
 * ============================================================ */
import { vaultKeyOf } from './vault-key';

/** 「引导已走过」的本地兜底键**前缀**（设置写不进去时用它，免得每次启动都被同一张清单拦住） */
export const SETUP_DONE_FALLBACK_KEY = 'bz-setup-done';

/**
 * 兜底键要带上 vault 目录键。
 *
 * localStorage 是 Obsidian **整个应用**共用的（所有库同一个 origin），一个全局键会让
 * 「在 A 库走完引导」变成「B 库也算走完」——2026-10-28 用户报的就是这个：换一个新库打开插件，
 * 该有的首次引导一次都没弹，而那个库里 Node、工具包、文档一概没有。
 *
 * 分键之后每个库各记各的；data.json 里的 `setupDone` 本来就是按库存的，两者口径终于一致。
 */
export function setupDoneStorageKey(vault: string): string {
  const key = vaultKeyOf(vault);
  return key ? `${SETUP_DONE_FALLBACK_KEY}:${key}` : SETUP_DONE_FALLBACK_KEY;
}

/**
 * 引导是否已走过。
 *
 * @param explicitInSettings data.json **存在**（main.ts 从 loadData 的原始对象判断；不再要求里面
 *   有 setupDone 这个键）。文件存在 = 设置能写，设置就是唯一事实源。
 *
 * 三条判据的优先级不能换（2026-10-28 用户报障：手改 `"setupDone": false` 后重载仍不弹引导）：
 *  1. 设置说走过 → 走过；
 *  2. 设置写得进去（data.json 存在，无论里面有没有那个键）→ **只信设置**，不许拿 localStorage 盖掉；
 *     没有这个键、或明确写着 false（含手改重置），就是没走过。
 *  3. 设置压根写不进去（只读 vault，data.json 始终不存在）→ 才轮到兜底键。
 *
 * 兜底键只认**新格式**（`{"at":<时间戳>}`）。旧版本在引导结束时无条件写一个裸 `'1'`，
 * 后果是：删掉 data.json 想把引导重走一遍的库，第一次启动会被这把旧键静默拦住——
 * 而第一次启动恰好又把 data.json 写出来了，于是第二次反而弹了（2026-10-29 报障）。
 * 裸 `'1'` 一律当作没记过，顺手清掉。
 */
export function setupAlreadyDone(
  settings: { setupDone?: boolean } | null | undefined,
  vault = '',
  explicitInSettings = false,
): boolean {
  if (settings?.setupDone === true) return true;
  if (explicitInSettings) return false;
  try {
    const key = setupDoneStorageKey(vault);
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    if (!raw.startsWith('{')) {
      localStorage.removeItem(key); // 旧版裸 '1'：不可信，删掉
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
