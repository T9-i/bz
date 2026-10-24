/**
 * 工具坞面板外壳回归锁 —— 卡片墙 + 详情两视图的 DOM 骨架。
 *
 * 为什么钉这个：UI 是**唯一没有类型保护**的那一层。数据层写错了 tsc 会红，
 * 面板写错了只有人眼能发现（而且往往是很久以后）。这里只钉「该有的骨架在不在」，
 * 不钉像素与文案细节 —— 那部分该由人看，不该由断言猜。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { App } from 'obsidian';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { setDockFs } from '../../src/dock/files';
import { runSignature } from '../../src/dock/parse';
import { closeDock, openDock, unloadDock } from '../../src/dock/ui';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const STORE = `${ROOT}/CONFIG/STORAGE`;
const TOOL = `${ROOT}/CONFIG/SCRIPTS/DockTools/demo`;
const OK_TOOL = `${ROOT}/CONFIG/SCRIPTS/DockTools/other`;

function manifestOf(id: string, name: string): string {
  return JSON.stringify({
    v: 2,
    id,
    name,
    description: '一句话说清它干什么',
    icon: 'zap',
    entry: { cmd: 'node', args: ['main.mjs'] },
    params: [{ key: 'token', type: 'secret', label: '令牌', required: true }],
    defaultRules: [{ id: 'r-daily', trigger: { kind: 'daily', at: '09:00' }, action: { kind: 'run' } }],
  });
}

function seed(): ReturnType<typeof fakeFs> {
  const now = new Date().toISOString();
  return fakeFs({
    [`${STORE}/dock.json`]: JSON.stringify({
      v: 3,
      tools: [
        { id: 'demo', path: 'vault:CONFIG/SCRIPTS/DockTools/demo/manifest.json' },
        { id: 'other', path: 'vault:CONFIG/SCRIPTS/DockTools/other/manifest.json' },
        { id: 'missing', path: 'vault:CONFIG/SCRIPTS/DockTools/missing/manifest.json' },
      ],
      autoRun: true,
      watchdog: true,
      notifySuccess: true,
      statusbar: true,
      breaker: true,
    }),
    [`${TOOL}/manifest.json`]: manifestOf('demo', '演示工具'),
    [`${TOOL}/data.json`]: JSON.stringify({ v: 2, tool: 'demo', values: { token: 'tk' } }),
    [`${TOOL}/runs.jsonl`]:
      JSON.stringify({
        runId: 'r1',
        tool: 'demo',
        trigger: 'auto',
        status: 'ok',
        startedAt: now,
        finishedAt: now,
        durationMs: 1200,
        message: '跑完了',
      }) + '\n',
    [`${OK_TOOL}/manifest.json`]: manifestOf('other', '另一个工具'),
    [`${OK_TOOL}/data.json`]: JSON.stringify({ v: 2, tool: 'other', values: { token: 'tk' } }),
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

let fs: ReturnType<typeof fakeFs>;

beforeEach(() => {
  fs = seed();
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
  setDockFs(null);
  document.body.innerHTML = '';
});

function shape(): HTMLElement {
  openDock(appOf());
  const frame = document.querySelector<HTMLElement>('#bz-dock-panel');
  expect(frame).toBeTruthy();
  return frame!;
}

describe('工具坞面板 · 卡片墙', () => {
  it('外壳走各域共用的面板范式（overlay + frame + 头行），不是自绘的弹层', () => {
    const frame = shape();
    expect(frame.classList.contains('bz-panel-frame')).toBe(true);
    expect(document.querySelector('#bz-dock-mask')?.classList.contains('bz-panel-overlay')).toBe(true);
    expect(frame.querySelector('.bz-panel-head .bz-panel-title')?.textContent).toBe('工具坞');
  });

  it('顶部四格 KPI 在列表页出现，详情页让位', () => {
    shape();
    expect(document.querySelectorAll('#bz-dock-kpi .bz-dock-kpi-tile').length).toBe(4);
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);
    expect(document.querySelector('#bz-dock-kpi')?.classList.contains('is-off')).toBe(true);
  });

  it('一个工具一张卡：图标 / 名 / 描述 / 最近 7 次点阵 / 成功率都在卡面上', () => {
    shape();
    const card = document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]');
    expect(card).toBeTruthy();
    expect(card!.querySelector('.bz-dock-card-name')?.textContent).toBe('演示工具');
    expect(card!.querySelector('.bz-dock-card-desc')?.textContent).toBe('一句话说清它干什么');
    expect(card!.querySelectorAll('.bz-dock-pip').length).toBe(7);
    expect(card!.querySelector('.bz-dock-pip--ok')).toBeTruthy();
    expect(card!.querySelector('.bz-dock-rate')?.textContent).toContain('成功');
    expect(card!.querySelector('.bz-dock-dot')).toBeTruthy();
  });

  it('声明读不到的工具也在列表里，并明说读不到 —— 不是静默消失', () => {
    shape();
    const card = document.querySelector<HTMLElement>('.bz-dock-card[data-tool="missing"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('声明读不到');
  });

  it('搜索按名字收窄列表', () => {
    shape();
    const cards = (): number => document.querySelectorAll('.bz-dock-card').length;
    expect(cards()).toBe(3);
    // 打开搜索行 → 输入
    const searchBtn = document.querySelector<HTMLButtonElement>('#bz-dock-headbtns .bz-icon-btn');
    click(searchBtn!);
    const input = document.querySelector<HTMLInputElement>('#bz-dock-bar .bz-search input');
    expect(input).toBeTruthy();
    input!.value = '另一个';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cards()).toBe(1);
    expect(document.querySelector('.bz-dock-card[data-tool="other"]')).toBeTruthy();
  });
});

describe('工具坞面板 · 详情', () => {
  it('点卡片进详情：封面头行 + 统计三格 + 两栏（运行台 / 运行记录）', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);

    expect(document.querySelector('#bz-dock-panel .bz-panel-head')?.classList.contains('bz-dock-toolhead')).toBe(true);
    expect(document.querySelector('.bz-dock-coveric')).toBeTruthy();
    expect(document.querySelectorAll('.bz-dock-toolstats .bz-dock-kpi-tile').length).toBe(3);
    expect(document.querySelectorAll('.bz-dock-cols > .bz-dock-pane').length).toBe(2);
    expect(document.querySelector('.bz-dock-runpane')).toBeTruthy();
    expect(document.querySelector('.bz-dock-histpane')).toBeTruthy();
  });

  it('运行记录一行一条，带状态与耗时', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);
    const row = document.querySelector('.bz-dock-histrow');
    expect(row).toBeTruthy();
    expect(row!.querySelector('.bz-dock-histstatus')?.textContent).toBe('成功');
    expect(row!.querySelector('.bz-dock-histdur')?.textContent).toBe('1s');
  });

  it('参数表单：密码框承接 secret，标签带必填星号', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);
    const field = document.querySelector('.bz-dock-runpane .bz-field');
    expect(field?.textContent).toContain('令牌 *');
    expect(field?.querySelector<HTMLInputElement>('input')?.type).toBe('password');
  });

  it('自动运行块：一条规则一个只读摘要，点开才出编辑器', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);

    const row = document.querySelector<HTMLElement>('.bz-dock-rule');
    expect(row).toBeTruthy();
    expect(row!.querySelector('.bz-dock-ruleline')?.textContent).toContain('每天 09:00');
    expect(row!.querySelector('.bz-dock-rulearrow')).toBeTruthy();
    // 行内不摊编辑器：参数框挤在一行里点不准，旧面板就是这个口径
    expect(document.querySelector('.bz-dock-ruleform')).toBeNull();

    click(row!);
    expect(document.querySelector('.bz-dock-ruleform')).toBeTruthy();
    expect(document.querySelector('.bz-dock-rulepreview')?.textContent).toContain('每天 09:00');
  });

  it('规则弹窗的触发清单里有「关闭 Obsidian 时」', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);
    click(document.querySelector<HTMLElement>('.bz-dock-rule')!);
    const form = document.querySelector('.bz-dock-ruleform');
    expect(form?.textContent).toContain('关闭 Obsidian 时');
  });

  it('返回键把详情拆掉、头行换回列表态（不是把详情压在下层）', () => {
    shape();
    click(document.querySelector<HTMLElement>('.bz-dock-card[data-tool="demo"]')!);
    click(document.querySelector<HTMLElement>('.bz-dock-back')!);
    expect(document.querySelector('.bz-dock-toolhead')).toBeNull();
    expect(document.querySelector('#bz-dock-panel .bz-panel-title')?.textContent).toBe('工具坞');
    expect(document.querySelectorAll('.bz-dock-card').length).toBe(3);
  });
});

describe('工具坞面板 · 关掉', () => {
  it('关闭只是打上 is-off，DOM 留着（下次打开不重建）', () => {
    shape();
    closeDock();
    expect(document.querySelector('#bz-dock-mask')?.classList.contains('is-off')).toBe(true);
  });
});

function click(node: HTMLElement): void {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
