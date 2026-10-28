/* ============================================================
 * bz · 设置面板「关于」组（core/about-group.ts）
 *
 * 通用页**最上面**那一组（2026-10-28 对外分发）：版本 / 自动更新 / 反馈 / 赞赏。
 * 四行的分工与边界：
 *
 *  - **版本**（info 行 + 动作钮）：运行中版本为真值；磁盘比运行中新时补一句
 *    「已下载 vX，重载后生效」——不补的话用户会看到「更新完了但版本号没变」。
 *    动作钮 = 「检查并更新」：人点了就装（等价于显式同意），与 autoUpdate 开关无关。
 *  - **自动更新**（toggle）：只管「启动时会不会自己装」，缺省关（对外分发的缺省必须是关，
 *    见 core/self-update.ts 文件头）。关着也仍会检查——面板照样能看见「有新版」。
 *  - **反馈**：直接开 GitHub issues（仓库地址单源在 core/remote-base.ts 的 REPO_SLUG）。
 *  - **赞赏**：**暂时只有位置，没有任何内容**（用户 2026-10-28 拍板）。做成 info 行而不是
 *    空 button——入口在，但不给一个点了没反应的按钮。将来放微信/支付宝收款码时就地改成
 *    button 行 + 弹窗，收款码图片走在线资源下发（不塞进 main.js）。
 *
 * 为什么是组而不是页头：页头是影院式整宽头行、只放标题（ADR-0104 markup 单源），
 * 往里塞版本号要动两侧壳；而组卡片是现成的、跟通用页其余部分同一套视觉。
 * ============================================================ */
import { getApp } from './app';
import { notice } from './notice';
import { openExternalUrl } from './utils';
import { REPO_SLUG } from './remote-base';
import { checkSelfUpdate, selfUpdateState, type SelfUpdateState } from './self-update';
import type { GroupDecl, SettingsRow } from './settings-schema';

/** 反馈渠道（GitHub issues；仓库 slug 与下载通道同一事实源） */
export const FEEDBACK_URL = `https://github.com/${REPO_SLUG}/issues`;

/** 版本行的描述文案（一句自然句，无符号花样——设置项文案规范） */
export function versionDesc(st: SelfUpdateState): string {
  const base = st.running ? `v${st.running}` : '版本未知';
  if (st.pending) return `${base}，已下载 v${st.pending}，重载后生效`;
  if (st.available) return `${base}，有新版本 v${st.available.version}`;
  if (st.error) return `${base}，上次检查更新失败`;
  return base;
}

/**
 * 「关于」组（通用页首组）。异步是因为版本行要读磁盘 manifest + 上次检查结果
 * （与在线资源组同款：行文案来自本地事实，不联网）。
 */
export async function aboutGroup(): Promise<GroupDecl> {
  const app = getApp();
  const st = await selfUpdateState(app);

  const versionRow: SettingsRow = {
    type: 'info',
    name: '版本',
    desc: versionDesc(st),
    help:
      '「检查并更新」会立刻去仓库取最新发布：有新版本就装下来，重载插件后生效。' +
      '装之前会把当前版本备份进插件目录的 downloads/.backup 里。',
    actions: [
      {
        // 人在场点的，一律按「同意装」处理：与 autoUpdate 开关无关
        text: '检查并更新',
        stateful: true,
        onClick: () => void runCheckAndUpdate(),
      },
    ],
  };

  const autoUpdateRow: SettingsRow = {
    type: 'toggle',
    name: '自动更新',
    desc: '启动时自动检查并安装新版本',
    help:
      '关闭时只在打开这个面板时提示有没有新版本，不会动插件文件。' +
      '开启后每次启动会在后台静默检查一次（24 小时内不重复），发现新版本直接安装。',
    binding: { key: 'autoUpdate' },
  };

  const feedbackRow: SettingsRow = {
    type: 'button',
    name: '反馈',
    desc: '有问题或建议，去 GitHub 提 issue',
    buttonText: '打开',
    onClick: () => openExternalUrl(getApp(), FEEDBACK_URL),
  };

  // 环境自检（2026-10-28 对外分发）：把「这台机器上缺什么」一次说清。
  // 放在关于组而不是在线资源组：它回答的是「我这台机器能不能用」，与「下什么」是两件事。
  const envRow: SettingsRow = {
    type: 'button',
    name: '环境自检',
    desc: '查 Node、工具、数据目录是否就绪',
    buttonText: '检查',
    onClick: () => void import('./setup-wizard').then((m) => m.openEnvironmentCheck(getApp())),
  };

  const rewardRow: SettingsRow = {
    type: 'info',
    name: '赞赏',
    desc: '微信与支付宝收款码稍后放上',
  };

  return {
    name: '关于',
    icon: 'info',
    rows: [versionRow, autoUpdateRow, envRow, feedbackRow, rewardRow],
  };
}

/**
 * 检查并更新（版本行的动作）。
 *
 * 失败**要说话**：这与启动巡检相反——那是后台自动动作，失败了弹脸是骚扰；这里是用户
 * 亲手点的，什么都不发生才叫 bug。`stateful` 已经把结果画在按钮上（✓ / ✕），所以只补
 * 一条带原因的短通知，不重复报「成功」。
 */
async function runCheckAndUpdate(): Promise<void> {
  const app = getApp();
  try {
    const result = await checkSelfUpdate(app, { throttle: false, apply: true });
    if (result === 'current') notice('已是最新版本', 'info');
  } catch (e) {
    notice(`检查更新失败：${(e as Error)?.message || String(e)}`, 'error');
  }
}
