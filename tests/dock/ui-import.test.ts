/**
 * 「导入工具」这条链：选目录 → 在目录里找 manifest.json → 登记。
 *
 * 上一版只读 `File.path`。Electron ≥32 把它删了（改成 `webUtils.getPathForFile`），
 * 于是新版宿主上每次导入都弹「读不到文件夹路径（这个平台不支持）」—— 明明支持，
 * 是取法过时了，提示还把锅推给了平台。
 *
 * 这里钉住四件事：
 *  1) 老宿主（有 `File.path`）照旧能导；
 *  2) 新宿主（只有 `webUtils`）也能导 —— 这是本次修复的主线；
 *  3) 两条路都拿不到路径时，才报那句「平台不支持」；
 *  4) 选中父目录时按深度挑最浅的 manifest.json，一层里有多个就让人重选，
 *     不许像上一版那样「`files` 里第一个就是它」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { App } from 'obsidian';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { setDockFs } from '../../src/dock/files';
import { openDock, unloadDock } from '../../src/dock/ui';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const STORE = `${ROOT}/CONFIG/STORAGE`;
const TOOLS = `${ROOT}/CONFIG/SCRIPTS/DockTools`;
const DEMO = `${TOOLS}/demo`;

function manifest(id: string): string {
  return JSON.stringify({
    v: 2,
    id,
    name: `${id} 工具`,
    description: '一句话说清它干什么',
    icon: 'zap',
    entry: { cmd: 'node', args: ['main.mjs'] },
    params: [],
    defaultRules: [],
  });
}

function appOf(): App {
  return {
    vault: {
      adapter: { getBasePath: () => ROOT },
      getAbstractFileByPath: () => null,
    },
    workspace: { openLinkText: () => undefined },
  } as unknown as App;
}

/** 假的选中文件：只带 `fileDiskPath` 会去读的那几个字段 */
interface Picked {
  name: string;
  rel: string;
  disk: string;
  /** 老宿主：直接挂在 File 上的绝对路径 */
  legacy?: string;
}

let fs: ReturnType<typeof fakeFs>;
let lastInput: HTMLInputElement | null;
let origClick: () => void;

/** `pickFolder` 内部建的那个 input —— click 被拦下来，留个引用给用例喂文件 */
beforeEach(() => {
  fs = fakeFs({
    [`${STORE}/dock.json`]: JSON.stringify({ v: 3, tools: [], autoRun: true, watchdog: true }),
    [`${DEMO}/manifest.json`]: manifest('demo'),
    [`${DEMO}/data.json`]: JSON.stringify({ v: 2, tool: 'demo', values: {} }),
    // 第二个工具也真的存在：旧实现「拿 files 里第一个」会把它导进来，断言才抓得住
    [`${TOOLS}/other/manifest.json`]: manifest('other'),
  });
  setDockFs(fs);
  setApp(appOf());
  setSettingsProvider(() => ({ storagePath: 'CONFIG/STORAGE', dockTrust: {} }) as never);

  lastInput = null;
  origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    lastInput = this;
  };
  document.body.innerHTML = '';
});

afterEach(() => {
  unloadDock();
  HTMLInputElement.prototype.click = origClick;
  delete (window as { require?: unknown }).require;
  setDockFs(null);
  document.body.innerHTML = '';
});

/** 宿主 node 侧模块：只有 electron.webUtils 这一条被子进程用到 */
function mockElectron(webUtils: unknown): void {
  (window as { require?: unknown }).require = (m: string) => (m === 'electron' ? { webUtils } : null);
}

function clickImport(): void {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('导入工具'));
  expect(btn).toBeTruthy();
  btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(lastInput).toBeTruthy();
}

function choose(files: Picked[]): void {
  const input = lastInput!;
  const list = files.map((f) => ({
    name: f.name,
    webkitRelativePath: f.rel,
    path: f.legacy,
    __disk: f.disk,
  }));
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** 登记表里现在有哪些工具 */
function registered(): { id: string; path: string }[] {
  const raw = fs.files.get(`${STORE}/dock.json`);
  expect(raw).toBeTruthy();
  return (JSON.parse(raw!) as { tools: { id: string; path: string }[] }).tools;
}

describe('工具坞 · 导入脚本', () => {
  it('新宿主（没有 File.path，只有 webUtils）→ 用 getPathForFile 取到路径并登记', () => {
    mockElectron({ getPathForFile: (f: { __disk?: string }) => f.__disk ?? '' });
    openDock(appOf());
    clickImport();

    choose([{ name: 'manifest.json', rel: 'demo/manifest.json', disk: `${DEMO}/manifest.json` }]);

    // vault 内的工具登记成可移植形态，换台机器也还在
    expect(registered()).toEqual([{ id: 'demo', path: 'vault:CONFIG/SCRIPTS/DockTools/demo/manifest.json' }]);
  });

  it('老宿主（File.path 还在）→ 照旧能导，不去碰 electron', () => {
    mockElectron(undefined); // 没有 webUtils，拿到也不该走到这一步
    openDock(appOf());
    clickImport();

    choose([
      { name: 'manifest.json', rel: 'demo/manifest.json', disk: '', legacy: `${DEMO}/manifest.json` },
    ]);

    expect(registered().map((t) => t.id)).toEqual(['demo']);
  });

  it('两条路都拿不到 → 才报「平台不支持」，且不登记', () => {
    mockElectron({}); // 有 electron 但没有 webUtils
    openDock(appOf());
    clickImport();

    choose([{ name: 'manifest.json', rel: 'demo/manifest.json', disk: '' }]);

    expect(registered()).toEqual([]);
  });

  it('选的是父目录、下面有好几个工具 → 让用户重选，不瞎猜第一个', () => {
    mockElectron({ getPathForFile: (f: { __disk?: string }) => f.__disk ?? '' });
    openDock(appOf());
    clickImport();

    choose([
      { name: 'manifest.json', rel: 'demo/manifest.json', disk: `${DEMO}/manifest.json` },
      { name: 'manifest.json', rel: 'other/manifest.json', disk: `${TOOLS}/other/manifest.json` },
    ]);

    expect(registered()).toEqual([]);
  });

  it('父目录里有个子目录工具，但根上确实有一套 → 取最浅那层', () => {
    mockElectron({ getPathForFile: (f: { __disk?: string }) => f.__disk ?? '' });
    openDock(appOf());
    clickImport();

    choose([
      // 深层那个排在前：上一版会直接拿它，然后「读不到这个文件」
      { name: 'manifest.json', rel: 'bundle/nested-x/manifest.json', disk: `${TOOLS}/nested-x/manifest.json` },
      { name: 'manifest.json', rel: 'bundle/manifest.json', disk: `${DEMO}/manifest.json` },
    ]);

    expect(registered().map((t) => t.id)).toEqual(['demo']);
  });
});
