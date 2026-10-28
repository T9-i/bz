/* ============================================================
 * bz · 首次引导 / 环境自检（core/setup-wizard.ts）
 *
 * 一次把「新机器缺什么、缺的怎么补」走完。四屏：
 *
 *   ① 检测   —— 先探网络（GitHub 主通道 / jsDelivr 备用），再探本机六项
 *   ② 清单   —— 要下什么、多大、下到哪，一屏看完；这里也是唯一的「同意」动作
 *   ③ 安装   —— 同意后**全部自动**，不再逐项确认；单项失败不影响其他项
 *   ④ 完成   —— 就绪清单 + 仍需手工的项（脸谱的 Python）
 *
 * 为什么「同意」只有一次：这些动作都不改系统状态（只是往插件自己的目录里写文件），
 * 逐项确认只是把同一件事问五遍。唯一会改系统状态的是「值守注册登录自启」，
 * 那一步不在本流程里，下载完单独问（见 core/tool-setup.ts）。
 *
 * 与「设置 → 关于 → 环境自检」的关系：同一套行渲染、同一套补齐队列，
 * 区别只是首次引导会自动往下走，自检停在清单上等命令。
 * ============================================================ */
import { notice } from './notice';
import { uiModal } from './ui/modal';
import { environmentCheck, probeNetwork, type EnvCheckRow, type NetworkProbe } from './env-check';
import { refreshManifest } from './download-manifest';
import type { DownloadManifest, ManifestDocEntry } from './download-manifest';
import { installBundle } from './bundle-asset';
import { ensureAssetWithHash } from './remote-asset';
import { downloadSkinUpdates } from './skin-pack';
import { installPortableNode, PORTABLE_NODE_VERSION } from './node-runtime-install';
import { probeNodeRuntime, resetNodeRuntimeCache } from './tool-runtime';
import { isMobileEnv } from './mobile';
import { getApp } from './app';
import { getSettings, saveSettings } from './settings-provider';

/** Node 归档的估算体积（只在清单里显示，真实体积看服务端） */
const NODE_SIZE_HINT = 36.4 * 1024 * 1024;

/** 单项安装任务 */
export interface SetupTask {
  id: string;
  label: string;
  desc: string;
  /** 估算字节数（未知 = null，界面只显状态不显体积） */
  size: number | null;
  run: () => Promise<void>;
}

/** 体积人话 */
export function sizeText(bytes: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 按清单与本机状态生成补齐任务（纯函数，便于测试）。
 * 顺序刻意如此：Node 最久，放第一个——先让它跑起来，后面小包在它之后秒完，
 * 用户看到的进度是连续的，而不是「卡在 87% 一动不动」。
 */
export function buildSetupTasks(
  app: unknown,
  manifest: DownloadManifest | null,
  opts: { nodeMissing: boolean },
): SetupTask[] {
  const tasks: SetupTask[] = [];
  if (opts.nodeMissing) {
    tasks.push({
      id: 'node',
      label: 'Node 运行时',
      desc: `便携版 ${PORTABLE_NODE_VERSION}，装进插件目录`,
      size: NODE_SIZE_HINT,
      run: async () => {
        await installPortableNode(app);
        // 刚装好的运行时必须让探测缓存失效：否则同一会话里 toolReadyState 还是旧结论
        resetNodeRuntimeCache();
      },
    });
  }
  if (!manifest) return tasks;

  const bundles = manifest.docs.filter((d) => d.kind === 'bundle');
  const docs = manifest.docs.filter((d) => d.kind !== 'bundle');
  for (const e of bundles) {
    tasks.push(bundleTask(app, e));
  }
  for (const e of docs) {
    tasks.push(docTask(app, e));
  }
  const skinBytes = manifest.skins.reduce((n, s) => n + (s.size || 0), 0);
  if (manifest.skins.length) {
    tasks.push({
      id: 'skins',
      label: '主题皮肤',
      desc: `${manifest.skins.length} 套远端皮肤`,
      size: skinBytes || null,
      run: async () => {
        const r = await downloadSkinUpdates(app, manifest);
        if (r.failed > 0) throw new Error(`${r.failed} 套皮肤下载失败`);
      },
    });
  }
  return tasks;
}

function bundleTask(app: unknown, e: ManifestDocEntry): SetupTask {
  return {
    id: e.id,
    label: e.name,
    desc: '外部工具（解包到插件目录，可直接被插件调用）',
    size: e.size ?? null,
    run: async () => {
      await installBundle(app, e);
    },
  };
}

function docTask(app: unknown, e: ManifestDocEntry): SetupTask {
  return {
    id: e.id,
    label: e.name,
    desc: '文档与索引（离线可读）',
    size: e.size ?? null,
    run: async () => {
      await ensureAssetWithHash(app, e.file, e.sha256, e.name);
    },
  };
}

/** 一行的状态（界面用） */
type RowState = 'pending' | 'running' | 'ready' | 'failed' | 'idle';

interface SetupCtx {
  app: unknown;
  firstRun: boolean;
  root: HTMLElement;
  close: () => void;
}

/** 建立骨架（sub / body / foot 三段） */
function skeleton(root: HTMLElement): { sub: HTMLElement; body: HTMLElement; foot: HTMLElement } {
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

/** 第 ① 屏：检测 */
async function stageProbe(ctx: SetupCtx, ui: ReturnType<typeof skeleton>): Promise<void> {
  ui.sub.textContent = ctx.firstRun
    ? '第一次使用，先看看这台机器缺什么。不会改动你的笔记。'
    : '重新检查这台机器上的运行环境。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);

  const rowEl = (id: string, key: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'bz-setup-row';
    row.dataset.id = id;
    row.innerHTML =
      '<span class="bz-setup-mark bz-setup-mark--busy"></span>' +
      `<span class="bz-setup-key">${key}</span>` +
      '<span class="bz-setup-val">检查中</span>';
    list.appendChild(row);
    return row;
  };

  const netRow = rowEl('net', '网络 · 资源站');
  const jsRow = rowEl('net-cdn', '网络 · 备用通道');

  const paint = (row: HTMLElement, ok: boolean | null, text: string): void => {
    const mark = row.querySelector('.bz-setup-mark') as HTMLElement;
    mark.className = 'bz-setup-mark ' + (ok === true ? 'bz-setup-mark--ok' : ok === false ? 'bz-setup-mark--bad' : 'bz-setup-mark--idle');
    (row.querySelector('.bz-setup-val') as HTMLElement).textContent = text;
  };

  // 网络先跑（后面每一项下载都依赖它，先把结论摆出来）
  let net: NetworkProbe | null = null;
  try {
    net = await probeNetwork();
  } catch {
    net = null;
  }
  paint(
    netRow,
    net?.github ? true : false,
    net?.github ? `可达 · ${net.githubMs} ms` : '不可达，将走备用通道',
  );
  paint(
    jsRow,
    net?.jsdelivr ? true : null,
    net?.jsdelivr ? `可达 · ${net.jsdelivrMs} ms` : '也不可达（下载会失败）',
  );

  // 本机项
  const envRows = await environmentCheck(ctx.app);
  for (const r of envRows) {
    const row = rowEl(r.id, r.key);
    paint(row, r.ok, r.value);
  }

  const bad = envRows.filter((r) => r.ok === false).length;
  if (!net?.github && !net?.jsdelivr) {
    ui.sub.textContent = '连不上资源站：检查代理或网络后重试。插件主体仍可用，下载类功能要等网络恢复。';
  }
  await stagePlan(ctx, ui, { net, envRows, bad });
}

/** 第 ② 屏：清单 + 同意 */
async function stagePlan(
  ctx: SetupCtx,
  ui: ReturnType<typeof skeleton>,
  probe: { net: NetworkProbe | null; envRows: EnvCheckRow[]; bad: number },
): Promise<void> {
  const manifestInfo = await refreshManifest(ctx.app).catch(() => null);
  const manifest = manifestInfo?.manifest ?? null;
  const nodeMissing = probeNodeRuntime(ctx.app, { fresh: true }).kind === 'none';
  const tasks = buildSetupTasks(ctx.app, manifest, { nodeMissing });
  const total = tasks.reduce((n, t) => n + (t.size || 0), 0);

  ui.sub.textContent = tasks.length
    ? `一共 ${tasks.length} 项，约 ${sizeText(total) || '未知体积'}。点开始后自动完成，中途不用再确认。`
    : '这台机器什么都不缺，可以直接用了。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const hint = document.createElement('div');
  hint.className = 'bz-setup-hint';
  hint.textContent = !manifest
    ? '资源清单没拉到（网络不通或资源站不可达）：这一次只能补 Node 运行时，其余资源等网络恢复后在「在线资源」里补。'
    : probe.net && !probe.net.github
      ? 'GitHub 连不上：会自动改用备用通道下载，内容一样，速度可能慢一些。'
      : '下载的东西都放在插件自己的目录里，不碰笔记、不改系统设置。';
  ui.body.appendChild(hint);

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);
  for (const t of tasks) {
    const row = document.createElement('div');
    row.className = 'bz-setup-row';
    row.dataset.task = t.id;
    row.innerHTML =
      '<span class="bz-setup-mark bz-setup-mark--idle"></span>' +
      `<span class="bz-setup-key">${t.label}<em>${t.desc}</em></span>` +
      `<span class="bz-setup-val">${sizeText(t.size) || '待下载'}</span>`;
    list.appendChild(row);
  }

  const skip = button('bz-setup-btn', ctx.firstRun ? '以后再说' : '关闭');
  skip.onclick = () => {
    void markDone(ctx, false);
    ctx.close();
  };
  if (!tasks.length) {
    const ok = button('bz-setup-btn bz-setup-btn--cta', '知道了');
    ok.onclick = ctx.close;
    ui.foot.appendChild(ok);
    return;
  }
  const go = button('bz-setup-btn bz-setup-btn--cta', '开始下载');
  go.onclick = () => void stageInstall(ctx, ui, tasks);
  ui.foot.append(skip, go);
}

/** 第 ③ 屏：自动安装（无二次确认） */
async function stageInstall(ctx: SetupCtx, ui: ReturnType<typeof skeleton>, tasks: SetupTask[]): Promise<void> {
  ui.sub.textContent = '全部自动完成。可以先去用别的功能，装完会通知你。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  const bar = document.createElement('div');
  bar.className = 'bz-setup-bar';
  bar.innerHTML = '<i></i>';
  ui.body.append(bar, list);

  const closeBtn = button('bz-setup-btn', '收起来，后台继续');
  closeBtn.onclick = () => ctx.close();
  ui.foot.appendChild(closeBtn);

  const total = tasks.reduce((n, t) => n + (t.size || 0), 0);
  let doneBytes = 0;
  const failed: string[] = [];

  for (const t of tasks) {
    const row = list.querySelector(`[data-task="${t.id}"]`) as HTMLElement | null;
    const mark = row?.querySelector('.bz-setup-mark') as HTMLElement | null;
    const val = row?.querySelector('.bz-setup-val') as HTMLElement | null;
    if (mark) mark.className = 'bz-setup-mark bz-setup-mark--busy';
    if (val) val.textContent = '进行中';
    try {
      await t.run();
      doneBytes += t.size || 0;
      if (mark) mark.className = 'bz-setup-mark bz-setup-mark--ok';
      if (val) val.textContent = '已就绪';
    } catch (e) {
      failed.push(t.label);
      if (mark) mark.className = 'bz-setup-mark bz-setup-mark--bad';
      if (val) val.textContent = '失败';
      console.warn(`[bz] 首次准备：${t.label} 失败`, e);
    }
    const pct = total > 0 ? Math.min(99, Math.round((doneBytes / total) * 100)) : 0;
    (bar.querySelector('i') as HTMLElement).style.width = `${pct}%`;
  }
  (bar.querySelector('i') as HTMLElement).style.width = '100%';
  await markDone(ctx, true);
  await stageDone(ctx, ui, { tasks, failed });
  if (failed.length) {
    notice(`首次准备完成，但有 ${failed.length} 项失败：${failed.join('、')}。可在「设置 → 通用 → 在线资源」里重试`, 'warning');
  } else {
    notice('首次准备完成，环境与工具已就绪', 'success');
  }
}

/** 第 ④ 屏：完成 */
async function stageDone(
  ctx: SetupCtx,
  ui: ReturnType<typeof skeleton>,
  result: { tasks: SetupTask[]; failed: string[] },
): Promise<void> {
  const envRows = await environmentCheck(ctx.app);
  const okCount = envRows.filter((r) => r.ok === true).length;
  const stillBad = envRows.filter((r) => r.ok === false);
  ui.sub.textContent = result.failed.length
    ? `有 ${result.failed.length} 项没装上，其余已就绪。`
    : '都就位了，接下来正常用就行。';
  ui.body.innerHTML = '';
  ui.foot.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'bz-setup-list';
  ui.body.appendChild(list);
  for (const r of envRows) {
    const row = document.createElement('div');
    row.className = 'bz-setup-row';
    row.innerHTML =
      `<span class="bz-setup-mark ${r.ok === true ? 'bz-setup-mark--ok' : r.ok === false ? 'bz-setup-mark--bad' : 'bz-setup-mark--idle'}"></span>` +
      `<span class="bz-setup-key">${r.key}</span>` +
      `<span class="bz-setup-val">${r.value}</span>`;
    list.appendChild(row);
  }
  if (!stillBad.length) {
    const hint = document.createElement('div');
    hint.className = 'bz-setup-hint';
    hint.textContent = `环境检查通过（${okCount} 项）。脸谱导入微信记录还需要本机 Python 环境，用到时再装即可。`;
    ui.body.appendChild(hint);
  }
  const enter = button('bz-setup-btn bz-setup-btn--cta', '开始使用');
  enter.onclick = ctx.close;
  ui.foot.appendChild(enter);
}

/** 记下「首次准备已完成」（跳过的也记：不能每次启动都重新弹） */
async function markDone(ctx: SetupCtx, installed: boolean): Promise<void> {
  try {
    const s = getSettings();
    s.setupDone = true;
    await saveSettings();
  } catch {
    /* 设置未注入（测试/早期）：不影响本次流程 */
  }
  void installed;
}

/**
 * 打开首次引导。`firstRun` 只影响文案（首次会说「以后再说」，自检会说「关闭」）。
 */
export function openSetupWizard(app: unknown = getApp(), opts: { firstRun?: boolean } = {}): void {
  const firstRun = opts.firstRun === true;
  if (isMobileEnv()) {
    notice('包仔的完整功能需要桌面端 Obsidian', 'warning');
    return;
  }
  const content = document.createElement('div');
  const modal = uiModal({
    head: true,
    title: firstRun ? '包仔 · 首次准备' : '环境自检',
    content,
    maxWidth: 560,
    autofocus: false,
  });
  const ctx: SetupCtx = { app, firstRun, root: content, close: modal.close };
  const ui = skeleton(content);
  void stageProbe(ctx, ui);
}

/** 设置面板「环境自检」按钮的入口（同一个视图，不另做一套） */
export function openEnvironmentCheck(app: unknown = getApp()): void {
  openSetupWizard(app, { firstRun: false });
}
