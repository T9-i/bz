/**
 * 移动端运行台**只读** —— 参数只能看，不能改。
 *
 * 为什么这是个真缺陷而不是体验偏好：手机上的 fs 是打开面板时预取的内存快照，
 * `writeText` 是空实现。控件照样能点、界面照样变，可盘上的 `data.json` 一点没动 ——
 * 用户以为改好了，下次打开又变回去（或者在手机上填的密钥根本没存）。
 * 所以移动端连控件都不建，只给值。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { setDockFs } from '../../src/dock/files';
import { openDock, openToolPanel, unloadDock } from '../../src/dock/ui';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const STORE = `${ROOT}/CONFIG/STORAGE`;
const TOOL = `${ROOT}/CONFIG/SCRIPTS/DockTools/demo`;

const MANIFEST = JSON.stringify({
  v: 2,
  id: 'demo',
  name: '演示工具',
  description: '一句话说清它干什么',
  icon: 'zap',
  entry: { cmd: 'node', args: ['main.mjs'] },
  params: [
    { key: 'enabled', label: '启用', type: 'bool', default: true },
    { key: 'mode', label: '模式', type: 'choice', options: ['快', '全'], default: '全' },
    { key: 'keyword', label: '关键词', type: 'text', default: '白菜' },
    { key: 'token', label: '凭据', type: 'secret' },
    { key: 'extra', label: '额外参数', type: 'multiline' },
  ],
  defaultRules: [],
});

function appOf(): App {
  return {
    vault: { adapter: { getBasePath: () => ROOT }, getAbstractFileByPath: () => null },
    workspace: { openLinkText: () => undefined },
  } as unknown as App;
}

beforeEach(() => {
  setDockFs(
    fakeFs({
      [`${STORE}/dock.json`]: JSON.stringify({ v: 3, tools: [{ id: 'demo', path: 'vault:CONFIG/SCRIPTS/DockTools/demo/manifest.json' }] }),
      [`${TOOL}/manifest.json`]: MANIFEST,
      // secret 留了真值 —— 移动端不该把它摊在屏幕上
      [`${TOOL}/data.json`]: JSON.stringify({ v: 2, tool: 'demo', values: { token: 'sk-live-abcdef123456' } }),
      [`${TOOL}/runs.jsonl`]: '',
    }),
  );
  setApp(appOf());
  setSettingsProvider(() => ({ storagePath: 'CONFIG/STORAGE', dockTrust: {} }) as never);
  (Platform as unknown as { isMobile: boolean }).isMobile = true;
  document.body.innerHTML = '';
});

afterEach(() => {
  unloadDock();
  (Platform as unknown as { isMobile: boolean }).isMobile = false;
  setDockFs(null);
  document.body.innerHTML = '';
});

describe('工具坞 · 移动端运行台只读', () => {
  it('参数行里没有任何可改的控件', () => {
    openToolPanel(appOf(), 'demo');
    const pane = document.querySelector('.bz-dock-runpane');
    expect(pane).toBeTruthy();
    expect(pane!.querySelectorAll('input, textarea, [role="switch"], [role="listbox"]')).toHaveLength(0);
    // 五个参数 → 五个只读值
    expect(pane!.querySelectorAll('.bz-dock-roval')).toHaveLength(5);
  });

  it('值还是看得见：bool 给「开」、choice 给当前档、text 给原文', () => {
    openToolPanel(appOf(), 'demo');
    const vals = [...document.querySelectorAll('.bz-dock-roval')].map((n) => n.textContent);
    expect(vals).toContain('开');
    expect(vals).toContain('全');
    expect(vals).toContain('白菜');
  });

  it('凭据只报「已设置」，不把明文摊在屏幕上', () => {
    openToolPanel(appOf(), 'demo');
    const pane = document.querySelector('.bz-dock-runpane')!;
    expect(pane.textContent).toContain('已设置');
    expect(pane.textContent).not.toContain('sk-live-abcdef123456');
  });

  it('运行台标题旁标了「只读」', () => {
    openToolPanel(appOf(), 'demo');
    const head = document.querySelector('.bz-dock-runpane .bz-dock-pane-head');
    expect(head?.textContent).toContain('只读');
  });

  it('卡面也不给运行按钮（只留「移动端仅查看」）', () => {
    openDock(appOf());
    const card = document.querySelector('.bz-dock-card[data-tool="demo"]');
    expect(card).toBeTruthy();
    expect(card!.querySelectorAll('button')).toHaveLength(0);
    expect(card!.textContent).toContain('移动端仅查看');
  });
});
