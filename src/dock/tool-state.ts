/**
 * 每个工具**自己的排期状态** —— 住 `<工具目录>/dock-state.json`，和 `manifest.json` /
 * `data.json` / `runs.json` 并排（ADR-0248）。
 *
 * 为什么不在 `dock.json`：那份是 bz 的**全局**账本 —— 三个全域开关 + 一张「有哪些工具」的索引。
 * 而规则表、规则记账、调度台账全是**某个工具的事实**：工具搬家、复制到另一台机器、整目录分享时
 * 应该跟着它走，不该留在 vault 的公共文件里互相串。（2026-10-20 用户口径：脚本自己的数据自己管，
 * `dock.json` 只存全局。）
 *
 * **写者仍然只有一个：bz**（含离线值守进程）。工具不许碰这个文件 —— 「一个文件一个写者」
 * 这条不变量不变，只是换了住处。工具目录里那份 `runs.json` 才是工具的，两者互不越界。
 *
 * 与 `registry.ts` 的分工：那边校验「这条登记合法吗」，这边只负责状态的形状与搬运；
 * 两边的字段口径必须一致（`DockToolEntry` 的状态字段就是这里 `DockToolState` 的超集）。
 *
 * 版本：`v` 不认识、或 `tool` 与本工具 id 不符（整目录被复制/改名后错认）一律当没写过 ——
 * 与本仓「不认识的版本拒绝、不猜」同口径。
 */

import { parseRules, parseRuleState, type DockRule } from './rules';
import { parseSchedule, type DockSchedule } from './schema';

/** 状态文件名（住工具目录，与声明/参数值/运行记录同一层） */
export const TOOL_STATE_FILENAME = 'dock-state.json';

/** 状态文件版本 */
export const TOOL_STATE_VERSION = 1;

/**
 * bz 对某个工具**调度视角**的记账 —— 自动尝试全记；手动侧只记**成功**（失败不入账）。
 *
 * **刻意不进工具的 `runs.json`**（那是工具唯一写者的地盘）：这里只记 bz 自己看到的事实 ——
 * 「bz 什么时候试着跑了一次、成没成」。它的存在是为了两件工具记录兜不住的事：
 * ① 工具崩了自己没落记录时，bz 仍知道「它跑过且失败」；② 连续失败熔断要有据可依。
 * 工具自己那份记录仍是**权威**（含 `error.kind`），这里只服务调度决策。
 * 手动成功同样入账（`recordRunSuccess`）：成功是「工具活着」的证据，不分谁拉起的；
 * 手动失败不入 —— 熔断保护的是没人盯着时的自动运行，别让人手动试错把它搞停。
 */
export interface DockToolRunState {
  /** bz 最近一次尝试的时刻（ISO）—— 自动尝试，或手动成功 */
  lastAttemptAt?: string;
  /** 那次尝试 bz 侧的判果（工具记录为权威，这里只判调度） */
  lastAttemptOk?: boolean;
  /** 连续自动失败次数（任一次成功即清零）—— 熔断依据；手动失败不计入 */
  consecutiveFailures?: number;
  /** 熔断触发时刻（ISO）；非空 = 自动运行已暂停，等用户在面板里手动恢复 */
  pausedAt?: string;
}

/** 一个工具在这台机器上的排期状态（文件的语义层；`dock-state.json` 里就是它 + `v` + `tool`） */
export interface DockToolState {
  /** 停用的工具仍登记在册，但面板不给运行入口 */
  enabled?: boolean;
  /** 自动运行总闸（缺省 = 开）。关掉 = 即使有规则也不自动跑，只在面板里手动点 */
  autoRun?: boolean;
  /** 节奏覆盖 —— 用户改过的节奏；缺省 = 用声明里的默认值（`effectiveSchedule`） */
  scheduleOverride?: DockSchedule;
  /** 建立覆盖时**声明那份节奏**的签名（`scheduleSignature`）—— 判断「作者后来改没改」用 */
  overrideDeclSig?: string;
  /**
   * **规则表 v2**：触发条件 → 执行。非空时它是唯一的调度事实源；`scheduleOverride`
   * 与声明里的 `schedule` 只在规则表为空时充当种子（读侧映射，不写盘迁移）。
   */
  rules?: DockRule[];
  /** 每条规则各自的记账（规则 id → 上次命中时刻 ISO）。调度器写，判据读 */
  ruleState?: Record<string, { lastFiredAt?: string }>;
  /** bz 侧调度台账（上次尝试 / 连续失败 / 是否熔断） */
  runState?: DockToolRunState;
}

/** 文件里的形状（`v` + `tool` + 上面那堆） */
export interface DockToolStateFile extends DockToolState {
  v: number;
  tool: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 规整一条台账（脏字段逐个丢，不抛） */
export function parseRunState(raw: unknown): DockToolRunState {
  if (!isPlainObject(raw)) return {};
  const out: DockToolRunState = {};
  if (typeof raw.lastAttemptAt === 'string' && raw.lastAttemptAt !== '') out.lastAttemptAt = raw.lastAttemptAt;
  if (typeof raw.lastAttemptOk === 'boolean') out.lastAttemptOk = raw.lastAttemptOk;
  if (typeof raw.consecutiveFailures === 'number' && Number.isInteger(raw.consecutiveFailures) && raw.consecutiveFailures > 0) {
    out.consecutiveFailures = raw.consecutiveFailures;
  }
  if (typeof raw.pausedAt === 'string' && raw.pausedAt !== '') out.pausedAt = raw.pausedAt;
  return out;
}

/**
 * 文件原文 → 状态（永不抛）。版本不认识、`tool` 与 id 不符 → `null`（当没写过）。
 * 认得的字段逐个校验，脏的丢掉 —— 与 `parseToolEntry` 同一条纪律。
 */
export function parseToolState(raw: unknown, toolId: string): DockToolState | null {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== TOOL_STATE_VERSION) return null;
  if (typeof raw.tool !== 'string' || raw.tool !== toolId) return null;

  const out: DockToolState = {};
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.autoRun === 'boolean') out.autoRun = raw.autoRun;
  const rules = parseRules(raw.rules);
  if (rules.length) out.rules = rules;
  const ruleState = parseRuleState(raw.ruleState);
  if (ruleState) out.ruleState = ruleState;
  const runState = parseRunState(raw.runState);
  if (Object.keys(runState).length) out.runState = runState;
  // 覆盖节奏与声明节奏**同一把尺子**校验（parseSchedule）；不合法就当没覆盖，回落声明默认
  const override = parseSchedule(raw.scheduleOverride);
  if (override) {
    out.scheduleOverride = override;
    if (typeof raw.overrideDeclSig === 'string' && raw.overrideDeclSig !== '') {
      out.overrideDeclSig = raw.overrideDeclSig;
    }
  }
  return out;
}

/** 从一条（合并视图的）登记里摘出该落进状态文件的那几个字段 */
export function toolStateOf(entry: DockToolState): DockToolState {
  const out: DockToolState = {};
  if (typeof entry.enabled === 'boolean') out.enabled = entry.enabled;
  if (typeof entry.autoRun === 'boolean') out.autoRun = entry.autoRun;
  if (entry.scheduleOverride) {
    out.scheduleOverride = entry.scheduleOverride;
    if (entry.overrideDeclSig !== undefined) out.overrideDeclSig = entry.overrideDeclSig;
  }
  if (entry.rules && entry.rules.length) out.rules = entry.rules;
  if (entry.ruleState) out.ruleState = entry.ruleState;
  if (entry.runState && Object.keys(entry.runState).length) out.runState = entry.runState;
  return out;
}

/** 落盘形态：`{v, tool, ...state}`（空状态也写 —— 文件在就说明「这工具归 bz 记账」） */
export function toolStateFileOf(toolId: string, state: DockToolState): DockToolStateFile {
  return { v: TOOL_STATE_VERSION, tool: toolId, ...toolStateOf(state) };
}
