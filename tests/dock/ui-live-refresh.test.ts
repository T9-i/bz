/**
 * 面板「跟着后台变」的回归锁。
 *
 * 报的毛病是：工具由值守进程（或它自己）在后台跑完，`runs.jsonl` 已经追加了新记录，
 * 但面板还是跑之前那个样子 —— 卡片上的时间、结果、运行记录都不动，按钮一直停在
 * 「后台正在跑」，必须关掉再打开才刷新（2026-10-25）。
 *
 * 根因是面板只在「打开 / 点刷新」时重读文件，每 3 秒那一拍只换了状态点的颜色。
 * 这里钉住三条：
 *  1) 后台追加记录 → 卡片自己更新；
 *  2) 后台跑完（心跳还留着、账本里有终态）→ 按钮从「后台正在跑」退回「运行」，记录多一条；
 *  3) 只动心跳（记录没变）→ 不该把运行记录整栏重画掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { App } from 'obsidian';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { setDockFs } from '../../src/dock/files';
import { runSignature } from '../../src/dock/parse';
import { openDock, unloadDock } from '../../src/dock/ui';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const STORE = `${ROOT}/CONFIG/STORAGE`;
const TOOL = `${ROOT}/CONFIG/SCRIPTS/DockTools/demo`;

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

function record(runId: string, status: string, message: string): string {
  const at = new Date().toISOString();
  return (
    JSON.stringify({
      runId,
      tool: 'demo',
      trigger: 'auto',
      status,
      startedAt: at,
      finishedAt: at,
      durationMs: 900,
      message,
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
      tools: [{ id: 'demo', path: 'vault:CONFIG/SCRIPTS/DockTools/demo/manifest.json' }],
      autoRun: true,
      watchdog: true,
      notifySuccess: true,
      statusbar: true,
      breaker: true,
    }),
    [`${TOOL}/manifest.json`]: manifest(),
    [`${TOOL}/data.json`]: JSON.stringify({ v: 2, tool: 'demo', values: {} }),
    [`${TOOL}/runs.jsonl`]: record('r1', 'ok', '跑完了'),
  });
  setDockFs(fs);
  setApp(appOf());
  setSettingsProvider(
    () =>
      ({
        storagePath: 'CONFIG/STORAGE',
        dockTrust: {
          demo: { at: new Date().toISOString(), run: runSignature({ cmd: 'node', args: ['main.mjs'] }) },
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

/** 后台追加一行记录（工具脚本干完活就是这么写的） */
function appendRun(text: string): void {
  fs.files.set(`${TOOL}/runs.jsonl`, (fs.files.get(`${TOOL}/runs.jsonl`) ?? '') + text);
}

/** 后台盖一次心跳（每 5 秒一次，跑到一半时文件长这样） */
function beat(runId: string, step: string): void {
  fs.files.set(`${TOOL}/heartbeat.json`, JSON.stringify({ at: new Date().toISOString(), runId, step }));
}

function card(): HTMLElement {
  return document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!;
}

function click(node: HTMLElement): void {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function runBtnText(): string {
  return document.querySelector('.bz-dock-runpane .bz-dock-runbtns button')?.textContent ?? '';
}

describe('工具坞 · 后台改盘后界面自己跟上', () => {
  it('后台追加一条记录：卡片不用重开就换成新的结果', async () => {
    openDock(appOf());
    expect(card().querySelector('.bz-dock-pip--failed')).toBeNull();

    appendRun(record('r2', 'failed', '网络不通'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(card().querySelector('.bz-dock-pip--failed')).toBeTruthy();
    expect(card().querySelector('.bz-dock-card-msg')?.textContent).toContain('网络不通');
  });

  it('后台跑完：按钮从「后台正在跑」退回「运行」，运行记录当场多一条', async () => {
    beat('hb1', '抓取中');
    openDock(appOf());
    click(card());
    expect(runBtnText()).toContain('后台正在跑');

    // 跑完：账本落终态，心跳文件还留着（契约里它只有「活着」这一个含义，工具不会删）
    appendRun(record('hb1', 'ok', '抓完了'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(runBtnText()).toBe('运行');
    expect(document.querySelectorAll('.bz-dock-histrow').length).toBe(2);
    expect(document.querySelector('.bz-dock-live')?.textContent ?? '').not.toContain('后台进程在跑');
  });

  it('只盖心跳（记录没变）时不重画运行记录栏 —— 用户展开的那条不该被收起来', async () => {
    beat('hb1', '抓取中');
    openDock(appOf());
    click(card());
    const rows = document.querySelector('.bz-dock-histpane');
    expect(rows).toBeTruthy();

    beat('hb1', '还在抓');
    await vi.advanceTimersByTimeAsync(3000);

    // 同一个 DOM 节点还在（没被整栏替换掉），文案跟着心跳走
    expect(document.querySelector('.bz-dock-histpane')).toBe(rows);
    expect(document.querySelector('.bz-dock-live')?.textContent ?? '').toContain('还在抓');
  });
});
