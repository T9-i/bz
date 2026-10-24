/**
 * 执行层 —— 起进程、注入工单号、读心跳、判结果。
 *
 * 这一层只有一个判断题：**「这次到底干成没有」**。上一版把它写了两遍（插件一遍、值守一遍），
 * 靠注释提醒彼此对齐，结果两次误报都出在这儿。现在只有一个 `judgeRun`，
 * 插件、值守、测试全调它。
 *
 * 判定顺序（定死，不许再各自发挥）：
 *  1) 用户点了停止 → `stopped`（那是他的动作，工具写什么都不改变这件事）；
 *  2) 到点被强杀 → `timeout`；
 *  3) 按 **runId** 找工具自己写的那条记录 —— 找到就听它的（它比 bz 更知道自己死在哪儿）；
 *  4) 找不到 → 按退出码推断，并**明确记下「这次没有记录」**。绝不拿上一条充数。
 */

import {
  runExternalTool,
  type BzAskRequest,
  type ExternalToolDeps,
  type ExternalToolHandle,
  type ExternalToolSpec,
} from '../core/external-tool';
import { buildArgs, findByRunId, makeRunId, secretEnvOf } from './parse';
import { dirOf, pathOf } from './files';
import {
  CONTRACT_VERSION,
  RUN_TIMEOUT_MS,
  type DockErrorKind,
  type DockManifest,
  type DockOutcome,
  type DockRunRecord,
  type DockRunStatus,
  type DockRunStep,
} from './types';

// ==================== 工单号 ====================

export { makeRunId };

// ==================== 运行环境 ====================

export interface DockEnvInput {
  toolId: string;
  declPath: string;
  runId: string;
  trigger: 'auto' | 'manual';
  vaultPath?: string;
  manifest: Pick<DockManifest, 'params'> | null;
  values: Record<string, unknown>;
}

/**
 * 注入给工具进程的环境变量。
 *
 * `BZ_DOCK_RUN_ID` 是最要紧的那一个：工具必须把它原样写进 `runs.jsonl` 的那一行。
 * 有了它，对账是「查主键」；没有它，对账只能「看时间差不多」—— 那是猜。
 *
 * 凭据走独立的环境变量（`BZ_DOCK_SECRET_*`），不走命令行：命令行在任务管理器里人人可见。
 */
export function dockEnv(input: DockEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    BZ_DOCK_CONTRACT: String(CONTRACT_VERSION),
    BZ_DOCK_TOOL: input.toolId,
    BZ_DOCK_RUN_ID: input.runId,
    BZ_DOCK_TRIGGER: input.trigger,
    BZ_DOCK_RUNS_FILE: pathOf.runs(input.declPath),
    BZ_DOCK_HEARTBEAT_FILE: pathOf.heartbeat(input.declPath),
  };
  if (input.vaultPath) env.BZ_DOCK_VAULT = input.vaultPath.replace(/[\\/]+$/, '');
  if (input.manifest) Object.assign(env, secretEnvOf(input.manifest, input.values));
  return env;
}

// ==================== 判定 ====================

export interface JudgeInput {
  runId: string;
  toolId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  code: number | null;
  signal?: string | null;
  stopped: boolean;
  timedOut: boolean;
  error: Error | null;
  stderr: string;
}

/**
 * 这一次到底干成没有 —— **全仓唯一判定**。纯函数。
 *
 * `records` 是这个工具最近的记录（调用方从 runs.jsonl 尾部读来）。只看 `runId` 相等的那条。
 */
export function judgeRun(input: JudgeInput, records: readonly DockRunRecord[]): DockOutcome {
  const base = {
    runId: input.runId,
    code: input.code,
    signal: input.signal,
    stderr: input.stderr,
    error: input.error,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
  };

  // 1) 人掐的 —— 工具写什么都不算数
  if (input.stopped) {
    return { ...base, ok: false, status: 'stopped', kind: 'aborted', record: findByRunId(records, input.runId) };
  }
  // 2) 到点强杀
  if (input.timedOut) {
    return { ...base, ok: false, status: 'timeout', kind: 'timeout', record: findByRunId(records, input.runId) };
  }

  const record = findByRunId(records, input.runId);

  // 3) 有记录 —— 以记录为准
  if (record) {
    // 进程都结束了，记录还写着 running：工具没来得及收尾（被系统杀掉 / 自己崩在收尾）
    const status: DockRunStatus = record.status === 'running' ? 'abandoned' : record.status;
    return {
      ...base,
      ok: status === 'ok',
      status,
      kind: record.error?.kind ?? (status === 'ok' ? 'unknown' : 'unknown'),
      record: { ...record, status },
    };
  }

  // 4) 没记录 —— 按退出码推断，并且把「没记录」这件事说清楚
  const ok = input.code === 0 && !input.error;
  const kind: DockErrorKind = input.code === null ? 'config' : 'unknown';
  return {
    ...base,
    ok,
    status: ok ? 'ok' : 'failed',
    kind,
    recordMissing:
      input.code === null
        ? '进程没能启动（命令或工作目录配错了）'
        : '工具没写这次运行的记录，多半没跑到写记录那一步',
  };
}

/** 失败分类 → 人话建议 */
export function hintOf(kind: DockErrorKind, recordMissing?: string): string {
  if (recordMissing) return recordMissing;
  switch (kind) {
    case 'auth':
      return '登录态失效了，去重新填一次凭据';
    case 'network':
      return '网络不通，检查代理或稍后重试';
    case 'config':
      return '命令或参数配错了，检查启动命令与工作目录';
    case 'timeout':
      return '跑超时了，可能是网络慢或任务量变大';
    case 'aborted':
      return '被手动中止';
    default:
      return '打开运行记录看 stderr 尾部';
  }
}

export function statusText(status: DockRunStatus): string {
  switch (status) {
    case 'ok':
      return '成功';
    case 'failed':
      return '失败';
    case 'timeout':
      return '超时';
    case 'stopped':
      return '已中止';
    case 'abandoned':
      return '没收尾';
    case 'running':
      return '运行中';
  }
}

// ==================== 在场运行 ====================

export interface LiveRun {
  runId: string;
  toolId: string;
  trigger: 'auto' | 'manual';
  startedAt: string;
  steps: DockRunStep[];
  phase: string | null;
  pct: number | null;
  /** 原始输出尾部（诊断用，只进内存） */
  rawTail: string[];
  handle: ExternalToolHandle;
  done: Promise<DockOutcome>;
}

export interface RunCallbacks {
  onStep?(text: string): void;
  onProgress?(phase: string | null, pct: number | null): void;
  onInfo?(data: Record<string, unknown>): void;
  onResult?(data: Record<string, unknown>): void;
  /** 工具问人：不给 = 无人可问，立即按取消回 */
  onAsk?(req: BzAskRequest): Promise<boolean> | boolean;
  onDone?(outcome: DockOutcome): void;
}

let deps: ExternalToolDeps | undefined;
export function setExecDeps(d: ExternalToolDeps | undefined): void {
  deps = d;
}

const live = new Map<string, LiveRun>();
const listeners = new Set<() => void>();

export function liveOf(toolId: string): LiveRun | undefined {
  return live.get(toolId);
}
export function liveAll(): LiveRun[] {
  return Array.from(live.values()).sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0));
}
export function onLiveChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function fireLive(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* 订阅方出错不该影响运行 */
    }
  }
}

export function stopLive(toolId: string): void {
  live.get(toolId)?.handle.stop();
}

/** 跑一次（在场）。前置条件由调用方保证：有 entry、已授权、桌面端、本工具没在跑 */
export function runToolNow(args: {
  toolId: string;
  declPath: string;
  entry: { cmd: string; args?: string[]; cwd?: string; shell?: boolean };
  manifest: Pick<DockManifest, 'params'> | null;
  values: Record<string, unknown>;
  vaultPath?: string;
  trigger?: 'auto' | 'manual';
  extraArgs?: string[];
  timeoutMs?: number;
  /**
   * 工单号。**自动运行必须传**：内核在落 pending 时就已经定下这个号，
   * 账本记的、注入给工具的、收尾结算的必须是同一个 —— 各造一个就等于白记。
   * 不传（手动运行、命令行自测）才自己生成。
   */
  runId?: string;
  /** 判定时要用这个工具最近的记录 */
  records: () => readonly DockRunRecord[];
  cb?: RunCallbacks;
}): LiveRun {
  const runId = args.runId ?? makeRunId();
  const trigger = args.trigger ?? 'manual';
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const rawTail: string[] = [];
  const steps: DockRunStep[] = [];

  const spec: ExternalToolSpec = {
    cmd: args.entry.cmd,
    args: [...(args.entry.args ?? []), ...buildArgs(args.manifest ?? { params: [] }, args.values), ...(args.extraArgs ?? [])],
    shell: args.entry.shell ?? /\.(cmd|bat)$/i.test(args.entry.cmd),
    /**
     * 工作目录，契约写的是「缺省 = 声明所在目录」。
     *
     * 这一句必须显式给：不给的话子进程继承宿主进程的 cwd —— 插件里是 Obsidian 的目录，
     * 值守里是仓库根。两种都不是工具目录，「`args: ['main.mjs']` 的相对路径」当场失效，
     * 症状是「面板上跑得起来、值守里报找不到文件」。
     */
    cwd: args.entry.cwd ?? dirOf(args.declPath),
    env: dockEnv({
      toolId: args.toolId,
      declPath: args.declPath,
      runId,
      trigger,
      vaultPath: args.vaultPath,
      manifest: args.manifest,
      values: args.values,
    }),
    interactive: typeof args.cb?.onAsk === 'function',
  };

  let phase: string | null = null;
  let pct: number | null = null;
  let timedOut = false;
  /** 回调里要回程，但 handle 是调用返回之后才有的 —— 用一个可空引用兜住这个先后 */
  let handleRef: ExternalToolHandle | null = null;

  const handle = runExternalTool(
    spec,
    {
      onStep: (text) => {
        steps.push({ text, at: new Date().toISOString(), status: 'ok' });
        args.cb?.onStep?.(text);
      },
      onProgress: (p, v) => {
        phase = p;
        pct = v;
        args.cb?.onProgress?.(p, v);
      },
      onInfo: (d) => args.cb?.onInfo?.(d),
      onResult: (d) => args.cb?.onResult?.(d),
      onRaw: (t) => {
        rawTail.push(t);
        if (rawTail.length > 200) rawTail.shift();
      },
      onAsk: (req) => {
        const ask = args.cb?.onAsk;
        if (!ask) {
          handleRef?.answer?.(req.id, false);
          return;
        }
        void Promise.resolve()
          .then(() => ask(req))
          .then((yes) => handleRef?.answer?.(req.id, !!yes))
          .catch(() => handleRef?.answer?.(req.id, false));
      },
    },
    deps,
  );
  handleRef = handle;

  const run: LiveRun = {
    runId,
    toolId: args.toolId,
    trigger,
    startedAt,
    steps,
    phase,
    pct,
    rawTail,
    handle,
    done: Promise.resolve(undefined as unknown as DockOutcome),
  };

  const timeoutMs = args.timeoutMs ?? RUN_TIMEOUT_MS;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    handle.stop();
  }, timeoutMs) : null;

  run.done = handle.done.then((o) => {
    if (timer) clearTimeout(timer);
    const finishedAt = new Date().toISOString();
    const outcome = judgeRun(
      {
        runId,
        toolId: args.toolId,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - startedMs,
        code: o.code,
        stopped: o.stopped && !timedOut,
        timedOut,
        error: o.error,
        stderr: o.stderr,
      },
      args.records(),
    );
    live.delete(args.toolId);
    fireLive();
    args.cb?.onDone?.(outcome);
    return outcome;
  });

  live.set(args.toolId, run);
  fireLive();
  return run;
}
