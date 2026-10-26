// @vitest-environment node
/**
 * 移动端读桥自举 —— 手机上打开工具坞不能是空列表。
 *
 * 守的是一个具体缺陷（2026-10-27 报「移动端一片空白」）：
 * `primeOne()` 把路径交给 `toVaultRelative()` 换成适配器口径，而上一版只认
 * 「`vault:` 前缀」与「basePath 前缀的绝对路径」。手机上 `adapter.getBasePath()` 多半
 * 不存在，于是**登记表自己的相对路径**和**工具的可移植路径还原出的相对路径**两头都不命中，
 * 一份文件都没预取 —— 登记表读成空表，面板永远是空的。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { installVaultFs, primeVaultFs, primedCount, uninstallVaultFs } from '../../src/dock/vault-fs';
import { setDockVaultRoot } from '../../src/dock/files';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { readRegistry } from '../../src/dock/registry';
import { loadToolView } from '../../src/dock/view';
import { VAULT_PATH_PREFIX } from '../../src/dock/types';

const REGISTRY = `${VAULT_PATH_PREFIX}CONFIG/SCRIPTS/x/manifest.json`;
const MANIFEST = JSON.stringify({ v: 2, id: 'x', name: '演示工具', entry: { cmd: 'node', args: ['main.mjs'] } });

/** 假 vault：只实现 adapter.read（相对路径），`withBase` 决定有没有 getBasePath */
function fakeApp(files: Record<string, string>, opts: { withBase?: string } = {}): unknown {
  const adapter: Record<string, unknown> = {
    read: async (rel: string): Promise<string> => {
      const t = files[rel];
      if (t === undefined) throw new Error('ENOENT ' + rel);
      return t;
    },
  };
  if (opts.withBase) adapter.getBasePath = () => opts.withBase;
  return { vault: { adapter } };
}

function vaultFiles(): Record<string, string> {
  return {
    'CONFIG/STORAGE/dock.json': JSON.stringify({ v: 3, tools: [{ id: 'x', path: REGISTRY }] }),
    'CONFIG/SCRIPTS/x/manifest.json': MANIFEST,
    'CONFIG/SCRIPTS/x/dock.intent.json': JSON.stringify({ v: 1, tool: 'x', enabled: false }),
    'CONFIG/SCRIPTS/x/runs.jsonl': '{"runId":"r1","tool":"x","status":"ok","startedAt":"2026-10-27T01:00:00.000Z"}\n',
  };
}

beforeEach(() => {
  setSettingsProvider(() => ({ storagePath: 'CONFIG/STORAGE' }) as never);
  setDockVaultRoot('');
});

afterEach(() => {
  uninstallVaultFs();
});

describe('primeVaultFs：登记表与工具文件都得进内存', () => {
  it('适配器没有 getBasePath（手机常态）：相对路径照样读进来', async () => {
    const app = fakeApp(vaultFiles());
    setApp(app as never);
    installVaultFs(app as never);

    await primeVaultFs(app as never);

    // 登记表 + 声明 + 意图 + 记录
    expect(primedCount()).toBe(4);
    expect(readRegistry().registry.tools.map((t) => t.id)).toEqual(['x']);

    const v = loadToolView({ id: 'x', path: REGISTRY });
    expect(v.manifest?.name).toBe('演示工具');
    expect(v.intent.enabled).toBe(false);
    expect(v.lastRun?.status).toBe('ok');
  });

  it('适配器给了 getBasePath：绝对形态与相对形态两条键都能命中', async () => {
    const base = '/storage/emulated/0/我的库';
    const files = vaultFiles();
    const app = fakeApp(files, { withBase: base });
    setApp(app as never);
    installVaultFs(app as never);

    await primeVaultFs(app as never);

    expect(readRegistry().registry.tools.map((t) => t.id)).toEqual(['x']);
    expect(loadToolView({ id: 'x', path: REGISTRY }).manifest?.name).toBe('演示工具');
  });

  it('不在当前库里（绝对路径、库外）的工具跳过，不炸也不假装读到了', async () => {
    const app = fakeApp({ ...vaultFiles(), 'CONFIG/STORAGE/dock.json': JSON.stringify({ v: 3, tools: [{ id: 'y', path: 'D:/tools/y/manifest.json' }] }) });
    setApp(app as never);
    installVaultFs(app as never);

    await primeVaultFs(app as never);

    expect(readRegistry().registry.tools.map((t) => t.id)).toEqual(['y']);
    const v = loadToolView({ id: 'y', path: 'D:/tools/y/manifest.json' });
    expect(v.manifest).toBeNull();
    expect(v.error).toContain('读不到');
  });
});
