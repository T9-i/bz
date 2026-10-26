/**
 * 单篇重跑自动关联（ADR-0141 §1）——两条调用方的共用体：
 * - `bz-knowledge-relink` 命令：对**当前打开的笔记**重跑（index.ts 的 relinkActiveNote）；
 * - 知识盒列表右键菜单「重跑关联」：对**选中的那一行**重跑（ui.ts）。
 *
 * 抽出来是为了让「通道不可用 / 不可达 / 盒外 / 失败」四类提示只有一份文案——
 * 命令与菜单各写一遍必然会漂移。范围口径（ADR-0141 §2）不变：**手动不豁免**，
 * 盒外笔记直接拒绝并提示；force 跳过「已有 related 不建链」的尊重门。
 */
import { tryGetSettings } from '../core/settings-provider';
import { getLinkBridge } from '../core/link-now';
import { notice } from '../core/notice';

/**
 * 对指定路径跑一遍关联管线。返回值只为测试可断（'done' / 'queued' / 'out-of-scope' /
 * 'failed' / 'skipped' / 'unavailable'）；用户可见反馈已在本函数内发完。
 */
export async function relinkNoteByPath(notePath: string): Promise<string> {
  const path = String(notePath ?? '').trim();
  if (!path) return 'skipped';
  if ((tryGetSettings() as any).linkAgentEnabled === false) {
    notice('自动关联已在知识盒设置中关闭', 'info');
    return 'unavailable';
  }
  const bridge = getLinkBridge();
  if (!bridge) {
    notice('自动关联暂不可用：第二大脑尚未就绪', 'warning');
    return 'unavailable';
  }
  try {
    const outcome = await bridge.now(path, { force: true });
    if (outcome.status === 'done') {
      notice(outcome.created > 0 ? `已新建关联 ${outcome.created} 条` : '未发现实质关联，未新建', 'success');
    } else if (outcome.status === 'queued') {
      notice('embedding 服务不可达，已加入待处理队列，服务可达后自动处理', 'info');
    } else if (outcome.status === 'out-of-scope') {
      notice('该笔记不在三个盒子内：自动关联只在文献盒、卡片盒、主题盒里生效', 'info');
    } else if (outcome.status === 'failed') {
      notice(`关联处理失败：${outcome.error}`, 'error');
    } else {
      notice('该笔记暂无法处理（文件缺失、非 Markdown 或位于加密目录）', 'info');
    }
    return outcome.status;
  } catch (e) {
    console.warn('[knowledge] 重跑关联失败', e);
    notice(`关联处理失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    return 'failed';
  }
}
