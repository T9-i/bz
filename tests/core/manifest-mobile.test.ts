/**
 * 移动端开关守卫（ADR-0272）。
 *
 * 2026-10-29 用户报「手机装好 bz 起不来」：`manifest.json` 里 `isDesktopOnly: true`，
 * Obsidian 在移动端**直接不加载**——不是崩，是列表里这一项根本不可启用。而 README 从
 * 1.34.0 起就写着「桌面端 + 移动端通用」，两处口径相反。
 *
 * 这条守卫钉三件事，缺一条就说明「放行移动端」这件事已经名存实亡：
 *  1. `manifest.json` 的 `isDesktopOnly` 是 `false`；
 *  2. `main.ts` 里移动端装读桥那一支还在（没有它，手机上工具坞读不到任何文件）；
 *  3. `dock/vault-fs` 仍然导出 `installVaultFs`（读桥本身）。
 *
 * 要退回「仅桌面端」，正确做法是先删掉这三条里的后两条、同步 README，再改第一条——
 * 也就是让守卫红一次，别让开关和实现悄悄错位。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

describe('manifest：移动端可启动', () => {
  it('isDesktopOnly 必须是 false（true = 手机上装不上）', () => {
    const manifest = JSON.parse(read('manifest.json')) as { isDesktopOnly?: boolean };
    expect(manifest.isDesktopOnly).toBe(false);
  });

  it('main.ts 仍在移动端装读桥（Platform.isMobile → installVaultFs）', () => {
    expect(read('src/main.ts')).toMatch(/if \(Platform\.isMobile\) installVaultFs\(this\.app\);/);
  });

  it('dock/vault-fs 仍导出 installVaultFs', () => {
    expect(read('src/dock/vault-fs.ts')).toMatch(/export function installVaultFs\(/);
  });
});
