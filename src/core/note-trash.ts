/**
 * 笔记删除唯一入口（ADR-0245）。
 *
 * 一律移入 **vault 内的 Obsidian 回收站**（设置「文件与链接 → 删除文件」里的 Obsidian 回收站，
 * 默认目录 `.trash`），**不走系统回收站、更不硬删**：Windows 回收站里混着整机所有删除，
 * 用户找不到，也不随库同步；bz 的删除应当「在库里就能翻回来」。
 *
 * 注意 Obsidian API 这个布尔是反直觉的：`vault.trash(file, true)` = **系统**回收站，
 * `false` = **库内**回收站。历史实现全仓按 `true` 写、测试夹具（tests/mock-vault.ts）
 * 也按反语义打桩，于是线上一直落系统回收站、测试却是绿的（2026-10-19 发现）。
 * 删除笔记只许经本函数，别再在域里直接手写 `vault.trash` / `vault.delete`。
 */
import type { App, TAbstractFile } from 'obsidian';

export async function trashNote(app: App, file: TAbstractFile): Promise<void> {
  await app.vault.trash(file, false);
}
