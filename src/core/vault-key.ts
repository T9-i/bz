/* ============================================================
 * bz · vault 目录键（core/vault-key.ts）
 *
 * 一台机器上可以有多个 vault，而**一个值守进程只能服务一个**（规则表、账本都在库里）。
 * 值守的本机会话态（`%LOCALAPPDATA%\bz-dock-watch\`）因此要按库分目录，否则第二个库装
 * 值守时会把第一个库的配置盖掉 —— 先装的那个库从此静默地不再被值守，而两边界面都说「正常」。
 *
 * 目录名用**哈希**而不是路径片段：Windows 路径里的 `\ : * ? " < > |` 与长度都不适合当目录名。
 * 算法是 FNV-1a 32 位（8 位十六进制）—— 够短、够稳、三处语言都能十行内写出来。
 *
 * ⚠️ 三处实现必须算出同一个值：
 *   - 这里（插件侧）
 *   - `tools/dock-watch/runtime.js` 的 `vaultKeyOf`
 *   - `tools/dock-watch/install.ps1` 的 `Get-VaultKey`
 * 由 `tests/dock/watchdog-path.test.ts` 钉住。算歪的症状是「值守在跑，插件说它没装过」，
 * 而且没有任何报错提示你 —— 这类静默错位最难查，所以宁可钉一条测试。
 * ============================================================ */

/** 路径归一：去空白、反斜杠转正斜杠、去尾斜杠（三处实现逐字一致） */
export function normalizeVaultPath(vault: string): string {
  return String(vault || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

/** vault 绝对路径 → 8 位十六进制目录键（空路径 → 空串） */
export function vaultKeyOf(vault: string): string {
  const text = normalizeVaultPath(vault);
  if (!text) return '';
  let h = 0x811c9dc5;
  // TextEncoder 在 Electron 渲染进程与 Node 18+ 都有（Obsidian 桌面端满足）
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
