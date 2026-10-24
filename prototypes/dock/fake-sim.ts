/**
 * 工具坞行为单源 · 评审壳启动入口。
 *
 * 与插件侧的差别只有「宿主」：真 `ui.ts` / `kernel.ts` / `exec.ts` 一行不改，只把
 *   - App 换成 FakeApp（fake vault 跑在 localStorage 上）；
 *   - `DockFs` 换成 localStorage 实现（工具目录在真实环境里是磁盘路径，浏览器里没有磁盘）；
 *   - `child_process` 换成一小段**会演戏的假进程**（吐步骤、写记录、盖心跳、然后退出）。
 *
 * 种子数据刻意覆盖面板上所有会出现的形态，评审时一眼能看到每种状态的写法：
 *
 * | 工具 | 演示的状态 |
 * |---|---|
 * | 每日签到 | 正常：已授权、有规则、有历史记录 |
 * | 比价雷达 | 正常 + 展示板（`panel.html`） |
 * | 笔记备份 | 未授权（能看不能跑） |
 * | 声明坏了 | 声明解析失败（面板要能说清坏在哪） |
 * | 缺参数 | 必填参数没填（自动运行会跳过并说明原因） |
 * | 连续失败 | 熔断中（面板给出「恢复自动运行」） |
 * | 后台在跑 | 心跳新鲜 → 状态点「正在跑」，运行按钮禁用 |
 * | 已停用 | 手动关掉的工具（卡片置灰） |
 *
 * 产物：`prototype-behavior.js` 挂 `window.BZW_dock`，壳只调 `boot` / `openDock`。
 */
import { FakeApp } from './fake/fake-obsidian';
import { getApp, setApp } from '../../src/core/app';
import { setSettingsProvider, setSettingsSaver } from '../../src/core/settings-provider';
import { setDockFs, setDockVaultRoot, type DockFs } from '../../src/dock/files';
import { setExecDeps } from '../../src/dock/exec';
import { runSignature } from '../../src/dock/parse';
import { openDock, closeDock, unloadDock } from '../../src/dock/ui';

// ==================== Buffer 垫片（core/external-tool 的行缓冲要它） ====================
// 只兑现 `BzLineSplitter` 真正用到的面：from / concat / length / indexOf / subarray / toString。
// 刻意**不**继承 Uint8Array：静态 `from` 的签名与 `Uint8ArrayConstructor.from` 不兼容（TS2417），
// 而这里根本不需要那个继承关系 —— 包一层字节数组即可。

class MiniBuffer {
  private bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  static from(input: string | Uint8Array, _encoding?: string): MiniBuffer {
    return input instanceof Uint8Array
      ? new MiniBuffer(input)
      : new MiniBuffer(new TextEncoder().encode(input));
  }
  static concat(parts: MiniBuffer[]): MiniBuffer {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p.bytes, off);
      off += p.length;
    }
    return new MiniBuffer(out);
  }
  get length(): number {
    return this.bytes.length;
  }
  indexOf(value: number, from = 0): number {
    for (let i = from; i < this.bytes.length; i++) if (this.bytes[i] === value) return i;
    return -1;
  }
  subarray(start = 0, end = this.bytes.length): MiniBuffer {
    return new MiniBuffer(this.bytes.subarray(start, end));
  }
  toString(_encoding?: string): string {
    return new TextDecoder().decode(this.bytes);
  }
}

function installBufferPolyfill(): void {
  const w = window as unknown as { Buffer?: unknown };
  if (!w.Buffer) w.Buffer = MiniBuffer;
}

const PREFIX = 'bz-sim:';
const VAULT = '/sim-vault';
const ROOT = `${VAULT}/CONFIG/SCRIPTS/DockTools`;
const SEED_FLAG = 'bz-dock-sim-seeded-v3';

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

// ==================== 种子 ====================

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();

interface SeedTool {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** 默认规则的触发时刻 */
  at?: string;
  params?: unknown[];
  /** 写的声明原文（不给就按上面的字段生成；用来演示「声明坏了」） */
  manifestRaw?: string;
  /** 展示板 HTML */
  panel?: string;
  values?: Record<string, unknown>;
  /** 意图：停用 / 只手动 */
  intent?: Record<string, unknown>;
  /** 运行账：熔断 / 上次状态 */
  runtime?: Record<string, unknown>;
  /** 心跳新鲜（演示「后台正在跑」） */
  beat?: { runId: string; step: string };
  runs?: Array<Record<string, unknown>>;
  /** 不写进信任表（演示「未授权」） */
  untrusted?: boolean;
}

const SEEDS: SeedTool[] = [
  {
    id: 'demo-signin',
    name: '每日签到',
    desc: '把签到和分享做完，记下积分',
    icon: 'calendar-check',
    at: '09:30',
    params: [
      { key: 'cookie', label: '登录凭据', type: 'secret', required: true, hint: '从浏览器开发者工具复制整串 Cookie' },
    ],
    values: { cookie: '已保存' },
    runs: [
      { runId: 'r-s1', trigger: 'auto', status: 'ok', startedAt: iso(2 * HOUR), durationMs: 42_000, message: '签到成功，积分 +12' },
      { runId: 'r-s2', trigger: 'auto', status: 'ok', startedAt: iso(DAY + 2 * HOUR), durationMs: 39_000, message: '签到成功，连续 7 天' },
      { runId: 'r-s3', trigger: 'auto', status: 'failed', startedAt: iso(2 * DAY), durationMs: 9000, message: '凭据过期', error: { kind: 'auth' } },
      { runId: 'r-s4', trigger: 'manual', status: 'ok', startedAt: iso(3 * DAY), durationMs: 41_000, message: '签到成功' },
      { runId: 'r-s5', trigger: 'auto', status: 'ok', startedAt: iso(4 * DAY), durationMs: 44_000, message: '签到成功' },
    ],
  },
  {
    id: 'demo-radar',
    name: '比价雷达',
    desc: '挑十元内的好评游戏，比一遍渠道价',
    icon: 'radar',
    at: '12:00',
    panel: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font:12px/1.6 system-ui;margin:0;padding:12px;color:#333;background:#faf9f7}
      h4{margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#8b6f4e}
      table{width:100%;border-collapse:collapse}
      td{padding:4px 0;border-bottom:1px solid #eee}
      .p{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
      .low{color:#b4472f}
    </style></head><body>
      <h4>本次最便宜的 3 款</h4>
      <table>
        <tr><td>Hades</td><td class="p low">¥8.4</td></tr>
        <tr><td>Stardew Valley</td><td class="p">¥9.9</td></tr>
        <tr><td>Hollow Knight</td><td class="p">¥9.5</td></tr>
      </table>
    </body></html>`,
    runs: [
      { runId: 'r-r1', trigger: 'manual', status: 'ok', startedAt: iso(3 * HOUR), durationMs: 61_000, message: '捡到 3 款' },
      { runId: 'r-r2', trigger: 'auto', status: 'ok', startedAt: iso(DAY + 3 * HOUR), durationMs: 58_000, message: '捡到 1 款' },
    ],
  },
  {
    id: 'demo-backup',
    name: '笔记备份',
    desc: '把库里的笔记打包推到网盘',
    icon: 'archive',
    at: '23:00',
    untrusted: true,
    runs: [],
  },
  {
    id: 'demo-broken',
    name: '声明坏了',
    desc: '用来演示「读不到声明」长什么样',
    icon: 'file-warning',
    manifestRaw: '{ "v": 2, "id": "demo-broken", "name": "声明坏了", ',
  },
  {
    id: 'demo-missing',
    name: '缺参数的活',
    desc: '必填参数没填，自动运行会被跳过',
    icon: 'key-round',
    at: '08:00',
    params: [{ key: 'token', label: '接口密钥', type: 'secret', required: true }],
    values: {},
  },
  {
    id: 'demo-failing',
    name: '连续失败',
    desc: '熔断中：面板应给出「恢复自动运行」',
    icon: 'triangle-alert',
    at: '07:00',
    runtime: {
      run: { lastAttemptAt: iso(20 * 60_000), lastAttemptOk: false, consecutiveFailures: 3, pausedAt: iso(20 * 60_000) },
      rules: {
        'r-demo-failing': { lastFiredAt: iso(20 * 60_000), lastStatus: 'failed', lastRunId: 'r-f1' },
      },
    },
    runs: [
      { runId: 'r-f1', trigger: 'auto', status: 'failed', startedAt: iso(20 * 60_000), durationMs: 3000, message: '接口 502' },
    ],
  },
  {
    id: 'demo-live',
    name: '后台在跑',
    desc: '心跳新鲜 → 卡片「正在跑」、运行按钮禁用',
    icon: 'activity',
    at: '06:00',
    beat: { runId: 'r-live-1', step: '正在抓第 12 页' },
    runs: [],
  },
  {
    id: 'demo-off',
    name: '已停用',
    desc: '手动关掉的工具，卡片置灰',
    icon: 'power',
    at: '05:00',
    intent: { enabled: false },
  },
];

function manifestOf(t: SeedTool): string {
  if (t.manifestRaw) return t.manifestRaw;
  return JSON.stringify(
    {
      v: 2,
      id: t.id,
      name: t.name,
      description: t.desc,
      icon: t.icon,
      entry: { cmd: 'node', args: ['main.mjs'] },
      ...(t.params ? { params: t.params } : {}),
      ...(t.at ? { defaultRules: [{ id: `r-${t.id}`, trigger: { kind: 'daily', at: t.at }, action: { kind: 'run' } }] } : {}),
    },
    null,
    2,
  );
}

/** 种子工具的信任表（每次装配都算一遍：它住内存设置，刷新页面会丢） */
function trustOfSeeds(): Record<string, { at: string; run: string }> {
  const out: Record<string, { at: string; run: string }> = {};
  const sig = runSignature({ cmd: 'node', args: ['main.mjs'] });
  for (const t of SEEDS) {
    if (t.untrusted || t.manifestRaw) continue;
    out[t.id] = { at: iso(DAY * 3), run: sig };
  }
  return out;
}

function seed(): void {
  if (localStorage.getItem(SEED_FLAG)) return;

  // 从旧版本升上来的演示数据一律清掉：种子形态换过，混着看会得出错误结论
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  }

  for (const t of SEEDS) {
    const dir = `${ROOT}/${t.id}`;
    localStorage.setItem(keyOf(`${dir}/manifest.json`), manifestOf(t));
    if (t.panel) localStorage.setItem(keyOf(`${dir}/panel.html`), t.panel);
    if (t.values) {
      localStorage.setItem(keyOf(`${dir}/data.json`), JSON.stringify({ v: 2, tool: t.id, values: t.values }, null, 2));
    }
    if (t.intent) {
      localStorage.setItem(
        keyOf(`${dir}/dock.intent.json`),
        JSON.stringify({ v: 1, tool: t.id, ...t.intent }, null, 2),
      );
    }
    if (t.runtime) {
      localStorage.setItem(
        keyOf(`${dir}/dock.runtime.json`),
        JSON.stringify({ v: 1, tool: t.id, ...t.runtime, updatedAt: iso(0) }, null, 2),
      );
    }
    if (t.beat) {
      localStorage.setItem(
        keyOf(`${dir}/heartbeat.json`),
        JSON.stringify({ runId: t.beat.runId, at: iso(3000), step: t.beat.step }),
      );
    }
    for (const r of t.runs ?? []) {
      const p = `${dir}/runs.jsonl`;
      const prev = localStorage.getItem(keyOf(p)) ?? '';
      localStorage.setItem(keyOf(p), prev + JSON.stringify({ tool: t.id, ...r }) + '\n');
    }
  }

  localStorage.setItem(
    keyOf(`${VAULT}/CONFIG/STORAGE/dock.json`),
    JSON.stringify(
      {
        v: 3,
        // 演示可移植形态：登记表跟着库走，换台机器也读得到（`vault:CONFIG/...`）
        tools: SEEDS.map((t) => ({
          id: t.id,
          path: `vault:CONFIG/SCRIPTS/DockTools/${t.id}/manifest.json`,
        })),
      },
      null,
      2,
    ),
  );

  localStorage.setItem(SEED_FLAG, '1');
}

// ==================== 假子进程：把「运行」演完 ====================

/** 事件源的最小实现（浏览器里没有 node 的 EventEmitter） */
class Bus {
  private handlers = new Map<string, Array<(arg?: unknown) => void>>();
  on(evt: string, cb: (arg?: unknown) => void): this {
    if (!this.handlers.has(evt)) this.handlers.set(evt, []);
    this.handlers.get(evt)!.push(cb);
    return this;
  }
  emit(evt: string, arg?: unknown): void {
    for (const cb of this.handlers.get(evt) ?? []) cb(arg);
  }
}

const DEMO_STEPS = [
  '打开登录页',
  '已登录，读到今日任务',
  '提交签到',
  '分享一次',
  '写运行记录',
];

/**
 * 假 spawn —— 让评审壳里的「运行」是一条完整的现场：步骤一行行出现、心跳在跳、
 * 记录最后落进 `runs.jsonl`、面板自己刷新。
 *
 * 它演的是**契约要求的行为**，不是 ui 的特例：走 `[bz-step]` 协议、工单号用注入的那个、
 * 记录只写终态。所以演示里看到的形态，和真工具跑起来是同一个。
 */
const fakeCp = {
  spawn(_cmd: string, _args: string[], opts: { env?: Record<string, string> } = {}) {
    const env = opts.env ?? {};
    const runId = env.BZ_DOCK_RUN_ID ?? 'local';
    const runsFile = env.BZ_DOCK_RUNS_FILE ?? '';
    const beatFile = env.BZ_DOCK_HEARTBEAT_FILE ?? '';
    const toolId = env.BZ_DOCK_TOOL ?? '';

    const stdout = new Bus();
    const stderr = new Bus();
    const child = new Bus() as Bus & {
      stdout: Bus;
      stderr: Bus;
      stdin: { write: () => void; end: () => void; destroyed: boolean; writableEnded: boolean; on: () => void };
      pid: number;
      kill: () => void;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.pid = 9000 + Math.floor(Math.random() * 900);
    child.stdin = { write: () => undefined, end: () => undefined, destroyed: false, writableEnded: false, on: () => undefined };

    const startedAt = new Date().toISOString();
    let killed = false;
    const beat = (step: string): void => {
      if (beatFile) {
        localStorage.setItem(
          keyOf(beatFile),
          JSON.stringify({ runId, at: new Date().toISOString(), step }),
        );
      }
    };
    child.kill = () => {
      killed = true;
    };

    let i = 0;
    const tick = (): void => {
      if (killed) return;
      if (i < DEMO_STEPS.length) {
        const text = DEMO_STEPS[i];
        i += 1;
        beat(text);
        stdout.emit('data', `[bz-step] ${text}\n`);
        window.setTimeout(tick, 700);
        return;
      }
      // 收尾：只写终态（契约：跑着的时候由心跳表达，不写 running 行）
      const finishedAt = new Date().toISOString();
      if (runsFile) {
        const prev = localStorage.getItem(keyOf(runsFile)) ?? '';
        localStorage.setItem(
          keyOf(runsFile),
          prev +
            JSON.stringify({
              runId,
              tool: toolId,
              trigger: env.BZ_DOCK_TRIGGER ?? 'manual',
              status: 'ok',
              startedAt,
              finishedAt,
              durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
              message: '演练完成（评审壳，没有真跑）',
            }) +
            '\n',
        );
      }
      child.emit('exit', 0);
      child.emit('close', 0);
    };

    // 起跑先盖一次心跳：面板在第一步之前就该知道「它已经在跑了」
    beat('刚起跑');
    window.setTimeout(tick, 400);
    return child;
  },
};

// ==================== 装配 ====================

/** 内存里的插件设置（信任表住这儿 —— 它本来就不进 vault） */
let settings: Record<string, unknown> = {};

function boot(): void {
  installBufferPolyfill();
  seed();
  if (!localStorage.getItem(keyOf(`${VAULT}/CONFIG/STORAGE/dock.json`))) {
    // 数据被清空了但种子标记还在（手动清 localStorage 的常见结果）→ 重新种一次
    localStorage.removeItem(SEED_FLAG);
    seed();
  }
  // 信任表住内存：它本来就不进 vault（跟着库走等于把「已授权执行这条命令」一起送人）
  settings = { storagePath: 'CONFIG/STORAGE', dockTrust: trustOfSeeds() };

  setApp(new FakeApp() as never);
  setSettingsProvider(() => settings as never);
  setSettingsSaver(async () => undefined);
  setDockFs(simFs);
  setExecDeps({ cp: fakeCp } as never);
  // 与真插件一致：登记表里的 `vault:` 形态要靠库根还原
  setDockVaultRoot(VAULT);
}

declare global {
  interface Window {
    BZW_dock?: {
      boot: () => void;
      openDock: () => void;
      closeDock: () => void;
      unloadDock: () => void;
    };
    /** 评审壳的自检读它来判断「种子里有几个工具」—— 壳里不硬编码，改种子不用改壳 */
    DOCK_SEED?: { total: number; ids: string[] };
  }
}

window.DOCK_SEED = { total: SEEDS.length, ids: SEEDS.map((t) => t.id) };

window.BZW_dock = {
  boot,
  openDock: () => openDock(getApp()),
  closeDock,
  unloadDock,
};

export { boot, openDock, closeDock, unloadDock };
