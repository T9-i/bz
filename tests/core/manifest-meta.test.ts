// @vitest-environment node
/**
 * 插件元信息守卫
 *
 * 存在理由：版本号与描述散在两处（`manifest.json` 给 Obsidian 读，`package.json` 给 npm/pnpm 读），
 * 而它们各自要满足的约束完全不同：
 *
 * - **版本必须一致**。2026-10-29 实测：manifest 已经走到 1.34.1，package.json 还停在 1.0.0。
 *   这种漂移不会让任何东西报错，只会在「按 package.json 版本打包/打标签」时悄悄对不上号。
 * - **description 有商店侧的字数上限**。社区插件市场的列表只显示这一行，官方的校验还禁止
 *   出现 "obsidian" 字样；写成一串域名词（改版前是 106 字的「主页、日记本、备忘录……」）
 *   既不达标也不好读。
 * - **id 是安装目录名**。改了它等于所有人重装一遍，必须钉死。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 商店侧对 description 的字数上限（按字符算，中文也算 1 个） */
const DESCRIPTION_LIMIT = 250;

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as Record<string, unknown>;
}

describe('插件元信息', () => {
  const manifest = readJson('manifest.json');
  const pkg = readJson('package.json');

  it('manifest 与 package.json 版本号一致', () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it('版本号是 semver（打 tag 时直接拼 v<版本>）', () => {
    expect(String(manifest.version)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('id 固定为 bz（它是安装目录名，改了等于全员重装）', () => {
    expect(manifest.id).toBe('bz');
    expect(pkg.name).toBe('bz');
  });

  it('description 不超商店上限，且不出现 obsidian', () => {
    for (const [where, value] of [
      ['manifest.json', manifest.description],
      ['package.json', pkg.description],
    ] as const) {
      const text = String(value ?? '');
      expect(text.length, `${where} 的 description 不能为空`).toBeGreaterThan(0);
      expect([...text].length, `${where} 的 description 超过 ${DESCRIPTION_LIMIT} 字`).toBeLessThanOrEqual(
        DESCRIPTION_LIMIT,
      );
      expect(text.toLowerCase(), `${where} 的 description 不能出现 obsidian`).not.toContain('obsidian');
      expect(text, `${where} 的 description 不能有换行`).not.toMatch(/[\r\n]/);
    }
  });
});
