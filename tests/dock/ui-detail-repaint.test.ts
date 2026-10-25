/**
 * 详情页的两条「别动我正在看的东西」：
 *
 *  1) 后台又写了一条记录时，用户展开的那条运行记录不能被收回去；
 *  2) 只追加记录（`panel.html` 没变）时，展示板 iframe 不能整块换 —— 换一次就是
 *     白闪一次、工具自己画的状态全丢、高度重测一次。
 *
 * 上一版 `repaintDetail` 每次记录变化都把这两块一起 replaceWith。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { App } from 'obsidian';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { setDockFs } from '../../src/dock/files';
import { runSignature } from '../../src/dock/parse';
import { openToolPanel, unloadDock } from '../../src/dock/ui';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const STORE = `${ROOT}/CONFIG/STORAGE`;
const TOOL = `${ROOT}/CONFIG/SCRIPTS/DockTools/demo`;
const OTHER = `${ROOT}/CONFIG/SCRIPTS/DockTools/other`;

function manifest(): string {
  return JSON.stringify({
    v: 2,
    id: 'demo',
    name: '演示工具',
    description: '一句话说清它干什么',
    icon: 'zap',
    entry: { cmd: 'node', args: ['main.mjs'] },
    params: [],
    defaultRules: [],
  });
}

function record(runId: string, withSteps = false): string {
  const at = new Date().toISOString();
  return (
    JSON.stringify({
      runId,
      tool: 'demo',
      trigger: 'auto',
      status: 'ok',
      startedAt: at,
      finishedAt: at,
      durationMs: 900,
      message: `第 ${runId} 次`,
      ...(withSteps ? { steps: [{ text: '第一步', at }] } : {}),
    }) + '\n'
  );
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

let fs: ReturnType<typeof fakeFs>;

beforeEach(() => {
  vi.useFakeTimers();
  fs = fakeFs({
    [`${STORE}/dock.json`]: JSON.stringify({
      v: 3,
      tools: [
        { id: 'demo', path: 'vault:CONFIG/SCRIPTS/DockTools/demo/manifest.json' },
        { id: 'other', path: 'vault:CONFIG/SCRIPTS/DockTools/other/manifest.json' },
      ],
      autoRun: true,
      watchdog: true,
      notifySuccess: true,
      statusbar: true,
      breaker: true,
    }),
    [`${TOOL}/manifest.json`]: manifest(),
    [`${TOOL}/data.json`]: JSON.stringify({ v: 2, tool: 'demo', values: {} }),
    [`${TOOL}/runs.jsonl`]: record('r1', true),
    [`${TOOL}/panel.html`]: '<p>板子</p>',
    [`${OTHER}/manifest.json`]: manifest().replace(/"demo"/g, '"other"').replace('演示工具', '另一个工具'),
    [`${OTHER}/data.json`]: JSON.stringify({ v: 2, tool: 'other', values: {} }),
    [`${OTHER}/runs.jsonl`]: record('o1', true),
  });
  setDockFs(fs);
  setApp(appOf());
  setSettingsProvider(
    () =>
      ({
        storagePath: 'CONFIG/STORAGE',
        dockTrust: {
          demo: { at: new Date().toISOString(), run: runSignature({ cmd: 'node', args: ['main.mjs'] }) },
          other: { at: new Date().toISOString(), run: runSignature({ cmd: 'node', args: ['main.mjs'] }) },
        },
      }) as never,
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unloadDock();
  vi.useRealTimers();
  setDockFs(null);
  document.body.innerHTML = '';
});

function appendRun(text: string): void {
  fs.files.set(`${TOOL}/runs.jsonl`, (fs.files.get(`${TOOL}/runs.jsonl`) ?? '') + text);
}

function click(node: HTMLElement): void {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('工具坞 · 详情页重画不打扰正在看的东西', () => {
  it('展开的那条记录，在后台追加新记录后仍然是展开的', async () => {
    openToolPanel(appOf(), 'demo');
    const toggle = document.querySelector<HTMLElement>('.bz-dock-histtoggle');
    expect(toggle).toBeTruthy();
    click(toggle!);
    expect(document.querySelector('.bz-dock-histrow.is-open')).toBeTruthy();

    appendRun(record('r2', true));
    await vi.advanceTimersByTimeAsync(3000);

    const open = document.querySelector<HTMLElement>('.bz-dock-histrow.is-open');
    expect(open).toBeTruthy();
    expect(open?.dataset.run).toBe('r1');
    expect(document.querySelectorAll('.bz-dock-histrow')).toHaveLength(2);
  });

  it('只追加记录、展示板没变 → iframe 是同一个节点（不白闪）', async () => {
    openToolPanel(appOf(), 'demo');
    const before = document.querySelector('.bz-dock-board iframe');
    expect(before).toBeTruthy();

    appendRun(record('r2'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(document.querySelector('.bz-dock-board iframe')).toBe(before);
  });

  it('切到别的工具再切回来，原来展开的那条还在（展开态按工具分开记）', () => {
    openToolPanel(appOf(), 'demo');
    click(document.querySelector<HTMLElement>('.bz-dock-histtoggle')!);
    expect(document.querySelector<HTMLElement>('.bz-dock-histrow.is-open')?.dataset.run).toBe('r1');

    // 去另一个工具的详情（它的记录栏会渲染一遍 —— 不该动 demo 的展开态）
    openToolPanel(appOf(), 'other');
    expect(document.querySelector<HTMLElement>('.bz-dock-histrow.is-open')).toBeNull();

    openToolPanel(appOf(), 'demo');
    expect(document.querySelector<HTMLElement>('.bz-dock-histrow.is-open')?.dataset.run).toBe('r1');
  });

  it('展示板真变了 → 才换掉 iframe', async () => {
    openToolPanel(appOf(), 'demo');
    const before = document.querySelector('.bz-dock-board iframe');

    fs.files.set(`${TOOL}/panel.html`, '<p>新板子内容更长一点</p>');
    await vi.advanceTimersByTimeAsync(3000);

    const after = document.querySelector('.bz-dock-board iframe');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });
});
