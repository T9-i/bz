/**
 * 工具坞行为单源 · 评审壳启动入口。
 *
 * 与插件侧的差别只有「宿主」：真 `ui.ts` / `kernel.ts` / `exec.ts` 一行不改，只把
 *   - App 换成 FakeApp（fake vault 跑在 localStorage 上）；
 *   - `DockFs` 换成 localStorage 实现（工具目录在真实环境里是磁盘路径，浏览器里没有磁盘）；
 *   - 种子数据写两个演示工具，覆盖「有规则 / 没授权 / 声明坏了」三种形态。
 *
 * 产物：`prototype-behavior.js` 挂 `window.BZW_dock`，壳只调 `boot` / `openDock`。
 */
import { FakeApp } from './fake/fake-obsidian';
import { getApp, setApp } from '../../src/core/app';
import { setSettingsProvider, setSettingsSaver } from '../../src/core/settings-provider';
import { setDockFs, type DockFs } from '../../src/dock/files';
import { openDock, closeDock, unloadDock } from '../../src/dock/ui';

const PREFIX = 'bz-sim:';
const ROOT = '/sim-vault/CONFIG/SCRIPTS/DockTools';
const SEED_FLAG = 'bz-dock-sim-seeded-v2';

function keyOf(p: string): string {
  return PREFIX + p;
}

/** 工具目录在浏览器里的替身：路径就是键，一行都不碰真磁盘 */
const simFs: DockFs = {
  readText: (p) => localStorage.getItem(keyOf(p)),
  writeText: (p, d) => localStorage.setItem(keyOf(p), d),
  rename: (a, b) => {
    const v = localStorage.getItem(keyOf(a));
    if (v === null) throw new Error(`no such file: ${a}`);
    localStorage.removeItem(keyOf(a));
    localStorage.setItem(keyOf(b), v);
  },
  createExclusive: (p, d) => {
    if (localStorage.getItem(keyOf(p)) !== null) return false;
    localStorage.setItem(keyOf(p), d);
    return true;
  },
  unlink: (p) => localStorage.removeItem(keyOf(p)),
  exists: (p) => localStorage.getItem(keyOf(p)) !== null,
  mkdir: () => undefined,
};

function manifest(id: string, name: string, description: string, icon: string, at: string): string {
  return JSON.stringify(
    {
      v: 2,
      id,
      name,
      description,
      icon,
      entry: { cmd: 'node', args: ['main.mjs'] },
      params: [{ key: 'cookie', label: '登录凭据', type: 'secret', required: false }],
      defaultRules: [{ id: `r-${id}`, trigger: { kind: 'daily', at }, action: { kind: 'run' } }],
    },
    null,
    2,
  );
}

function seed(): void {
  if (localStorage.getItem(SEED_FLAG)) return;
  const tools = [
    { id: 'demo-signin', name: '每日签到', desc: '把签到和分享做完，记下积分', icon: 'calendar-check', at: '09:30' },
    { id: 'demo-radar', name: '比价雷达', desc: '挑十元内的好评游戏，比一遍渠道价', icon: 'radar', at: '12:00' },
  ];
  for (const t of tools) {
    const dir = `${ROOT}/${t.id}`;
    localStorage.setItem(keyOf(`${dir}/manifest.json`), manifest(t.id, t.name, t.desc, t.icon, t.at));
  }
  const runs = [
    { runId: 'r-seed-1', tool: 'demo-signin', trigger: 'auto', status: 'ok', startedAt: new Date(Date.now() - 3600_000).toISOString(), durationMs: 42_000, message: '签到成功，积分 +12' },
    { runId: 'r-seed-2', tool: 'demo-signin', trigger: 'auto', status: 'failed', startedAt: new Date(Date.now() - 86_400_000).toISOString(), durationMs: 9000, message: '凭据过期', error: { kind: 'auth' } },
    { runId: 'r-seed-3', tool: 'demo-radar', trigger: 'manual', status: 'ok', startedAt: new Date(Date.now() - 7200_000).toISOString(), durationMs: 61_000, message: '捡到 3 款' },
  ];
  for (const r of runs) {
    const p = `${ROOT}/${r.tool}/runs.jsonl`;
    const prev = localStorage.getItem(keyOf(p)) ?? '';
    localStorage.setItem(keyOf(p), prev + JSON.stringify(r) + '\n');
  }
  localStorage.setItem(
    keyOf('/sim-vault/CONFIG/STORAGE/dock.json'),
    JSON.stringify(
      {
        v: 3,
        tools: tools.map((t) => ({ id: t.id, path: `${ROOT}/${t.id}/manifest.json` })),
        autoRun: true,
        watchdog: true,
        notifyMissed: true,
      },
      null,
      2,
    ),
  );
  localStorage.setItem(SEED_FLAG, '1');
}

function boot(): void {
  seed();
  setApp(new FakeApp() as never);
  setSettingsProvider(() => ({}) as never);
  setSettingsSaver(async () => undefined);
  setDockFs(simFs);
}

declare global {
  interface Window {
    BZW_dock?: {
      boot: () => void;
      openDock: () => void;
      closeDock: () => void;
      unloadDock: () => void;
    };
  }
}

window.BZW_dock = {
  boot,
  openDock: () => openDock(getApp()),
  closeDock,
  unloadDock,
};

export { boot, openDock, closeDock, unloadDock };
