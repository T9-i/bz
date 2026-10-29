/* ============================================================
 * bz · 外部工具未安装时的引导文案（core/tool-hint.ts）
 *
 * 为什么单独一个文件：它得让**两侧**共用而保持零依赖。
 *
 *   - `core/tool-runtime.ts` 要用（工具没下载时给人指路）；
 *   - `core/external-tool.ts` 也要用（拦到空命令时说同一句话）。
 *
 * 但 external-tool 会被**值守进程**打包进去（`scripts/build-dock-watch.mjs` 从
 * `src/dock/watch-core.ts` 起，一个 external 都没配），而 tool-runtime 顺着
 * `remote-asset` / `node-runtime-install` 拖进 `obsidian` —— 值守是个纯 node 进程，
 * 一旦被拖进 'obsidian' 就构建不出来。所以文案留在这里，谁也不欠谁。
 *
 * 文案口径（ADR-0264 / ADR-0268）：**指向用户真能点的地方**，不是一条终端命令。
 * ============================================================ */

/** 外部工具在设置面板里的位置（引导语的唯一出处）。
 *  2026-10-28 起工具单独成组：「在线资源」只放文档与皮肤，三个目录包住在「外部工具」里。 */
export const TOOL_SETTINGS_HINT = '「设置 → 通用 → 外部工具」';

/** 「未找到 X：到 … 里下载它，下载完即可用」——label 传工具名，或不传（通用版） */
export function toolMissingHint(label = '外部工具'): string {
  return `未找到${label}：到${TOOL_SETTINGS_HINT}里下载它，下载完即可用`;
}
