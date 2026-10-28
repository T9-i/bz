/* ============================================================
 * bz · 首次引导 / 环境自检（core/setup-wizard.ts）
 *
 * 一次把「新机器缺什么、缺的怎么补」走完。六屏：
 *
 *   ① 检测   先探网络（raw + jsDelivr 四个边缘），再探本机八项
 *   ② 存放   数据存哪（默认 CONFIG/STORAGE，可改，当场写探针验证）
 *   ③ 内容   下什么（运行时 / 工具 / 文档索引 / 皮肤，逐项可勾；**已就绪的自动跳过**）
 *   ④ AI     可选：服务商 + 密钥 + 当场测通（跳过不影响其他功能）
 *   ⑤ 安装   勾了就全自动，不再逐项确认；单项失败不牵连
 *   ⑥ 完成   就绪清单 + 值守启用询问（唯一改系统状态的一步）+ 仍需手工的项
 *
 * 三条设计约束：
 *  - **同意只有一次**（③ 底部的「开始下载」）。之后的下载不再问第二遍——它们只是往插件
 *    自己的目录写文件。唯一会改系统状态的是「值守注册登录自启」，那一步单独确认
 *    （⑤ 末尾调 core/tool-setup.ts 的 setupAfterInstall，它自己带确认框）。
 *  - **已就绪的不重下**。③ 的列表按磁盘事实打勾：老用户重跑一遍不必再拉几十 MB。
 *  - 与「设置 → 关于 → 环境自检」共用同一套行渲染与补齐队列；自检模式跳过 ②④ 两屏。
 * ============================================================ */
import { notice } from './notice';
import { uiModal } from './ui/modal';
import { environmentCheck, probeNetwork, probeWritableDir, type EnvCheckRow, type NetworkProbe } from './env-check';
import { docStatus, refreshManifest } from './download-manifest';
import type { DownloadManifest, ManifestDocEntry } from './download-manifest';
import { bundleStatus, installBundle } from './bundle-asset';
import { ensureAssetWithHash } from './remote-asset';
import { downloadSkinUpdates, skinStatus } from './skin-pack';
import { installPortableNode, PORTABLE_NODE_VERSION } from './node-runtime-install';
import { probeNodeRuntime, resetNodeRuntimeCache } from './tool-runtime';
import { setupAfterInstall } from './tool-setup';
import { pluginDirOf, vaultBasePathOf } from './plugin-path';
import { vaultKeyOf } from './vault-key';
import { openPathPicker } from './path-picker';
import { isMobileEnv } from './mobile';
import { getApp } from './app';
import { getSettings, saveSettings, tryGetSettings } from './settings-provider';
import { AI_PROVIDER_REGISTRY, DEFAULT_AI_PROVIDER, getProviderDescriptor, testAIConnectivity } from './ai';

/** Node 归档的估算体积（只在清单里显示，真实体积看服务端） */
const NODE_SIZE_HINT = 36.4 * 1024 * 1024;

/** 拉清单的超时（requestUrl 没有 abort，用 race 兜住——不让第一屏挂在网络上） */
const MANIFEST_TIMEOUT_MS = 12000;

/** 下载项的种类（决定 ③ 屏怎么分组、缺省勾不勾） */
export type SetupKind = 'node' | 'bundle' | 'doc' | 'skins';

/** 一个可下载项 */
export interface SetupItem {
  id: string;
  kind: SetupKind;
  label: string;
  desc: string;
  /** 估算字节数（未知 = null，界面只显状态不显体积） */
  size: number | null;
  /** 磁盘上已经就绪（已下载 / 已有可用运行时）——重跑时不重下 */
  ready: boolean;
  /** 按需项：列出来但不默认勾（大索引这类，早下纯占地方，用到的域会自己拉） */
  optional?: boolean;
  /** 干活；`report` 用于中途改这一行的状态文字（进度、阶段） */
  run: (report?: (text: string) => void) => Promise<void>;
}

/** 体积人话 */
export function sizeText(bytes: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 「要下什么」的**纯**队列（不看磁盘状态）。
 * 顺序刻意如此：Node 最久，放第一个——先让它跑起来，后面小包在它之后秒完，
 * 用户看到的进度是连续的，而不是「卡在 87% 一动不动」。
 */
export function buildSetupTasks(app: unknown, manifest: DownloadManifest | null, opts: { nodeMissing: boolean }): SetupItem[] {
  const mk = (i: Omit<SetupItem, 'ready'>): SetupItem => ({ ...i, ready: false });
  const items: SetupItem[] = [];
  if (opts.nodeMissing) {
    items.push(
      mk({
        id: 'node',
        kind: 'node',
        label: 'Node 运行时',
        desc: `便携版 ${PORTABLE_NODE_VERSION}，装进插件目录`,
        size: NODE_SIZE_HINT,
        run: async (report) => {
          // 36MB 是这一轮最久的一项：没有进度的话用户会以为卡死，然后去点第二次
          await installPortableNode(app, {
            onStage: (stage) => report?.(stage),
            onProgress: (got, total) => {
              if (total > 0) report?.(`${Math.min(99, Math.round((got / total) * 100))}% · ${sizeText(got)} / ${sizeText(total)}`);
              else report?.(sizeText(got));
            },
          });
          // 刚装好的运行时必须让探测缓存失效：否则同一会话里 toolReadyState 还是旧结论
          resetNodeRuntimeCache();
        },
      }),
    );
  }
  if (!manifest) return items;

  // 目录包（工具）先于文档：工具决定「能不能用」，文档决定「查不查得到」
  for (const e of manifest.docs.filter((d) => d.kind === 'bundle')) items.push(mk(bundleItem(app, e)));
  for (const e of manifest.docs.filter((d) => d.kind !== 'bundle')) items.push(mk(docItem(app, e)));
  const skinBytes = manifest.skins.reduce((n, s) => n + (s.size || 0), 0);
  if (manifest.skins.length) {
    items.push(
      mk({
        id: 'skins',
        kind: 'skins',
        label: '主题皮肤',
        desc: `${manifest.skins.length} 套远端皮肤，用到才生效`,
        size: skinBytes || null,
        run: async () => {
          const r = await downloadSkinUpdates(app, manifest);
          if (r.failed > 0) throw new Error(`${r.failed} 套皮肤下载失败`);
        },
      }),
    );
  }
  return items;
}

function bundleItem(app: unknown, e: ManifestDocEntry): Omit<SetupItem, 'ready'> {
  return {
    id: e.id,
    kind: 'bundle',
    label: e.name,
    desc: '外部工具，解包即可用',
    size: e.size ?? null,
    run: async () => {
      await installBundle(app, e);
    },
  };
}

function docItem(app: unknown, e: ManifestDocEntry): Omit<SetupItem, 'ready'> {
  // 大索引（豆瓣影视索引 7.2MB）不占首装：它只服务影院域的输入联想，用到的域进页面时自己拉。
  // 首装跟着下一遍，是纯占地方——而且走镜像要 30 秒，正好卡在「最后一项」让人以为卡死。
  const lazy = LAZY_DOC_IDS.has(e.id);
  return {
    id: e.id,
    kind: 'doc',
    label: e.name,
    desc: lazy ? '按需下载：用到时自动拉' : '离线可读',
    size: e.size ?? null,
    ...(lazy ? { optional: true } : {}),
    run: async () => {
      await ensureAssetWithHash(app, e.file, e.sha256, e.name);
    },
  };
}

/** 按需下载的资源 id（首装默认不勾；对应功能首次用到时自己拉） */
export const LAZY_DOC_IDS = new Set(['cinema-douban-index']);

/** 磁盘上这一项是不是已经就绪（重跑引导时用来跳过，避免白拉几十 MB） */
async function isReady(app: unknown, manifest: DownloadManifest | null, id: string, kind: SetupKind): Promise<boolean> {
  if (kind === 'node') return probeNodeRuntime(app, { fresh: true }).kind !== 'none';
  if (!manifest) return false;
  if (kind === 'skins') {
    const st = await skinStatus(app, manifest);
    return st.missing === 0 && st.updated === 0 && st.ready > 0;
  }
  const entry = manifest.docs.find((d) => d.id === id);
  if (!entry) return false;
  const state = entry.kind === 'bundle' ? await bundleStatus(app, entry) : await docStatus(app, entry);
  return state === 'ready';
}

/** 带磁盘状态的队列（③ 屏用）：ready 的显示「已就绪」并默认不勾 */
export async function planSetupItems(
  app: unknown,
  manifest: DownloadManifest | null,
  opts: { nodeMissing: boolean },
): Promise<SetupItem[]> {
  const items = buildSetupTasks(app, manifest, opts);
  const out: SetupItem[] = [];
  for (const it of items) out.push({ ...it, ready: await isReady(app, manifest, it.id, it.kind) });
  return out;
}

/** 缺省勾选：没就绪的都勾上；皮肤与「按需」项不勾（用到再下，提前下纯占地方） */
export function defaultSelection(items: SetupItem[]): Set<string> {
  const sel = new Set<string>();
  for (const it of items) if (!it.ready && it.kind !== 'skins' && !it.optional) sel.add(it.id);
  return sel;
}

/** 按勾选挑出真正要跑的任务（已就绪的即使被勾中也不重下） */
export function selectedTasks(items: SetupItem[], selected: Set<string>): SetupItem[] {
  return items.filter((it) => selected.has(it.id) && !it.ready);
}

/* ==================== 视图 ==================== */

interface WizardCtx {
  app: unknown;
  firstRun: boolean;
  /** 自检模式：跳过「存放 / AI」两屏，直奔清单 */
  checkOnly: boolean;
}

interface WizardState {
  net: NetworkProbe | null;
  /** 清单（检测屏拉一次，下载屏复用——不让用户在两屏之间等两次网络） */
  manifest?: DownloadManifest | null;
  rows: EnvCheckRow[];
  storagePath: string;
  items: SetupItem[];
  selected: Set<string>;
  provider: string;
  apiKey: string;
  aiTest: { state: 'idle' | 'busy' | 'ok' | 'fail'; text: string };
  failed: string[];
}

interface Ui {
  sub: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

function skeleton(root: HTMLElement): Ui {
  root.classList.add('bz-setup');
  root.innerHTML = '<div class="bz-setup-sub"></div><div class="bz-setup-body"></div><div class="bz-setup-foot"></div>';
  return {
    sub: root.querySelector('.bz-setup-sub') as HTMLElement,
    body: root.querySelector('.bz-setup-body') as HTMLElement,
    foot: root.querySelector('.bz-setup-foot') as HTMLElement,
  };
}

function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

function rowEl(cls = 'bz-setup-row'): HTMLElement {
  const row = document.createElement('div');
  row.className = cls;
  return row;
}

function markEl(state: 'ok' | 'bad' | 'idle' | 'busy'): HTMLElement {
  const span = document.createElement('span');
  span.className = `bz-setup-mark bz-setup-mark--${state}`;
  return span;
}

function keyEl(text: string, sub?: string): HTMLElement {
  const k = document.createElement('span');
  k.className = 'bz-setup-key';
  if (sub) k.innerHTML = `${escapeText(text)}<em>${escapeText(sub)}</em>`;
  else k.textContent = text;
  return k;
}

function valEl(text: string): HTMLElement {
  const v = document.createElement('span');
  v.className = 'bz-setup-val';
  v.textContent = text;
  return v;
}

/**
 * 把「值」写进行里。
 *
 * 一律左右两列：名称在左、值在右，**长值（路径）也在右列自己的宽度里换行**。
 * 早前把长值整行折到第二行、还染成灰字——读起来像两条不同的信息，
 * 截图里「已配置：E:/…” 单独漂在下面就是那样（2026-10-28 用户否掉）。
 * 折行的老写法本来是为了绕开「右列被压成一字一列」的 bug；那个 bug 的真因是
 * 列宽 auto + overflow-wrap:anywhere，现在用两列 fr + min-width 解决，不必再折行。
 */
function setValue(_row: HTMLElement, val: HTMLElement, text: string): void {
  val.textContent = text;
}

/** 装一行：状态点 + 名称（可带一句用途）+ 值 */
function lineRow(mark: HTMLElement, label: string, sub: string | undefined, value: string): HTMLElement {
  const row = rowEl();
  row.append(mark, keyEl(label, sub), valEl(''));
  setValue(row, row.querySelector('.bz-setup-val') as HTMLElement, value);
  return row;
}

/** 只转义三件事：文案来自本地常量，但 `& < >` 会被当标签解析，够了 */
function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 检测屏的分段（纯函数，便于钉住「工具只出现一次」）：
 * 环境行里 `tool-*` 前缀的就是三个外部工具（core/env-check 用 runtimeDiagnostics 生成），
 * 其余是本机环境。两段互斥——重复列同一件事是用户 2026-10-28 截图里最刺眼的一条。
 */
export function splitProbeRows<T extends { id?: string }>(rows: T[]): { env: T[]; tools: T[] } {
  const isTool = (id: string | undefined): boolean => String(id || '').startsWith('tool-');
  return { env: rows.filter((r) => !isTool(r.id)), tools: rows.filter((r) => isTool(r.id)) };
}

/** 「在线资源」段只列文档与皮肤（目录包已经归「外部工具」，不在这里重复） */
export function resourceDocsOf<T extends { kind?: string }>(manifest: { docs: T[] }): T[] {
  return manifest.docs.filter((d) => d.kind !== 'bundle');
}

function closeModal(ui: Ui): void {
  (ui.body.closest('.bz-overlay-mask') as HTMLElement | null)?.remove();
}

/* ---------- ① 检测 ---------- */
async function stageProbe(ctx: WizardCtx, st: WizardState, ui: Ui): Promise<void> {
  ui.sub.textContent = ctx.firstRun
    ? '第一次使用，先看看这台机器缺什么。不会改动你的笔记。'
    : '重新检查这台机器上的运行环境。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);

  const addRow = (key: string, into: HTMLElement = list): { row: HTMLElement; val: HTMLElement; mark: HTMLElement } => {
    const row = rowEl();
    const mark = markEl('busy');
    const val = valEl('检查中');
    row.append(mark, keyEl(key), val);
    into.appendChild(row);
    return { row, val, mark };
  };
  const paint = (t: { row: HTMLElement; val: HTMLElement; mark: HTMLElement }, ok: boolean | null, text: string): void => {
    t.mark.className =
      'bz-setup-mark ' + (ok === true ? 'bz-setup-mark--ok' : ok === false ? 'bz-setup-mark--bad' : 'bz-setup-mark--idle');
    setValue(t.row, t.val, text);
  };

  const netRow = addRow('网络 · 资源站');
  const cdnRow = addRow('网络 · 备用通道');
  const net = await probeNetwork().catch(() => null);
  st.net = net;
  // 不可达时把**原因**带上（2026-10-28：只说「不可达」时，网页能开 GitHub 的人根本无从判断
  // 是墙、是代理还是 DNS——raw.githubusercontent.com 与 github.com 是两回事）
  paint(netRow, net?.github ? true : false, net?.github ? `可达 · ${net.githubMs} ms` : `不可达 · ${net?.githubError || '未知原因'}`);
  paint(cdnRow, net?.jsdelivr ? true : null, net?.jsdelivr ? `可达 · ${net.jsdelivrMs} ms` : `不可达 · ${net?.jsdelivrError || '未知原因'}`);

  const rows = await environmentCheck(ctx.app);
  st.rows = rows;
  // 三段而不是一段平铺（2026-10-28 用户截图报障）：
  //  ① 本机环境（运行环境 / 路径 / 可写 / Node / Python / AI）
  //  ② **外部工具**（三个目录包）——此前混在环境行里，又在「在线资源」里重复出现一次
  //  ③ **在线资源**（文档 / 皮肤）——只列文档与皮肤，不再把三个工具重复列一遍
  const { env: envRows, tools: toolRows } = splitProbeRows(rows);
  for (const r of envRows) paint(addRow(r.key), r.ok, r.value);

  const groupOf = (title: string): HTMLElement => {
    const group = document.createElement('div');
    group.className = 'bz-setup-group';
    const head = document.createElement('div');
    head.className = 'bz-setup-group-h';
    head.textContent = title;
    group.appendChild(head);
    ui.body.appendChild(group);
    return group;
  };

  if (toolRows.length) {
    const group = groupOf('外部工具');
    for (const r of toolRows) paint(addRow(r.key, group), r.ok, r.value);
  }

  // 在线资源的下载状态：自检不能只说「这台机器缺什么」，还要说「哪些已经下好了」。
  // 清单只拉一次，③ 屏直接复用（st.manifest）。
  const manifest = await fetchManifestWithTimeout(ctx.app);
  st.manifest = manifest;
  if (manifest) {
    const group = groupOf('在线资源');
    for (const e of resourceDocsOf(manifest)) {
      // 深校验只对目录包有意义（逐文件 stat）；文档是单文件 sha256，docStatus 立刻能判
      const state = await docStatus(ctx.app, e);
      const text = state === 'ready' ? '已下载' : state === 'updated' ? '有更新' : '未下载';
      paint(addRow(e.name, group), state === 'ready' ? true : state === 'updated' ? null : false, text);
    }
    const skin = await skinStatus(ctx.app, manifest);
    const total = manifest.skins.length;
    const text = `${skin.ready}/${total} 已下载`;
    paint(addRow('主题皮肤', group), skin.missing === 0 && skin.updated === 0 ? true : null, text);
  }

  const online = !!(net?.github || net?.jsdelivr);
  if (!online) {
    // 只说事实，不给操作指令（2026-10-28 用户拍板）：原先那两句「填镜像源」「把 downloads/ 拷到
    // bz-offline/」都不该出现在这里——镜像源行已经下线，而让人手动摆文件路径本身就是错的指引
    // （摆错位置不会报错，只会表现为「下载一直失败」）。真无外网的人自己知道该怎么办。
    ui.sub.textContent = net
      ? `连不上资源站（主通道 ${net.githubError || '不可达'}，备用通道 ${net.jsdelivrError || '不可达'}）：下载类功能要等网络恢复后再用，插件主体不受影响。`
      : '连不上资源站：下载类功能要等网络恢复后再用，插件主体不受影响。';
    const later = button('bz-setup-btn', '稍后再说');
    later.onclick = () => {
      void markDone(ctx.app);
      closeModal(ui);
    };
    const retry = button('bz-setup-btn bz-setup-btn--cta', '重新检测');
    retry.onclick = () => void stageProbe(ctx, st, ui);
    ui.foot.append(later, retry);
    return;
  }
  if (ctx.checkOnly) void stageResources(ctx, st, ui);
  else void stageStorage(ctx, st, ui);
}

/* ---------- ② 存放位置 ---------- */
async function stageStorage(ctx: WizardCtx, st: WizardState, ui: Ui): Promise<void> {
  const current = String(tryGetSettings()?.storagePath || 'CONFIG/STORAGE');
  st.storagePath = current;
  ui.sub.textContent = '各域的数据（备忘录、日记索引、收藏…）都以 JSON 存在这个目录里。默认在 vault 内部，跟着 vault 走。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);
  const mark = markEl('idle');
  const row = rowEl();
  const val = valEl('');
  row.append(mark, keyEl('数据目录'), val);
  setValue(row, val, current);
  list.appendChild(row);

  const hint = document.createElement('div');
  hint.className = 'bz-setup-hint';
  hint.textContent =
    '放在 vault 里 = 跟着 vault 走；但同步盘（iCloud / OneDrive）会连带同步这些数据文件。想换就点「换个目录」，只能选 vault 内的文件夹。';
  ui.body.appendChild(hint);

  const pick = button('bz-setup-btn', '换个目录');
  pick.onclick = () =>
    openPathPicker({
      title: '数据存放在哪',
      mode: 'single',
      desc: '选一个 vault 内的文件夹。目录不存在会自动建。',
      selected: [st.storagePath],
      okText: '用这个',
      onConfirm: (picked) => {
        const chosen = String(picked[0] || '').replace(/\/+$/, '');
        if (!chosen) return;
        st.storagePath = chosen;
        val.textContent = chosen;
        mark.className = 'bz-setup-mark bz-setup-mark--idle';
      },
    });

  const back = button('bz-setup-btn', '上一步');
  back.onclick = () => void stageProbe(ctx, st, ui);
  const next = button('bz-setup-btn bz-setup-btn--cta', '下一步');
  next.onclick = async () => {
    const ok = await probeWritableDir(ctx.app, st.storagePath);
    if (!ok) {
      mark.className = 'bz-setup-mark bz-setup-mark--bad';
      notice(`这个目录写不进去：${st.storagePath}。换一个，或检查是否只读 / 被同步盘占用`, 'error');
      return;
    }
    mark.className = 'bz-setup-mark bz-setup-mark--ok';
    try {
      const s = getSettings();
      s.storagePath = st.storagePath;
      await saveSettings();
    } catch {
      /* 设置未注入：不影响本次流程 */
    }
    // 存哪定了 → 再问「要不要顺手配 AI」，最后才谈下什么
    void stageAi(ctx, st, ui);
  };
  ui.foot.append(back, pick, next);
}

/* ---------- ③ 下载内容 ---------- */
async function stageResources(ctx: WizardCtx, st: WizardState, ui: Ui): Promise<void> {
  ui.sub.textContent = '正在核对磁盘上已经有什么…';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const manifest = st.manifest !== undefined ? st.manifest : await fetchManifestWithTimeout(ctx.app);
  st.manifest = manifest;
  const nodeMissing = probeNodeRuntime(ctx.app, { fresh: true }).kind === 'none';
  st.items = await planSetupItems(ctx.app, manifest, { nodeMissing });
  st.selected = defaultSelection(st.items);

  const pending = (): SetupItem[] => selectedTasks(st.items, st.selected);
  const total = pending().reduce((n, t) => n + (t.size || 0), 0);
  ui.sub.textContent = pending().length
    ? `一共 ${pending().length} 项要下载，约 ${sizeText(total) || '未知体积'}。点开始后自动完成，中途不用再确认。`
    : '这台机器什么都不缺，可以直接用了。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const hint = document.createElement('div');
  hint.className = 'bz-setup-hint';
  hint.textContent = !manifest
    ? '资源清单没拉到（网络不通或资源站不可达）：这一次只能补 Node 运行时，其余资源等网络恢复后在「在线资源」里补。'
    : st.net && !st.net.github
      ? 'GitHub 直连不通：会自动改用备用通道下载，内容一样，速度可能慢一些。'
      : '下载的东西都放在插件自己的目录里，不碰笔记、不改系统设置。';
  ui.body.appendChild(hint);

  const next = button('bz-setup-btn bz-setup-btn--cta', '');

  const GROUPS: Array<{ kind: SetupKind; title: string }> = [
    { kind: 'node', title: '运行环境' },
    { kind: 'bundle', title: '外部工具' },
    { kind: 'doc', title: '文档与索引' },
    { kind: 'skins', title: '主题皮肤' },
  ];
  for (const g of GROUPS) {
    const group = st.items.filter((i) => i.kind === g.kind);
    if (!group.length) continue;
    const wrap = document.createElement('div');
    wrap.className = 'bz-setup-group';
    const head = document.createElement('div');
    head.className = 'bz-setup-group-h';
    head.textContent = g.title;
    wrap.appendChild(head);
    for (const it of group) {
      const row = rowEl('bz-setup-row bz-setup-row--pick');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'bz-setup-check';
      box.checked = st.selected.has(it.id);
      box.disabled = it.ready;
      box.onchange = () => {
        if (box.checked) st.selected.add(it.id);
        else st.selected.delete(it.id);
        refreshFoot();
      };
      row.append(box, keyEl(it.label, it.desc), valEl(it.ready ? '已就绪' : sizeText(it.size) || '待下载'));
      if (it.optional && !it.ready) row.dataset.optional = '1';
      wrap.appendChild(row);
    }
    ui.body.appendChild(wrap);
  }

  const refreshFoot = (): void => {
    const t = pending();
    const bytes = t.reduce((s, x) => s + (x.size || 0), 0);
    next.textContent = t.length ? `开始下载（${sizeText(bytes) || `${t.length} 项`}）` : '完成';
  };

  const skip = button('bz-setup-btn', ctx.firstRun ? '以后再说' : '关闭');
  skip.onclick = () => {
    void markDone(ctx.app);
    closeModal(ui);
  };
  next.onclick = () => {
    const tasks = pending();
    if (!tasks.length) {
      void markDone(ctx.app);
      void stageDone(ctx, st, ui);
      return;
    }
    void stageInstall(ctx, st, ui, tasks);
  };

  if (ctx.checkOnly && !st.items.some((i) => !i.ready)) {
    const ok = button('bz-setup-btn bz-setup-btn--cta', '知道了');
    ok.onclick = () => closeModal(ui);
    ui.foot.append(ok);
    return;
  }
  ui.foot.append(skip, next);
  refreshFoot();
}

/**
 * 磁盘余量（字节；拿不到 → null）。
 * 写在前面：便携 Node 解出来 87MB、main.js 2.7MB、皮肤/文档 10MB——再加上解压瞬时占用，
 * 一次首装大约要 150MB 余量。磁盘满时 Obsidian 的 write 报的是底层错误，
 * 用户看到的是「下载失败」，根本猜不到是磁盘。
 */
export function freeSpaceBytes(app: unknown = getApp()): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const fs = (window as any).require?.('fs');
    const statfs = fs?.statfsSync;
    if (!statfs) return null;
    // 目标盘 = vault 所在盘（插件目录与数据目录都在 vault 内）
    const dir = pluginDirOf(app) || (window as any).require?.('os')?.homedir?.() || '.';
    const st = statfs(dir);
    const bsize = Number(st?.bsize) || Number(st?.frsize) || 0;
    const bavail = Number(st?.bavail ?? st?.bfree) || 0;
    return bsize && bavail ? bsize * bavail : null;
  } catch {
    return null;
  }
}

/** 拉清单带超时（失败 → null，不阻断流程） */
async function fetchManifestWithTimeout(app: unknown): Promise<DownloadManifest | null> {
  return Promise.race([
    refreshManifest(app)
      .then((r) => r?.manifest ?? null)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), MANIFEST_TIMEOUT_MS)),
  ]);
}

/* ---------- ④ AI 密钥（可选） ---------- */
async function stageAi(ctx: WizardCtx, st: WizardState, ui: Ui): Promise<void> {
  st.provider = String(tryGetSettings()?.aiProvider || DEFAULT_AI_PROVIDER);
  st.apiKey = '';
  st.aiTest = { state: 'idle', text: '' };

  ui.sub.textContent = '可选。配了才能用摘要、小橘这些 AI 功能；跳过不影响其他所有功能。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'bz-setup-input';
  input.oninput = () => {
    st.apiKey = input.value.trim();
    st.aiTest = { state: 'idle', text: '' };
    paint();
  };

  const seg = document.createElement('div');
  seg.className = 'bz-setup-seg';
  const desc = document.createElement('div');
  desc.className = 'bz-setup-hint';
  const keyRow = rowEl('bz-setup-row bz-setup-row--input');
  keyRow.append(markEl('idle'), keyEl('API Key'), input);
  const testLine = document.createElement('div');
  testLine.className = 'bz-setup-hint';

  function paint(): void {
    const d = getProviderDescriptor(st.provider);
    desc.textContent =
      d.id === 'ollama'
        ? '本地 Ollama 不需要密钥：确认本机 Ollama 服务已启动即可。'
        : '密钥会明文存进你的 data.json。vault 若放在同步盘上，等于把密钥放上云——介意就先跳过。';
    keyRow.style.display = d.id === 'ollama' ? 'none' : '';
    input.placeholder = d.apiKeyLabel || '粘贴 API Key';
    testLine.textContent = st.aiTest.state === 'idle' ? '' : st.aiTest.state === 'busy' ? '正在测…' : st.aiTest.text;
    testLine.className = 'bz-setup-hint' + (st.aiTest.state === 'fail' ? ' bz-setup-hint--bad' : '');
    for (const b of Array.from(seg.querySelectorAll('button'))) {
      b.className = 'bz-setup-btn' + (b.dataset.id === st.provider ? ' bz-setup-btn--cta' : '');
    }
  }

  for (const p of AI_PROVIDER_REGISTRY) {
    const b = button('bz-setup-btn', p.label);
    b.dataset.id = p.id;
    b.onclick = () => {
      st.provider = p.id;
      st.aiTest = { state: 'idle', text: '' };
      paint();
    };
    seg.appendChild(b);
  }
  ui.body.append(seg, desc, keyRow, testLine);
  paint();

  const back = button('bz-setup-btn', '上一步');
  back.onclick = () => void stageResources(ctx, st, ui);
  const skip = button('bz-setup-btn', '跳过');
  skip.onclick = () => void stageResources(ctx, st, ui);
  const test = button('bz-setup-btn', '测一下');
  test.onclick = async () => {
    await saveAi(st);
    st.aiTest = { state: 'busy', text: '' };
    paint();
    try {
      const r = await testAIConnectivity(st.provider);
      st.aiTest = { state: 'ok', text: `通了：${r.label} / ${r.model} · ${r.ms} ms · 回复「${r.reply.slice(0, 12)}」` };
    } catch (e) {
      st.aiTest = { state: 'fail', text: `没通：${(e as Error)?.message || String(e)}` };
    }
    paint();
  };
  const save = button('bz-setup-btn bz-setup-btn--cta', '保存并继续');
  save.onclick = async () => {
    await saveAi(st);
    void stageResources(ctx, st, ui);
  };
  ui.foot.append(skip, back, test, save);
}

async function saveAi(st: WizardState): Promise<void> {
  try {
    const s = getSettings();
    s.aiProvider = st.provider;
    const key = st.apiKey.trim();
    if (st.provider === 'zhipu-plan') s.zhipuPlanApiKey = key;
    else if (st.provider === 'ollama') s.ollamaApiKey = key;
    else s.deepseekApiKey = key;
    await saveSettings();
  } catch {
    /* 设置未注入：忽略 */
  }
}

/* ---------- ⑤ 安装 ---------- */
async function stageInstall(ctx: WizardCtx, st: WizardState, ui: Ui, tasks: SetupItem[]): Promise<void> {
  ui.sub.textContent = '全部自动完成。可以先去用别的功能，装完会通知你。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'bz-setup-bar';
  bar.innerHTML = '<i></i>';
  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.append(bar, list);

  const collapse = button('bz-setup-btn', '收起来，后台继续');
  collapse.onclick = () => closeModal(ui);
  ui.foot.appendChild(collapse);

  const total = tasks.reduce((n, t) => n + (t.size || 0), 0);
  // 余量预检：解压瞬时占用按 1.5 倍估，再留 64MB 给插件自己写
  const free = freeSpaceBytes(ctx.app);
  if (free !== null && free < total * 1.5 + 64 * 1024 * 1024) {
    ui.sub.textContent = `磁盘余量不足：需要约 ${sizeText(total * 1.5 + 64 * 1024 * 1024)}，当前只剩 ${sizeText(free)}。清理磁盘后重试。`;
    const again = button('bz-setup-btn bz-setup-btn--cta', '返回清单');
    again.onclick = () => void stageResources(ctx, st, ui);
    ui.foot.appendChild(again);
    return;
  }
  let doneBytes = 0;
  for (const t of tasks) {
    const row = rowEl();
    const mark = markEl('busy');
    const val = valEl('进行中');
    row.append(mark, keyEl(t.label, t.desc), val);
    list.appendChild(row);
    try {
      await t.run((text) => {
        // 单项的进度直接写在这一行（Node 那一项会走到 42% · 15 MB / 36 MB）
        val.textContent = text;
      });
      doneBytes += t.size || 0;
      mark.className = 'bz-setup-mark bz-setup-mark--ok';
      val.textContent = '已就绪';
    } catch (e) {
      st.failed.push(t.label);
      mark.className = 'bz-setup-mark bz-setup-mark--bad';
      val.textContent = '失败';
      console.warn(`[bz] 首次准备：${t.label} 失败`, e);
    }
    const pct = total > 0 ? Math.min(99, Math.round((doneBytes / total) * 100)) : 0;
    (bar.querySelector('i') as HTMLElement).style.width = `${pct}%`;
  }
  (bar.querySelector('i') as HTMLElement).style.width = '100%';
  await markDone(ctx.app);

  // 值守是唯一「改系统状态」的一步：bundle 装完就在这里问一次（setupAfterInstall 自带确认框）
  if (tasks.some((t) => t.id === 'tool-dock-watch')) {
    ui.sub.textContent = '工具已就位。还有一件事需要你点头：值守要不要开机自启。';
    try {
      await setupAfterInstall(ctx.app, 'dock-watch');
    } catch (e) {
      console.warn('[bz] 值守初始化失败', e);
    }
  }
  await stageDone(ctx, st, ui);
  if (st.failed.length) {
    notice(`首次准备完成，但有 ${st.failed.length} 项失败：${st.failed.join('、')}。可在「设置 → 通用 → 在线资源」里重试`, 'warning');
  } else {
    notice('首次准备完成，环境与工具已就绪', 'success');
  }
}

/* ---------- ⑥ 完成 ---------- */
async function stageDone(ctx: WizardCtx, st: WizardState, ui: Ui): Promise<void> {
  const rows = await environmentCheck(ctx.app);
  st.rows = rows;
  ui.sub.textContent = '都就位了，接下来正常用就行。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);
  for (const r of rows) {
    list.appendChild(lineRow(markEl(r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'idle'), r.key, undefined, r.value));
  }
  if (rows.some((r) => r.id === 'python' && r.value.includes('未找到'))) {
    const hint = document.createElement('div');
    hint.className = 'bz-setup-hint';
    hint.textContent =
      '还剩一件手工活：脸谱导入微信记录要先装 Python 3。不影响其他功能，想弄的时候在「设置 → 关于 → 环境自检」里能看到。';
    ui.body.appendChild(hint);
  }
  const enter = button('bz-setup-btn bz-setup-btn--cta', '开始使用');
  enter.onclick = () => closeModal(ui);
  ui.foot.appendChild(enter);
}

/* ---------- 杂项 ---------- */

/** 「引导已走过」的本地兜底键**前缀**（设置写不进去时用它，免得每次启动都被同一张清单拦住） */
export const SETUP_DONE_FALLBACK_KEY = 'bz-setup-done';

/**
 * 兜底键要带上 vault 目录键。
 *
 * localStorage 是 Obsidian **整个应用**共用的（所有库同一个 origin），一个全局键会让
 * 「在 A 库走完引导」变成「B 库也算走完」——2026-10-28 用户报的就是这个：换一个新库打开插件，
 * 该有的首次引导一次都没弹，而那个库里 Node、工具包、文档一概没有。
 *
 * 分键之后每个库各记各的；data.json 里的 `setupDone` 本来就是按库存的，两者口径终于一致。
 */
export function setupDoneStorageKey(vault: string): string {
  const key = vaultKeyOf(vault);
  return key ? `${SETUP_DONE_FALLBACK_KEY}:${key}` : SETUP_DONE_FALLBACK_KEY;
}

/** 引导是否已走过：设置优先（按库），其次 localStorage 兜底（也按库） */
export function setupAlreadyDone(settings: { setupDone?: boolean } | null | undefined, vault = ''): boolean {
  if (settings?.setupDone === true) return true;
  try {
    return localStorage.getItem(setupDoneStorageKey(vault)) === '1';
  } catch {
    return false;
  }
}

async function markDone(app: unknown): Promise<void> {
  try {
    const s = getSettings();
    s.setupDone = true;
    await saveSettings();
  } catch {
    /* 设置未注入（测试/早期）：走下面的 localStorage 兜底 */
  }
  // 只读 vault / 落盘失败时 data.json 写不进去，光靠设置项会导致**每次启动都弹一次**——
  // 那比不弹更糟。localStorage 不依赖 data.json，作为兜底足够（键按库分，见 setupDoneStorageKey）。
  try {
    localStorage.setItem(setupDoneStorageKey(vaultBasePathOf(app)), '1');
  } catch {
    /* 无 localStorage（测试环境） */
  }
}

/** 打开首次引导 */
export function openSetupWizard(app: unknown = getApp(), opts: { firstRun?: boolean } = {}): void {
  if (isMobileEnv()) {
    notice('包仔的完整功能需要桌面端 Obsidian', 'warning');
    return;
  }
  const firstRun = opts.firstRun === true;
  const content = document.createElement('div');
  uiModal({
    head: true,
    title: firstRun ? '包仔 · 首次准备' : '环境自检',
    content,
    // 760 而不是 600（2026-10-28 用户：太窄，布局不好看）：清单是「名称——值」两列，
    // 窄窗里右侧那列只能挤成豆腐块；宽一点才读得出一条是一条。
    maxWidth: 760,
    autofocus: false,
  });
  const ctx: WizardCtx = { app, firstRun, checkOnly: !firstRun };
  const st: WizardState = {
    net: null,
    rows: [],
    storagePath: '',
    items: [],
    selected: new Set(),
    provider: DEFAULT_AI_PROVIDER,
    apiKey: '',
    aiTest: { state: 'idle', text: '' },
    failed: [],
  };
  void stageProbe(ctx, st, skeleton(content));
}

/** 设置面板「环境自检」按钮的入口（同一视图；自检模式跳过存放与 AI 两屏） */
export function openEnvironmentCheck(app: unknown = getApp()): void {
  openSetupWizard(app, { firstRun: false });
}
