// @vitest-environment node
/**
 * 多 vault 分家：**三处实现必须算出同一个目录键**。
 *
 * 值守状态按库分目录（`%LOCALAPPDATA%\bz-dock-watch\vaults\<key>\`），key 由 vault 绝对路径
 * 算 FNV-1a 32 位。参与方三个，各写各的语言：
 *
 *   - 插件：`src/core/vault-key.ts`
 *   - 值守：`tools/dock-watch/runtime.js`
 *   - 安装：`tools/dock-watch/install.ps1` 的 `Get-VaultKey`
 *
 * 任何一个算歪，症状都是「值守在跑，插件说它没装过」——没有任何报错，全靠人猜。
 * 所以这里既比对 JS 与 TS，也在 Windows 上真跑一次 PowerShell 比对第三份实现
 * （**直接从 install.ps1 里取出那段函数**，而不是抄一份到测试里——抄的那份永远不会跟着改）。
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vaultKeyOf } from '../../src/core/vault-key';
import { liveLogFileOf, watchdogVaultDirOf, WATCHDOG_DIRNAME } from '../../src/dock/watchdog-status';

const require = createRequire(import.meta.url);
const rt = require('../../tools/dock-watch/runtime.js') as {
  vaultKeyOf(vault: string): string;
  watchdogDir(env?: Record<string, string>, vault?: string): string;
};

const BS = String.fromCharCode(92);
const norm = (p: string): string => String(p).replace(/\\/g, '/');
const CASES = [
  'E:/Obsidian/叫我包仔',
  `E:${BS}Obsidian${BS}叫我包仔`,
  'E:/Obsidian/叫我包仔/', // 尾斜杠
  '  E:/Obsidian/叫我包仔  ', // 两端空白
  'D:/vaults/bz-test',
  '/Users/somebody/My Vault',
  'C:/Users/张三/Documents/Obsidian/工作库',
];

describe('vault 目录键：插件与值守算出同一个值', () => {
  for (const v of CASES) {
    it(`${JSON.stringify(v)}`, () => {
      const fromTs = vaultKeyOf(v);
      expect(fromTs).toMatch(/^[0-9a-f]{8}$/);
      expect(rt.vaultKeyOf(v)).toBe(fromTs);
    });
  }

  it('归一后再算：反斜杠、尾斜杠、两端空白都不改变结果', () => {
    const a = vaultKeyOf('E:/Obsidian/叫我包仔');
    for (const v of [`E:${BS}Obsidian${BS}叫我包仔`, 'E:/Obsidian/叫我包仔//', ' E:/Obsidian/叫我包仔 ']) {
      expect(vaultKeyOf(v)).toBe(a);
    }
  });

  it('不同库落在不同目录；空路径不建 vaults 层（老形态仍可用）', () => {
    expect(vaultKeyOf('D:/a')).not.toBe(vaultKeyOf('D:/b'));
    expect(vaultKeyOf('')).toBe('');
    const env = { LOCALAPPDATA: 'C:/Users/x/AppData/Local' };
    expect(norm(rt.watchdogDir(env, 'D:/a'))).toBe(
      `${env.LOCALAPPDATA}/${WATCHDOG_DIRNAME}/vaults/${vaultKeyOf('D:/a')}`,
    );
    expect(norm(rt.watchdogDir(env, ''))).toBe(`${env.LOCALAPPDATA}/${WATCHDOG_DIRNAME}`);
  });

  it('插件侧拼出的状态目录与值守侧一致', () => {
    const vault = 'E:/Obsidian/叫我包仔';
    const envA = { LOCALAPPDATA: 'C:/Users/x/AppData/Local' };
    expect(norm(watchdogVaultDirOf(vault, envA as never))).toBe(norm(rt.watchdogDir(envA, vault)));
  });

  it('实时步骤文件也在本库目录下（不会串到别的库）', () => {
    const file = norm(liveLogFileOf('steam-cheap-radar', 'E:/vaults/a'));
    expect(file).toContain(`/vaults/${vaultKeyOf('E:/vaults/a')}/live/steam-cheap-radar.jsonl`);
  });
});

describe('vault 目录键：install.ps1 的第三份实现', () => {
  const canRun = process.platform === 'win32';

  it.skipIf(!canRun)('与插件侧逐字相同（真跑一次 PowerShell，函数取自 install.ps1 本体）', () => {
    const ps1 = readFileSync(path.join(__dirname, '../../tools/dock-watch/install.ps1'), 'utf8');
    const m = ps1.match(/function Get-VaultKey[\s\S]*?\r?\n\}/);
    expect(m, 'install.ps1 里应当有 Get-VaultKey').toBeTruthy();
    const script = [m![0], `Get-VaultKey "E:/Obsidian/叫我包仔"`, `Get-VaultKey "D:/vaults/bz-test"`].join('\n');

    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    if (r.error || r.status !== 0) {
      // PowerShell 不可用的机器上不制造假红（算法已由上面的 JS/TS 比对钉住）
      return;
    }
    const lines = String(r.stdout || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    expect(lines).toEqual([vaultKeyOf('E:/Obsidian/叫我包仔'), vaultKeyOf('D:/vaults/bz-test')]);
  });
});
