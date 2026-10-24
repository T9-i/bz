/**
 * 工具坞契约 v2 —— **形状与常量**。零依赖、零宿主 API，node 可直跑。
 *
 * 这一版是推倒重写，**不认旧形状**：旧 `dock-state.json` / `runs.json` / 带 `schedule` 的声明
 * 一律当不存在。宁可让人重新登记一次，也不背着一堆「读到旧文件就回落」的分支走路 ——
 * 那些分支正是上一版说不清问题的来源。
 *
 * 五份文件，一个工具一套，全在工具目录里（搬目录即搬一切）：
 *
 * | 文件 | 谁写 | 是什么 |
 * |---|---|---|
 * | `manifest.json` | 工具作者手写 | 我是谁 / 参数表 / 怎么启动 / 默认规则 |
 * | `data.json` | bz | 用户填的参数**值** |
 * | `runs.jsonl` | 工具 | 运行记录，**只追加**，一行一次 |
 * | `heartbeat.json` | 工具 | 跑着的时候每几秒盖个时间戳 |
 * | `panel.html` | 工具 | 详情页那块展示板（可选） |
 *
 * bz 侧另有两份，**各有一个写者**：
 *
 * | 文件 | 谁写 | 是什么 |
 * |---|---|---|
 * | `dock.intent.json` | 面板（人） | 停用 / 自动运行 / 规则表 |
 * | `dock.runtime.json` | 调度内核 | 每条规则跑到哪了、失败几次、下一拍什么时候 |
 *
 * 「两个写者写同一份文件」这个老毛病就是靠这条切开解决的：**意图归人，事实归机器**。
 */

/** 契约版本。声明里写了别的数 → 整份不认（不猜、不迁移） */
export const CONTRACT_VERSION = 2;

/** 声明文件名（工具目录） */
export const DECLARATION_FILENAME = 'manifest.json';
/** 参数值文件名（bz 写） */
export const SETTINGS_FILENAME = 'data.json';
/** 运行记录文件名（工具写，JSON Lines） */
export const RUNS_FILENAME = 'runs.jsonl';
/** 心跳文件名（工具写） */
export const HEARTBEAT_FILENAME = 'heartbeat.json';
/** 展示板文件名（工具写，bz 只读） */
export const PANEL_FILENAME = 'panel.html';
/** 意图文件名（bz 面板写） */
export const INTENT_FILENAME = 'dock.intent.json';
/** 运行事实文件名（bz 调度内核写） */
export const RUNTIME_FILENAME = 'dock.runtime.json';
/** 执行权锁文件名（两个宿主抢它，谁拿到谁干活） */
export const LOCK_FILENAME = 'dock.lock';

/** 登记表文件名（住数据目录，跟着 storagePath 走） */
export const REGISTRY_FILENAME = 'dock.json';
/** 登记表版本 */
export const REGISTRY_VERSION = 3;

/** 参数值文件版本 */
export const SETTINGS_VERSION = 2;
/** 意图文件版本 */
export const INTENT_VERSION = 1;
/** 运行事实文件版本 */
export const RUNTIME_VERSION = 1;

/** 运行记录保留条数（**工具自己裁**；bz 只读不删） */
export const RUNS_KEEP = 200;
/** 读运行记录时最多读尾部多少字节（防一份坏掉的超大文件把面板拖死） */
export const RUNS_TAIL_BYTES = 256 * 1024;

/** 心跳多久没动就当这次运行死了 */
export const HEARTBEAT_STALE_MS = 60_000;
/** 单次运行强杀线 */
export const RUN_TIMEOUT_MS = 10 * 60_000;
/** 执行权锁多久没续期就当持有者死了 */
export const LOCK_STALE_MS = 90_000;
/** 失败后的冷却 */
export const FAIL_COOLDOWN_MS = 15 * 60_000;
/** 连续失败几次熔断 */
export const BREAKER_THRESHOLD = 3;

/** 工具 id 的合法形态 */
export const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const TOOL_ID_MAX_LEN = 64;

// ==================== 声明 ====================

export type DockParamType =
  | 'text'
  | 'number'
  | 'bool'
  | 'choice'
  | 'path'
  | 'secret'
  | 'multiline'
  | 'multichoice';

export interface DockParam {
  key: string;
  /** 表单上的名字；缺省用 key */
  label?: string;
  type: DockParamType;
  required?: boolean;
  default?: string | number | boolean | string[];
  /** choice / multichoice 的候选 */
  options?: string[];
  /** 一句提示（表单下方小字） */
  hint?: string;
}

/** 怎么启动。**没有约定入口了** —— 不写 `entry` 就只能看不能跑（不猜） */
export interface DockEntry {
  cmd: string;
  args?: string[];
  /** 工作目录；缺省 = 声明文件所在目录 */
  cwd?: string;
  /** 经 shell 起（`.cmd` / `.bat` 必须）；缺省按扩展名判 */
  shell?: boolean;
}

export interface DockManifest {
  v: number;
  id: string;
  name: string;
  description?: string;
  /** lucide 图标名 */
  icon?: string;
  entry?: DockEntry;
  params?: DockParam[];
  /** 工具作者给的**默认规则**；用户第一次打开时抄进 intent（之后各走各的） */
  defaultRules?: DockRule[];
}

// ==================== 规则 ====================

export type DockTrigger =
  | { kind: 'daily'; at: string }
  | { kind: 'interval'; everyMin: number }
  | { kind: 'on-launch'; delayMin: number }
  | { kind: 'panel-open' }
  | { kind: 'tool-ok'; toolId: string }
  | { kind: 'tool-fail'; toolId: string }
  | { kind: 'domain-event'; channel: string }
  | { kind: 'file-change'; target: string }
  | { kind: 'value-threshold'; path: string; key: string; op: '>' | '<' | '='; value: number };

export type DockTriggerKind = DockTrigger['kind'];

export type DockAction =
  | { kind: 'run' }
  | { kind: 'remind' };

export interface DockRule {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: DockTrigger;
  action: DockAction;
  /** 到点后再随机等 0~N 分钟，用来错峰 */
  jitterMin?: number;
}

/** 触发类型清单（面板下拉的唯一来源） */
export const TRIGGER_KINDS: readonly DockTriggerKind[] = [
  'daily',
  'interval',
  'on-launch',
  'panel-open',
  'tool-ok',
  'tool-fail',
  'domain-event',
  'file-change',
  'value-threshold',
];

export const TRIGGER_LABEL: Record<DockTriggerKind, string> = {
  daily: '每天某时',
  interval: '每隔一段时间',
  'on-launch': '启动 Obsidian 后',
  'panel-open': '打开工具坞时',
  'tool-ok': '某个工具成功后',
  'tool-fail': '某个工具失败后',
  'domain-event': '某个事件发生时',
  'file-change': '某个目录有变动',
  'value-threshold': '某个数值达到条件',
};

// ==================== 运行记录 ====================

export type DockRunStatus = 'ok' | 'failed' | 'timeout' | 'stopped' | 'abandoned' | 'running';

export type DockErrorKind = 'auth' | 'network' | 'config' | 'timeout' | 'aborted' | 'unknown';

export interface DockRunStep {
  text: string;
  at: string;
  /** 这一步是不是坏事（工具可以标 failed） */
  status?: 'ok' | 'failed';
}

/**
 * 一行运行记录。**主键是 `runId`，由 bz 生成并注入**（`BZ_DOCK_RUN_ID`）——
 * 上一版靠「起跑时间差 2 秒」猜哪条是自己的，那是误报的根。
 */
export interface DockRunRecord {
  runId: string;
  tool: string;
  trigger: 'auto' | 'manual';
  status: DockRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  message?: string;
  error?: { kind: DockErrorKind; detail?: string; stderr?: string };
  steps?: DockRunStep[];
  info?: unknown[];
  result?: unknown;
  metrics?: Record<string, number>;
  artifacts?: { path: string; label?: string }[];
}

// ==================== bz 侧：意图与事实 ====================

/** 用户意图（面板写）。**没有运行记录、没有失败计数** */
export interface DockIntent {
  v: number;
  tool: string;
  enabled?: boolean;
  /** 这个工具参不参与自动运行（缺省 true） */
  autoRun?: boolean;
  rules?: DockRule[];
}

/** 一条规则的运行事实 */
export interface DockRuleRuntime {
  /** 上次真正跑完（或放弃）的时刻 */
  lastFiredAt?: string;
  /** 已经排上队但还没跑：`dueAt` 是**算好的到期时刻**，不是内存里的定时器 */
  /**
   * 已排上队、还没跑完的那一次。
   *
   * - `claimedAt`：排上队的时刻（**不是**起跑时刻 —— 抖动可能把它推到 12 小时后）
   * - `startedAt`：真正起跑的时刻。回收只看它：没有它的 pending 只是在等，不算卡住
   * - `attempts`：为了这同一个待办起过几次进程。崩了重跑是好事，无限重跑不是
   */
  pending?: { runId: string; dueAt: string; claimedAt: string; startedAt?: string; attempts?: number };
  /** 上一轮的结果（给「为什么没跑」用） */
  lastRunId?: string;
  lastStatus?: DockRunStatus;
}

export interface DockRunFacts {
  lastAttemptAt?: string;
  lastAttemptOk?: boolean;
  consecutiveFailures?: number;
  /** 非空 = 熔断，等人在面板里恢复 */
  pausedAt?: string;
}

/** 调度事实（内核写） */
export interface DockRuntime {
  v: number;
  tool: string;
  updatedAt?: string;
  rules?: Record<string, DockRuleRuntime>;
  run?: DockRunFacts;
}

/** 登记项：只记 bz 自己知道的两件事，其余全在声明里 */
export interface DockRegistryEntry {
  id: string;
  path: string;
}

export interface DockRegistry {
  v: number;
  tools: DockRegistryEntry[];
  /** 三个全域开关 */
  autoRun: boolean;
  watchdog: boolean;
  notifyMissed: boolean;
}

/** 一条登记 + 它读出来的东西（UI 与内核共用同一份视图） */
export interface DockToolView {
  id: string;
  path: string;
  dir: string;
  manifest: DockManifest | null;
  /** 声明读不出来时的人话 */
  error?: string;
  entry: DockEntry | null;
  params: DockParam[];
  values: Record<string, unknown>;
  intent: DockIntent;
  runtime: DockRuntime;
  rules: DockRule[];
  trusted: boolean;
  /** 声明里的启动签名与授权时的不一致 */
  trustStale: boolean;
  /** 最近一次运行（从 runs.jsonl 尾部找） */
  lastRun?: DockRunRecord;
  /** 在本机跑不跑得动（移动端 false；没有 entry 也 false） */
  runnable: boolean;
}

/** 一次运行的结果（bz 侧判定，已与工具记录对账） */
export interface DockOutcome {
  ok: boolean;
  status: DockRunStatus;
  runId: string;
  code: number | null;
  signal?: string | null;
  stderr: string;
  error: Error | null;
  kind: DockErrorKind;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** 工具自己那条记录（找不到就是 undefined —— 不是「读不到」） */
  record?: DockRunRecord;
  /** 记录缺失的原因（人话） */
  recordMissing?: string;
}
