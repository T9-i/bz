// @vitest-environment node
/**
 * 工具路径的两种形态 —— 登记表要能跟着 vault 走，又要能被当前宿主直接打开。
 *
 * 这一组测试守的是「手机上打开是空列表」那类缺陷的根：登记表里存绝对路径，
 * 换台机器/换个平台就全废，而那时上层只能靠猜路径去补，猜错就是空白。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  isPortablePath,
  portableToolPath,
  resolveToolPath,
  setDockVaultRoot,
  dockVaultRootNow,
} from '../../src/dock/files';
import { VAULT_PATH_PREFIX } from '../../src/dock/types';
import { loadToolView } from '../../src/dock/view';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/Obsidian/叫我包仔';

beforeEach(() => {
  setDockVaultRoot(ROOT);
});

describe('绝对路径 → 可移植路径', () => {
  it('vault 里的工具存相对形态（正斜杠、反斜杠都认）', () => {
    expect(portableToolPath(`E:\\Obsidian\\叫我包仔\\CONFIG\\SCRIPTS\\x\\manifest.json`, ROOT)).toBe(
      `${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json`,
    );
    expect(portableToolPath(`${ROOT}/CONFIG/SCRIPTS/x/manifest.json`, ROOT)).toBe(
      `${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json`,
    );
  });

  it('vault 外的工具原样留着 —— 那种本来就只属于这台机器', () => {
    const p = 'D:/tools/somewhere/manifest.json';
    expect(portableToolPath(p, ROOT)).toBe(p);
  });

  it('只是前缀像、其实不是同一个目录（Obsidian 与 Obsidian2）不算在库内', () => {
    const p = 'E:/Obsidian/叫我包仔2/CONFIG/x/manifest.json';
    expect(portableToolPath(p, ROOT)).toBe(p);
  });

  it('库根本身（极端情况）不会拼出空段', () => {
    expect(portableToolPath(ROOT, ROOT)).toBe(`${VAULT_PATH_PREFIX}.`);
  });

  it('不知道库在哪就不转 —— 猜一个根比不转更糟', () => {
    expect(portableToolPath(`${ROOT}/a/manifest.json`, '')).toBe(`${ROOT}/a/manifest.json`);
  });
});

describe('可移植路径 → 当前宿主的绝对路径', () => {
  it('拼上当前库根', () => {
    expect(resolveToolPath(`${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json`)).toBe(
      `${ROOT}/CONFIG/SCRIPTS/x/manifest.json`,
    );
  });

  it('绝对路径原样返回（vault 外的工具没有别的解释方式）', () => {
    expect(resolveToolPath('D:/tools/x/manifest.json')).toBe('D:/tools/x/manifest.json');
  });

  it('宿主没报库根时退回相对形态，不拼出一个假的绝对路径', () => {
    setDockVaultRoot('');
    expect(resolveToolPath(`${VAULT_PATH_PREFIX}CONFIG/x/manifest.json`)).toBe('CONFIG/x/manifest.json');
  });

  it('前缀是唯一的判据，不是「看着像」', () => {
    expect(isPortablePath(`${VAULT_PATH_PREFIX}a`)).toBe(true);
    expect(isPortablePath('/vault:a')).toBe(false);
    expect(isPortablePath('vault')).toBe(false);
  });

  it('入库时会被归一（尾斜杠、反斜杠都剥掉）', () => {
    setDockVaultRoot('E:\\Obsidian\\叫我包仔\\');
    expect(dockVaultRootNow()).toBe(ROOT);
  });
});

describe('视图：拿到可移植路径也能读出来', () => {
  it('声明与伴随文件都跟着还原后的路径读', () => {
    const fs = fakeFs();
    fs.writeText(
      `${ROOT}/CONFIG/SCRIPTS/x/manifest.json`,
      JSON.stringify({ v: 2, id: 'x', name: '演示', entry: { cmd: 'node', args: ['main.mjs'] } }),
    );
    fs.writeText(`${ROOT}/CONFIG/SCRIPTS/x/dock.intent.json`, JSON.stringify({ v: 1, tool: 'x', enabled: false }));

    const v = loadToolView({ id: 'x', path: `${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json` }, { fs });

    expect(v.manifest?.name).toBe('演示');
    expect(v.path).toBe(`${ROOT}/CONFIG/SCRIPTS/x/manifest.json`);
    // 登记表里的原样留着，只给「从哪来的」这类展示用
    expect(v.declaredPath).toBe(`${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json`);
    expect(v.intent.enabled).toBe(false);
    expect(v.error).toBeUndefined();
  });

  it('可移植路径在别的机器上换个库根，读的还是同一个相对位置', () => {
    const fs = fakeFs();
    fs.writeText(
      '/other/machine/CONFIG/SCRIPTS/x/manifest.json',
      JSON.stringify({ v: 2, id: 'x', name: '另一台', entry: { cmd: 'node' } }),
    );
    setDockVaultRoot('/other/machine');
    const v = loadToolView({ id: 'x', path: `${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json` }, { fs });
    expect(v.manifest?.name).toBe('另一台');
  });
});
