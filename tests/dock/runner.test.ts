// @vitest-environment node
/**
 * runner（在场运行）—— 这里只测注入给外部进程的环境变量。
 *
 * 钉的是一条**真出过的缺陷**及其后的模型修订：`BZ_DOCK_RUNS_FILE` 曾经给的是 vault 内相对
 * 路径（`CONFIG/STORAGE/dock/runs/<id>.json`），而工具进程的 cwd 是它自己的目录 —— 于是记录
 * 被写进了 `<工具目录>/CONFIG/...`，bz 在 vault 里读不到，表现成「跑完了却没有运行记录」。
 *
 * 修法不是「把相对路径改绝对」，而是**记录改住工具目录**（spec D9/D10 修订）：路径由声明文件
 * 的位置推出，天生绝对，也天生与 vault 无关。外部进程拿到的路径一律必须绝对。
 */
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { App } from 'obsidian';
import {
  dockEnvOf,
  reconcileWithRecord,
  runTool,
  setDockRuntimeDeps,
  type DockRunOutcome,
} from '../../src/dock/runner';
import { setDockFs } from '../../src/dock/declaration';
import type { DockToolEntry } from '../../src/dock/data';

const ENTRY = { id: 'iamtxt-signin', path: 'E:/tools/daily-signin/manifest.json' };

/** 只兑现 runner 用到的那一个面：`vault.adapter.getBasePath` */
function fakeApp(basePath?: string): App {
  return {
    vault: { adapter: basePath === undefined ? {} : { getBasePath: () => basePath } },
  } as unknown as App;
}

describe('dockEnvOf —— 注入给工具进程的环境', () => {
  it('运行记录路径 = 声明文件同目录下的 runs.json（绝对、工具侧）', () => {
    const env = dockEnvOf(ENTRY, fakeApp('E:/Obsidian/叫我包仔'));
    expect(env.BZ_DOCK_RUNS_FILE).toBe('E:/tools/daily-signin/runs.json');
  });

  it('记录路径不靠 vault 推 —— 拿不到 vault 根也照给', () => {
    const env = dockEnvOf(ENTRY, fakeApp(undefined));
    expect(env.BZ_DOCK_RUNS_FILE).toBe('E:/tools/daily-signin/runs.json');
  });

  it('vault 根可用时仍暴露 BZ_DOCK_VAULT（便利面，去掉尾分隔符）', () => {
    expect(dockEnvOf(ENTRY, fakeApp('E:/Obsidian/叫我包仔/')).BZ_DOCK_VAULT).toBe(
      'E:/Obsidian/叫我包仔',
    );
    expect(dockEnvOf(ENTRY, fakeApp(undefined)).BZ_DOCK_VAULT).toBeUndefined();
  });

  it('契约与工具标识恒在', () => {
    const env = dockEnvOf(ENTRY, fakeApp('E:/v'));
    expect(env.BZ_DOCK_CONTRACT).toBe('1');
    expect(env.BZ_DOCK_TOOL).toBe('iamtxt-signin');
  });

  it('触发器缺省 manual；调度器拉起时注入 auto（工具据此给记录标 trigger）', () => {
    expect(dockEnvOf(ENTRY, fakeApp('E:/v')).BZ_DOCK_TRIGGER).toBe('manual');
    expect(dockEnvOf(ENTRY, fakeApp('E:/v'), 'auto').BZ_DOCK_TRIGGER).toBe('auto');
  });
});

/**
 * 与工具自己那条记录对账（issue 544）。
 *
 * 钉的是**一次真出过的误报**：工具记录里写着成功、进程却以非零码退出，bz 只看退出码，
 * 于是通知报「失败」，还把人支去「看运行记录里的 stderr 尾部」——那份记录里明明写着成功。
 * `classify()` 的注释一直承诺「两者不一致时以记录为准」，这里把那条承诺兑现。
 */
describe('reconcileWithRecord —— 通知之前跟工具的记录对一次账', () => {
  const RUNS_PATH = 'E:/tools/daily-signin/runs.json';

  /** 内存 fs，只兑现 readText（本函数只读） */
  function fsWith(runsText: string | null) {
    return {
      readText: (p: string) => (p === RUNS_PATH && runsText !== null ? runsText : null),
      writeText: () => undefined,
    };
  }

  function runsFile(records: Array<Record<string, unknown>>): string {
    return JSON.stringify({ v: 1, tool: 'iamtxt-signin', runs: records });
  }

  const record = (patch: Record<string, unknown> = {}) => ({
    runId: 'r1',
    trigger: 'manual',
    status: 'ok',
    startedAt: '2026-10-15T00:00:10.000Z',
    ...patch,
  });

  /** bz 的推断：进程非零退出 → 失败、kind unknown、无记录可依 */
  const inferred = (patch: Partial<DockRunOutcome> = {}): DockRunOutcome => ({
    ok: false,
    stopped: false,
    code: 1,
    stderr: '',
    error: null,
    kind: 'unknown',
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:12.000Z',
    durationMs: 12000,
    ...patch,
  });

  it('记录说成功 → 撤回 bz 的失败推断（正是那次误报）', () => {
    setDockFs(fsWith(runsFile([record()])));
    const out = reconcileWithRecord(inferred(), ENTRY.path);
    expect(out.ok).toBe(true);
    expect(out.recordStatus).toBe('ok');
    setDockFs(undefined);
  });

  it('记录说失败 → 改用记录里的 error.kind，提示语才对得上', () => {
    setDockFs(
      fsWith(
        runsFile([
          record({ status: 'failed', error: { kind: 'auth', detail: '登录态掉了' }, message: '没给 Cookie，签不了' }),
        ]),
      ),
    );
    const out = reconcileWithRecord(inferred({ ok: true, code: 0, kind: 'unknown' }), ENTRY.path);
    expect(out.ok).toBe(false);
    expect(out.kind).toBe('auth');
    expect(out.recordMessage).toBe('没给 Cookie，签不了');
    setDockFs(undefined);
  });

  it('记录早于本次起跑 → 不认（绝不拿上一条充数）', () => {
    setDockFs(fsWith(runsFile([record({ startedAt: '2026-10-14T00:00:10.000Z' })])));
    const out = reconcileWithRecord(inferred(), ENTRY.path);
    expect(out.ok).toBe(false); // 维持 bz 的推断
    expect(out.recordStatus).toBeNull();
    setDockFs(undefined);
  });

  it('本次运行没留记录 → recordStatus = null（通知据此改口径，不再支人去看记录）', () => {
    setDockFs(fsWith(runsFile([])));
    expect(reconcileWithRecord(inferred(), ENTRY.path).recordStatus).toBeNull();
    setDockFs(undefined);
  });

  it('记录文件读不到 / 是坏 JSON → 原样返回，不猜', () => {
    setDockFs(fsWith('{ 坏掉的'));
    const out = reconcileWithRecord(inferred(), ENTRY.path);
    expect(out.ok).toBe(false);
    // 与「这次没留记录」区分开：问不出 ≠ 没留下。前者不改变通知口径，后者会改。
    expect(out.recordStatus).toBeUndefined();
    setDockFs(undefined);
  });

  it('用户点过停止 → 不参与对账（是他掐的，工具写了什么记录都不改变这个事实）', () => {
    setDockFs(fsWith(runsFile([record()])));
    const out = reconcileWithRecord(inferred({ stopped: true }), ENTRY.path);
    expect(out.ok).toBe(false);
    expect(out.recordStatus).toBeUndefined();
    setDockFs(undefined);
  });

  it('同一次起跑留了多条 → 取最晚那条（后写的那条才代表最终结论）', () => {
    setDockFs(
      fsWith(
        runsFile([
          record({ runId: 'late', status: 'failed', startedAt: '2026-10-15T00:00:20.000Z' }),
          record({ runId: 'early', status: 'ok', startedAt: '2026-10-15T00:00:05.000Z' }),
        ]),
      ),
    );
    expect(reconcileWithRecord(inferred(), ENTRY.path).ok).toBe(false);
    setDockFs(undefined);
  });
});

// ==================== 询问的桥接（[bz-ask] → 人 → [bz-answer]） ====================

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 假子进程：stdout 可投喂，stdin 记账（断言回程那一行） */
class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  stdin = {
    destroyed: false,
    writableEnded: false,
    written: [] as string[],
    write(s: string) {
      this.written.push(s);
      return true;
    },
  };
  kill = vi.fn(() => true);
}

const LAUNCH = { cmd: 'steam-classify', args: ['main.mjs'], cwd: 'E:/tools/steam-classify', shell: false };
const ENTRY2: DockToolEntry = { id: 'steam-classify', path: 'E:/tools/steam-classify/manifest.json' };

/**
 * 钉的是一条**安全纪律**，不是功能：工具问人时若这一侧没人可问（自动触发没有 UI），
 * 答案是**取消**——「没人应答就当同意」没有第二种解释，那等于让一个无人值守的运行
 * 替用户关掉 Steam 并改他的库。
 */
describe('runTool 的询问桥接 —— 没人应答 = 取消', () => {
  it('没给 onAsk：立刻回 ok:false，并把「没人可问」说进步骤流（否则用户只看到工具自己认输了）', async () => {
    const child = new FakeProc();
    setDockRuntimeDeps({ cp: { spawn: () => child } as never });
    const steps: string[] = [];
    const run = runTool(fakeApp(), ENTRY2, LAUNCH, { params: [] }, {}, { onStep: (t) => steps.push(t) });
    child.stdout.emit('data', Buffer.from('[bz-ask] {"id":"apply","title":"写入 Steam 分类","body":"3 款"}\n'));
    expect(child.stdin.written).toEqual(['[bz-answer] {"id":"apply","ok":false}\n']);
    expect(steps.some((s) => s.includes('没人可问'))).toBe(true);
    child.emit('close', 0);
    await run.done;
    setDockRuntimeDeps(undefined);
  });

  it('给了 onAsk：答案原样回给工具（确认 / 取消都不改写；弹窗抛错也落到取消）', async () => {
    // ① 确认
    const child = new FakeProc();
    setDockRuntimeDeps({ cp: { spawn: () => child } as never });
    const run = runTool(fakeApp(), ENTRY2, LAUNCH, { params: [] }, {}, { onAsk: () => true });
    child.stdout.emit('data', Buffer.from('[bz-ask] {"id":"apply","title":"写入 Steam 分类"}\n'));
    await tick(); // 桥接是异步回写的（弹窗天然异步）
    expect(child.stdin.written).toEqual(['[bz-answer] {"id":"apply","ok":true}\n']);
    child.emit('close', 0);
    await run.done;

    // ② 弹窗那头自己炸了 → 也不能让工具悬着等
    const child2 = new FakeProc();
    setDockRuntimeDeps({ cp: { spawn: () => child2 } as never });
    const run2 = runTool(fakeApp(), ENTRY2, LAUNCH, { params: [] }, {}, {
      onAsk: () => {
        throw new Error('弹窗没了');
      },
    });
    child2.stdout.emit('data', Buffer.from('[bz-ask] {"id":"apply","title":"写入 Steam 分类"}\n'));
    await tick();
    expect(child2.stdin.written).toEqual(['[bz-answer] {"id":"apply","ok":false}\n']);
    child2.emit('close', 0);
    await run2.done;
    setDockRuntimeDeps(undefined);
  });

  it('interactive 只在有人可问时打开：不给 onAsk 的运行不该白开一条 stdin 管道', () => {
    const spawn = vi.fn(() => new FakeProc());
    setDockRuntimeDeps({ cp: { spawn } as never });
    runTool(fakeApp(), ENTRY2, LAUNCH, { params: [] }, {}, {});
    expect(spawn).toHaveBeenCalledWith(LAUNCH.cmd, LAUNCH.args, expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }));
    const spawn2 = vi.fn(() => new FakeProc());
    setDockRuntimeDeps({ cp: { spawn: spawn2 } as never });
    runTool(fakeApp(), ENTRY2, LAUNCH, { params: [] }, {}, { onAsk: () => false });
    expect(spawn2).toHaveBeenCalledWith(LAUNCH.cmd, LAUNCH.args, expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
    setDockRuntimeDeps(undefined);
  });
});
