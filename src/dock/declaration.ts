/**
 * 声明文件与设置文件 —— **工具侧的两份文件**（spec D4 修订：声明不再靠 `--manifest` 子命令）。
 *
 * | 文件 | 位置 | 谁写 | 内容 |
 * |---|---|---|---|
 * | `manifest.json` | 工具目录 | **工具作者**（手写） | 标题 / 描述 / 参数定义 / 节奏 / 启动命令 |
 * | `data.json` | 工具目录 | **bz**（面板表单） | 用户填的参数**值** |
 *
 * 文件名按 Obsidian 插件惯例（ADR-0237）：工具目录与 `.obsidian/plugins/<id>/` 同构 ——
 * manifest 自我介绍、`main.mjs` 是约定入口、`data.json` 是 bz 的账本、`runs.json` 留痕。
 * **旧名（`dock.json` / `dock.settings.json` / `dock.runs.json`）读侧一律回落认**：
 * 已有工具零迁移；回落只救「新名文件不在」，新名在但无效时以新名为准（不绕过它说的话）。
 * bz 的**写**只落新名；参数值写成功后顺手清掉旧名残留（凭据不两处落盘）。
 *
 * 三条设计意图：
 *
 * 1) **声明文件是元数据的唯一真理源**。bz 不缓存它 —— 缓存会过期，而「过期」这件事本身
 *    就是缺陷的来源（曾经真的发生过：脚本改了声明，vault 里那份旧缓存还在，面板照着旧
 *    缓存渲染出早就删掉的参数）。读文件很便宜，所以直接读。
 *    更要紧的是：**读文件不执行任何东西**，所以「先看清它会跑什么，再决定信不信任」
 *    这个顺序才成立。原先靠 `--manifest` 子命令自描述，就必须先信任才能执行那条命令 ——
 *    等于蒙着眼签字。
 *
 * 2) **参数值住在工具侧**。Cookie 这类凭据不进 vault：不跟着 vault 同步、不进 git、
 *    不落运行记录。bz 只负责按声明的参数表渲染表单、把值写回这个文件，运行前再通过
 *    `--key=value` 下发给进程（工具不必读这个文件 —— 它是 bz 的账本，住得离工具近而已）。
 *
 * 3) **约定优于配置只此一条**：声明没写 `run` 段、目录里有 `main.mjs`，就视为
 *    `node main.mjs`。只认这一个名字 —— `.mjs` 让 Node 无条件按 ES Module 解析，
 *    不依赖目录里有没有 `package.json`（`.js` 在没有 package.json 的目录里默认 CommonJS，
 *    ESM 语法直接报错）。其它运行时（python 等）必须自己写 `run` 段 —— 不猜。
 *
 * fs 走注入缝：插件侧 `window.require('fs')`，评审壳 / node 测试塞假件（本仓既有范式，
 * 见 `people/prep.ts` 的 `PrepFs`）。
 */

import { parseJsonObjectText, parseManifest, type DockManifest, type DockRunSpec } from './schema';
import {
  TOOL_STATE_FILENAME,
  TOOL_STATE_VERSION,
  parseToolState,
  toolStateFileOf,
  type DockToolState,
} from './tool-state';

/** 声明文件名（固定在工具目录下；名字是契约的一部分） */
export const DECLARATION_FILENAME = 'manifest.json';

/** 声明文件旧名（ADR-0237 之前；读侧回落认，bz 不再往这个名字写任何东西） */
export const DECLARATION_FILENAME_LEGACY = 'dock.json';

/** 参数值文件名（bz 写；固定在声明文件同目录） */
export const SETTINGS_FILENAME = 'data.json';

/** 参数值文件旧名（ADR-0237 之前；读侧回落认；写参数值成功后会被清掉） */
export const SETTINGS_FILENAME_LEGACY = 'dock.settings.json';

/** 运行记录文件名（**工具写、bz 只读**；固定在声明文件同目录 —— spec D10 修订） */
export const RUNS_FILENAME = 'runs.json';

/** 运行记录文件旧名（ADR-0237 之前；工具还没跟新契约写新名时，读侧回落认） */
export const RUNS_FILENAME_LEGACY = 'dock.runs.json';

/** 约定入口文件名：声明没写 `run` 段时，目录里有它就视为 `node main.mjs`（ADR-0237） */
export const MAIN_ENTRY_FILENAME = 'main.mjs';

/**
 * 展示板文件名（**工具写、bz 只读**，ADR-0243）：工具自己画的一块内容，详情页里内嵌在
 * 「运行台」上方那块区域。单文件自包含 —— 样式与图片都要内联进去，外链在这个语境里拿不到。
 */
export const PANEL_FILENAME = 'panel.html';

/** 设置文件版本（不认识的版本视为没有值，不猜） */
export const DOCK_SETTINGS_VERSION = 1;

// ==================== fs 缝 ====================

/** 本域所需的最小 fs 面（缺省 = 桌面端 `window.require('fs')`；移动端为 null） */
export interface DockFs {
  /** 读文本；文件不存在 / 读失败返回 null（不抛） */
  readText(path: string): string | null;
  /** 写文本 */
  writeText(path: string, data: string): void;
  /** 原子换名（可选；缺省实现带 renameSync，测试桩可不给 —— 调用方退回直写） */
  rename?(from: string, to: string): void;
  /** 存在性探测（可选；缺省实现带 existsSync，桩可不给 —— 调用方退回「读一下试试」） */
  exists?(path: string): boolean;
  /** 删除文件（可选；缺省实现带 unlinkSync，桩可不给 —— 调用方跳过旧名清理） */
  unlink?(path: string): void;
  /**
   * 递归建目录（可选；缺省实现带 `mkdirSync(p, {recursive:true})`，已存在即静默）。
   *
   * 这是给**值守目录**（`%LOCALAPPDATA%\bz-dock-watch`）准备的 —— 它可能整个不存在，
   * 首次写租约前得先建出来（工具目录那边不必建：声明文件在，目录就在）。
   */
  mkdir?(path: string): void;
  /**
   * 列一层目录（可选）。返回 `{ name, dir }`；读不到返回 null。
   *
   * 只有「选文件夹 → 自动找声明」这一条路需要它；其余路径都按约定直接拼，不必列举。
   * 缺省实现来自 node 的 `readdirSync(withFileTypes)`，测试桩不给就当作不支持（返回空）。
   */
  readdir?(path: string): { name: string; dir: boolean }[] | null;
}

let injectedFs: DockFs | null | undefined;

/** 注入 fs（评审壳 / 测试；传 undefined 复原真身） */
export function setDockFs(fs: DockFs | null | undefined): void {
  injectedFs = fs;
}

function defaultDockFs(): DockFs | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { require?: (id: string) => unknown };
  if (!w.require) return null;
  try {
    const fs = w.require('fs') as {
      readFileSync(p: string, enc: string): string;
      writeFileSync(p: string, d: string): void;
      existsSync(p: string): boolean;
      statSync?(p: string): { isFile(): boolean };
      renameSync?(a: string, b: string): void;
      unlinkSync?(p: string): void;
      mkdirSync?(p: string, o?: { recursive?: boolean }): void;
      readdirSync?(p: string, o: { withFileTypes: boolean }): { name: string; isDirectory(): boolean }[];
    };
    return {
      readText: (p) => {
        try {
          return fs.readFileSync(p, 'utf8');
        } catch {
          return null;
        }
      },
      writeText: (p, d) => fs.writeFileSync(p, d),
      rename:
        typeof fs.renameSync === 'function'
          ? (a, b) => fs.renameSync!(a, b)
          : undefined,
      exists:
        typeof fs.existsSync === 'function'
          ? (p) => {
              try {
                if (!fs.existsSync(p)) return false;
                // 名为 main.mjs 的目录不是入口 —— existsSync 对目录也答 true，用 stat 拦掉
                return fs.statSync ? fs.statSync(p).isFile() : true;
              } catch {
                return false;
              }
            }
          : undefined,
      unlink: typeof fs.unlinkSync === 'function' ? (p) => fs.unlinkSync!(p) : undefined,
      mkdir:
        typeof fs.mkdirSync === 'function'
          ? (p) => {
              try {
                fs.mkdirSync!(p, { recursive: true });
              } catch {
                /* 已存在 / 无权 —— 由随后的那次写入去暴露真问题 */
              }
            }
          : undefined,
      readdir:
        typeof fs.readdirSync === 'function'
          ? (p) => {
              try {
                return fs.readdirSync!(p, { withFileTypes: true }).map((d) => ({
                  name: d.name,
                  dir: d.isDirectory(),
                }));
              } catch {
                return null;
              }
            }
          : undefined,
    };
  } catch {
    return null;
  }
}

/** 当前生效的 fs（注入优先，否则真身）；移动端 / 非桌面环境为 null */
export function currentFs(): DockFs | null {
  return injectedFs !== undefined ? injectedFs : defaultDockFs();
}

// ==================== 路径 ====================

/** 取目录部分（`C:/a/b.json` → `C:/a`；`C:/b.json` → `C:/`）。统一成 `/` 分隔。 */
export function dirOf(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return '/';
  if (s[i - 1] === ':') return s.slice(0, i + 1); // 盘符根
  return s.slice(0, i);
}

/** 拼一个文件名到目录上（分隔符统一 `/`） */
export function joinPath(dir: string, name: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return d === '' ? name : `${d}/${name}`;
}

/** 设置文件路径 = 声明文件同目录 + `data.json` */
export function settingsPathFor(declPath: string): string {
  return joinPath(dirOf(declPath), SETTINGS_FILENAME);
}

/** 运行记录路径 = 声明文件同目录 + `runs.json`（`BZ_DOCK_RUNS_FILE` 注入的就是它） */
export function runsPathFor(declPath: string): string {
  return joinPath(dirOf(declPath), RUNS_FILENAME);
}

/** 展示板路径（与声明同址；工具自己往里写，bz 只读） */
export function panelPathFor(declPath: string): string {
  return joinPath(dirOf(declPath), PANEL_FILENAME);
}

/**
 * 排期状态路径 = 声明文件同目录 + `dock-state.json`（**bz 写、工具只读都不该读**，ADR-0248）。
 *
 * 工具目录可以在 vault 外，所以这条路与 `data.json` 同一条缝（`DockFs`），不走 vault API。
 */
export function toolStatePathFor(declPath: string): string {
  return joinPath(dirOf(declPath), TOOL_STATE_FILENAME);
}

/** 工具目录（声明文件所在目录） */
export function toolDirOf(declPath: string): string {
  return dirOf(declPath);
}

/** 尾名是 `from` → 同目录换成 `to`；尾名不认识 → null（不回落） */
function aliasOf(p: string, from: string, to: string): string | null {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? '';
  if (base !== from) return null;
  return joinPath(dirOf(p), to);
}

// ==================== 启动方式 ====================

/** 解析后的启动方式（缺省都补齐了，可以直接喂给 `runExternalTool`） */
export interface ResolvedRun {
  cmd: string;
  args: string[];
  /** 缺省 = 声明文件所在目录 */
  cwd: string | undefined;
  shell: boolean;
}

/**
 * 声明 → 可直接执行的启动方式。声明没写 `run`、也没有约定入口 → null（只能看、不能跑）。
 *
 * 三处补缺省，都**只看现有信息能确定的东西**，不猜：
 *  - 声明 `run` 优先；没有 `run` 段时用 `conventional`（`readDeclaration` 探测出的
 *    `node main.mjs`，ADR-0237）—— 约定优于配置只此一条，其它运行时必须写 `run`；
 *  - `cwd` 缺省 = 声明文件所在目录（工具目录就是这个目录，所以声明里直接写 `main.mjs` 即可，
 *    整个目录搬到哪都不用改）；
 *  - `shell` 缺省按 `cmd` 扩展名判 —— Windows 的 `.cmd` / `.bat` 不经 shell 起不来
 *    （见 `core/external-tool.ts`），这是「不猜」里唯一一条能从现有信息推出来的。
 */
export function resolveRun(
  manifest: DockManifest | null,
  declPath: string,
  conventional?: DockRunSpec,
): ResolvedRun | null {
  const run: DockRunSpec | undefined = manifest?.run ?? conventional;
  if (!run || !run.cmd) return null;
  return {
    cmd: run.cmd,
    args: [...(run.args ?? [])],
    cwd: run.cwd ?? (dirOf(declPath) || undefined),
    shell: run.shell ?? /\.(cmd|bat)$/i.test(run.cmd),
  };
}

// ==================== 声明读取 ====================

export interface DeclarationRead {
  ok: boolean;
  manifest?: DockManifest;
  /** 失败原因（人话；直接进 UI / 通知） */
  error?: string;
  /** 实际读到声明的路径（回落命中旧名时 ≠ 入参；调用方拿它当 declPath 用） */
  path?: string;
  /** 声明没写 `run` 段、目录里有 `main.mjs` → 这条约定启动方式（ADR-0237） */
  conventionalRun?: DockRunSpec;
}

/** 目录里有约定入口吗（真身 existsSync；桩退回「读一下试试」） */
function hasMainEntry(dir: string, fs: DockFs): boolean {
  const p = joinPath(dir, MAIN_ENTRY_FILENAME);
  return fs.exists ? fs.exists(p) : fs.readText(p) !== null;
}

/**
 * 读并校验一份声明。**不执行任何东西** —— 所以未建立信任的工具也能先看清它声明了什么。
 * 永不抛。新名 `manifest.json` 读不到时回落认旧名 `dock.json`（已有工具零迁移）；
 * 两名都在时新名优先。声明没写 `run` 段时顺手探测约定入口 `main.mjs`。
 */
export function readDeclaration(declPath: string, fs: DockFs | null = currentFs()): DeclarationRead {
  if (!fs) return { ok: false, error: '读声明需要桌面端（移动端只读面板）' };
  let text = fs.readText(declPath);
  let usedPath = declPath;
  if (text === null) {
    const alias =
      aliasOf(declPath, DECLARATION_FILENAME, DECLARATION_FILENAME_LEGACY) ??
      aliasOf(declPath, DECLARATION_FILENAME_LEGACY, DECLARATION_FILENAME);
    if (alias !== null) {
      const alt = fs.readText(alias);
      if (alt !== null) {
        text = alt;
        usedPath = alias;
      }
    }
  }
  if (text === null) return { ok: false, error: `声明文件读不到：${declPath}` };

  const raw = parseJsonObjectText(text);
  if (raw === null) return { ok: false, error: `声明文件不是合法 JSON：${usedPath}` };

  const manifest = parseManifest(raw);
  if (!manifest) {
    return {
      ok: false,
      error: `声明文件校验不过（v 须为 1、id 只能小写字母数字连字符、name 不能空）：${usedPath}`,
    };
  }

  // 约定优于配置：声明没写怎么跑，目录里有 main.mjs 就当 `node main.mjs`（其余运行时不猜）
  const conventionalRun =
    manifest.run || !hasMainEntry(dirOf(usedPath), fs)
      ? undefined
      : { cmd: 'node', args: [MAIN_ENTRY_FILENAME] };
  return { ok: true, manifest, path: usedPath, conventionalRun };
}

// ==================== 从文件夹找声明（导入用） ====================

/** 扫描深度上限：`dock-tools/<工具>/manifest.json` 是 1 层，留到 3 层够用又不至于扫进用户主目录 */
const SCAN_MAX_DEPTH = 3;
/** 目录数上限：选错一个巨大的目录时别把界面卡住（找到的前几百个够了，再多也没人挑） */
const SCAN_MAX_DIRS = 500;
/** 不往这些目录里钻 */
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian']);

/**
 * 在一个文件夹里找声明文件（递归，深度与目录数都有上限）。
 *
 * 为什么要有：原来的导入必须先导航到 `manifest.json` 本身 —— 用户想的是「导入这个工具」，
 * 手里有的是那个工具文件夹，不该被要求知道声明叫什么。找到的路径按字典序返回；
 * 同一目录里新旧两个名字都在时**只认新名**（与 `readDeclaration` 的优先级一致）。
 *
 * 读不到目录（桩没有 readdir / 无权限）→ 空数组，由调用方说人话。
 */
export function findDeclarationFiles(root: string, fs: DockFs | null = currentFs()): string[] {
  if (!fs?.readdir) return [];
  const out: string[] = [];
  let dirs = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH || dirs++ >= SCAN_MAX_DIRS) return;
    const entries = fs.readdir!(dir);
    if (!entries) return;
    const files = new Set(entries.filter((e) => !e.dir).map((e) => e.name));
    const decl = files.has(DECLARATION_FILENAME)
      ? DECLARATION_FILENAME
      : files.has(DECLARATION_FILENAME_LEGACY)
        ? DECLARATION_FILENAME_LEGACY
        : null;
    if (decl) out.push(joinPath(dir, decl));
    for (const e of entries) {
      if (!e.dir) continue;
      if (e.name.startsWith('.') || SCAN_SKIP_DIRS.has(e.name)) continue;
      walk(joinPath(dir, e.name), depth + 1);
    }
  };

  walk(root.replace(/[\\/]+$/, ''), 0);
  return out.sort((a, b) => a.localeCompare(b));
}

// ==================== 参数值（工具侧设置文件） ====================

interface SettingsFile {
  v: number;
  tool: string;
  values: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 解析一份参数值文本。`null` = 文件不存在（调用方可回落旧名）；
 * `{}` = 文件在但无效（坏 JSON / 版本不认识 / `tool` 串台 —— 宁可为空让人重填，
 * 也不把可能属于别人的凭据发出去，也不绕过它去翻旧名）。
 */
function parseSettingsText(text: string | null, toolId: string): Record<string, unknown> | null {
  if (text === null) return null;
  const raw = parseJsonObjectText(text);
  if (!raw) return {};
  if (raw.v !== DOCK_SETTINGS_VERSION) return {};
  if (raw.tool !== toolId) return {};
  return isPlainObject(raw.values) ? { ...raw.values } : {};
}

/** 读参数值：新名 `data.json` 不在时回落认旧名 `dock.settings.json`；两名都在新名说了算 */
export function readSettings(
  declPath: string,
  toolId: string,
  fs: DockFs | null = currentFs(),
): Record<string, unknown> {
  if (!fs) return {};
  const direct = parseSettingsText(fs.readText(settingsPathFor(declPath)), toolId);
  if (direct !== null) return direct;
  const legacy = parseSettingsText(fs.readText(joinPath(dirOf(declPath), SETTINGS_FILENAME_LEGACY)), toolId);
  return legacy ?? {};
}

/**
 * 写参数值（tmp + rename 原子换名 —— 面板边填边存，写坏一次就等于丢凭据）。
 *
 * 落盘只写新名 `data.json`；成功后若旧名 `dock.settings.json` 还在就清掉 ——
 * 那是同一份凭据的残留，不该跟着工具目录到处走（删除尽力而为，失败不碍这次写入）。
 *
 * 返回是否写成功；失败不抛（面板要照常可用，最多是这次没存住）。
 */
export function writeSettings(
  declPath: string,
  toolId: string,
  values: Record<string, unknown>,
  fs: DockFs | null = currentFs(),
): boolean {
  if (!fs) return false;
  const target = settingsPathFor(declPath);
  const payload: SettingsFile = { v: DOCK_SETTINGS_VERSION, tool: toolId, values };
  const text = JSON.stringify(payload, null, 2);
  try {
    if (fs.rename) {
      const tmp = `${target}.tmp`;
      fs.writeText(tmp, text);
      fs.rename(tmp, target);
    } else {
      fs.writeText(target, text);
    }
  } catch {
    return false;
  }
  // 迁移尾巴：旧名里的旧值已经被新名盖过（读侧新名优先），留着就是凭据多落一处。
  // 整段包住 —— 探测或删除出任何岔子都不影响「这次已写成功」的事实
  const legacy = joinPath(dirOf(declPath), SETTINGS_FILENAME_LEGACY);
  if (fs.unlink) {
    try {
      const gone = fs.exists ? fs.exists(legacy) : fs.readText(legacy) !== null;
      if (gone) fs.unlink(legacy);
    } catch {
      /* 删不掉就留着 —— 读侧永远新名优先，无实害 */
    }
  }
  return true;
}

// ==================== 排期状态（bz 写，ADR-0248） ====================

/**
 * 读某工具的排期状态（规则表 / 规则记账 / 熔断台账 / 停用与总闸）。
 *
 * 文件不存在 = 没配过 → `{}`（缺省即「全开、按声明节奏」）；版本不认识 / `tool` 串台也 `{}` ——
 * 宁可按缺省重来，也不把别人那份排期套到这个工具上。**只读，不创建**。
 */
export function readToolState(
  declPath: string,
  toolId: string,
  fs: DockFs | null = currentFs(),
): DockToolState {
  if (!fs) return {};
  const text = fs.readText(toolStatePathFor(declPath));
  if (text === null) return {};
  const raw = parseJsonObjectText(text);
  return parseToolState(raw, toolId) ?? {};
}

/**
 * 写某工具的排期状态（tmp + rename 原子换名）。
 *
 * 内容与盘上一致时**不写**：调度器每拍都可能记一次账，无谓地刷 mtime 会让 Syncthing
 * 一直有东西可同步。返回是否真的写了；失败不抛（内存快照已经更新，进程内照常判据）。
 */
export function writeToolState(
  declPath: string,
  toolId: string,
  state: DockToolState,
  fs: DockFs | null = currentFs(),
): boolean {
  if (!fs) return false;
  const target = toolStatePathFor(declPath);
  // 盘上那份的**其余字段原样带上**：未来版本加的键，本进程不认识也不该顺手删
  // （与值守回写 dock.json 的「只改自己那一块」同一条纪律）
  const keep: Record<string, unknown> = {};
  try {
    const prev = parseJsonObjectText(fs.readText(target));
    if (prev) for (const [k, v] of Object.entries(prev)) keep[k] = v;
  } catch {
    /* 读不了就当什么都没有 */
  }
  const fresh = toolStateFileOf(toolId, state);
  const next: Record<string, unknown> = { ...keep, ...fresh };
  // **已知字段以新值为准**：上面「保留不认识的字段」不能反过来把清空的字段复活
  // （台账归零时 `fresh` 里没有 `runState`，可 `keep` 里有旧的那份）
  for (const k of [
    'enabled',
    'autoRun',
    'scheduleOverride',
    'overrideDeclSig',
    'rules',
    'ruleState',
    'runState',
  ]) {
    if (!(k in fresh)) delete next[k];
  }
  const text = JSON.stringify(next, null, 2);
  try {
    if (fs.readText(target) === text) return false;
  } catch {
    /* 读不了就直接写 */
  }
  try {
    if (fs.rename) {
      const tmp = `${target}.tmp`;
      fs.writeText(tmp, text);
      fs.rename(tmp, target);
    } else {
      fs.writeText(target, text);
    }
  } catch {
    return false;
  }
  return true;
}

/** 状态文件版本（给迁移与测试用；值以 `tool-state.ts` 为准，这里只转发） */
export { TOOL_STATE_FILENAME, TOOL_STATE_VERSION };

// ==================== 运行记录（工具写、bz 只读） ====================

/**
 * 读运行记录原文（**只读** —— 这里刻意没有 write 对应物，bz 一写就成了第二个写者）。
 *
 * 记录住**工具目录**（与声明、参数值同一层）：一个工具的全部数据都在它自己的目录里，
 * 搬走目录就是搬走一切，bz 侧只剩下一条登记项（spec D9/D10 修订）。
 * 新名 `runs.json` 读不到时回落认旧名 `dock.runs.json`（工具还没跟新契约时历史不丢）。
 * 读不到 / 读失败 = null，调用方降级为「该工具记录不可读」，绝不抛（同 `parseBzLine` 精神）。
 */
export function readRunsText(declPath: string, fs: DockFs | null = currentFs()): string | null {
  if (!fs) return null;
  return (
    fs.readText(runsPathFor(declPath)) ??
    fs.readText(joinPath(dirOf(declPath), RUNS_FILENAME_LEGACY))
  );
}

/**
 * 读展示板原文（**只读**，同 `readRunsText` 的理由 —— bz 一写就成了第二个写者）。
 *
 * 没有 / 读不到 / 只有空白 = null：对详情页来说「这个工具没画展示板」与「画了个空的」
 * 是同一件事 —— 那一块整块不出现，不留一个空框在那儿。
 */
export function readPanelText(declPath: string, fs: DockFs | null = currentFs()): string | null {
  if (!fs) return null;
  const text = fs.readText(panelPathFor(declPath));
  return text === null || text.trim() === '' ? null : text;
}
