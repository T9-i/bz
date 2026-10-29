/* ============================================================
 * bz · 首页时间线文案（home/timeline-copy.ts）
 *
 * 时间线是「回忆流」，不是操作日志：动词在前、不写主语、作品用《》、条目与站点用『』。
 * 这些字符串**只能住在这里**——散在十几个采集函数里，改一次口径要翻遍 home 域。
 *
 * 行长：渲染层按容器宽度截断，这里把语义部分控制在 60 字以内，超了先自己截，
 * 免得截在「全球 12.3% 拥…」这种半句上。
 * ============================================================ */

/** 作品名（电影、书、剧、游戏）。笔记的文件名本身常带《》，先剥掉再套，免得出现《《片名》》 */
function work(title: string): string {
  const bare = String(title ?? '').trim().replace(/^《+/, '').replace(/》+$/, '');
  return `《${bare}》`;
}

/** 条目名（备忘录、收藏、成就、联系人、工具） */
function item(name: string): string {
  const bare = String(name ?? '').trim().replace(/^『+/, '').replace(/』+$/, '');
  return `『${bare}』`;
}

/** 截到 n 个字，超了补省略号（按码点算，中文不劈半） */
export function clip(text: string, n: number): string {
  const chars = [...String(text ?? '').trim()];
  if (!chars.length) return '';
  return chars.length <= n ? chars.join('') : chars.slice(0, n).join('') + '…';
}

/** 金额：整数不带小数，有零头保留两位 */
function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`;
}

/** 用天数补一句「用了几天」；不足一天返回空串 */
function daysPhrase(days: number | null): string {
  if (days === null || !Number.isFinite(days) || days < 1) return '';
  return `，用了 ${Math.round(days)} 天`;
}

export const COPY = {
  /* ---------- 记录 ---------- */
  diary: (kind: string, chars: number): string =>
    `写了一段${kind || '日记'}${chars > 0 ? `，${chars} 字` : ''}`,
  letter: (title: string): string => `写了信${item(title)}`,

  memoAdd: (title: string, due: string): string =>
    `记下${item(title)}${due ? `，${due} 前要办` : ''}`,
  memoDone: (title: string, days: number | null): string =>
    `办完${item(title)}${days !== null ? `，挂了 ${Math.max(1, Math.round(days))} 天` : ''}`,

  belongingsAdded: (name: string, price: unknown): string => {
    const m = money(price);
    return `登记了${item(name)}${m ? ` · ${m}` : ''}`;
  },
  belongingsIdle: (name: string): string => `把${item(name)}挂成闲置`,
  belongingsSold: (name: string, price: unknown): string => {
    const m = money(price);
    return `转卖了${item(name)}${m ? `，回了 ${m}` : ''}`;
  },
  belongingsDiscard: (name: string): string => `把${item(name)}丢掉了`,

  /* ---------- 阅读观影 ---------- */
  cinemaWant: (title: string): string => `把${work(title)}加入片单`,
  cinemaWatching: (title: string): string => `开始看${work(title)}`,
  cinemaWatched: (title: string, rating: number | null): string =>
    `看完${work(title)}${rating !== null ? `，给了 ★${rating}` : ''}`,
  cinemaReview: (title: string, excerpt: string): string =>
    `写了${work(title)}的影评${excerpt ? `：${excerpt}` : ''}`,
  cinemaRewatch: (title: string, times: number): string =>
    `重温${work(title)}${times > 1 ? `，第 ${times} 次` : ''}`,

  bookStart: (title: string): string => `翻开${work(title)}`,
  bookDone: (title: string, days: number | null): string => `读完${work(title)}${daysPhrase(days)}`,
  bookReview: (title: string): string => `写了${work(title)}的书评`,

  gameAchievement: (achievement: string, game: string, percent: number | null): string =>
    `解锁${item(achievement)}（${work(game)}${percent !== null ? ` · 全球 ${percent}% 拥有` : ''}）`,
  gamePlayed: (game: string, hours: number | null): string =>
    `玩了${work(game)}${hours !== null && hours > 0 ? `，累计 ${hours} 小时` : ''}`,

  clipSaved: (title: string): string => `收藏文章${item(title)}`,

  /* ---------- 收集与知识 ---------- */
  favSaved: (name: string, desc: string): string =>
    `收藏了${item(name)}${desc ? ` —— ${desc}` : ''}`,
  favArchived: (name: string): string => `把${item(name)}收进归档`,

  knowledgeTerm: (name: string): string => `生成术语${item(name)}`,
  knowledgePassage: (name: string): string => `整理段落${item(name)}`,
  knowledgeImage: (name: string): string => `读图${item(name)}`,
  knowledgeVideo: (name: string): string => `转化视频${item(name)}`,
  knowledgeDone: (name: string): string => `处理完${item(name)}`,

  /* ---------- 学习与专注 ---------- */
  reviewAdded: (note: string): string => `${work(note)}加入复习`,
  reviewRound: (count: number): string => `复习了 ${count} 条`,
  pomodoro: (minutes: number, task: string): string =>
    task ? `专注 ${minutes} 分钟 · ${task}` : `专注了 ${minutes} 分钟`,

  /* ---------- 安全与其它 ---------- */
  vaultLocked: (count: number): string => `锁入 ${count} 篇笔记`,
  peopleAdded: (name: string): string => `添加了联系人${item(name)}`,
  peopleNote: (name: string, excerpt: string): string =>
    `给${item(name)}记了一笔${excerpt ? `：${excerpt}` : ''}`,
  dockRun: (tool: string, seconds: number | null): string =>
    `跑了${item(tool)}${seconds !== null ? `，用时 ${seconds} 秒` : ''}`,
};
