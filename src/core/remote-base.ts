/* ============================================================
 * bz · 仓库双源基址（core/remote-base.ts，零依赖叶子模块）
 *
 * 全仓**唯一事实源**——资源通道（remote-asset 的 downloads/ 资产）与插件
 * 自更新（self-update 的仓库根三件套）都从这里取双源地址，杜绝两处各写一份
 * 字面量导致漂移。
 *
 * 通道口径：GitHub raw **主** → jsDelivr **备**（国内被墙时的第二通道）；
 * 两路都 404/失败才报错，且第一个成功的就用——见两消费方各自的行为语义。
 *
 * ---------- 两条分支：master 与 tag（2026-10-28 对外分发） ----------
 *
 * 此前只有 master 一条路：自更新拉 `@master` 的三件套，等于「谁装了就吃主干的最新提交」。
 * 自用顺手，给别人用是事故面——推一次半成品，所有用户当场变砖。
 * 现在分成两条：
 *
 * | 用途 | 分支 | 谁用 |
 * |---|---|---|
 * | 发布指针 `downloads/version.json`、`downloads/` 下的在线资源 | master | 恒指向**最新发布**，只读一个小文件 |
 * | 插件本体三件套（main.js / styles.css / manifest.json） | **tag** | 只有对得上 tag 的提交才配当发布物 |
 *
 * 指针与产物分离的理由：`version.json` 必须能在「还没决定装不装」的时候读到，它只能住在
 * 一个恒定可达的地方；而它指向的 tag 才是版本的真身。这样「检查更新」只花几百字节。
 * ============================================================ */

/** 仓库 slug（`<owner>/<repo>`）——GitHub raw 与 jsDelivr 的唯一出处 */
export const REPO_SLUG = 'yeshimei/bz';

// 只读设置（type-only import 在 settings-provider 里已擦除，不会成环）。
// 静态导入而不是 require：vite/ESM 下没有 require，懒加载写法在测试与将来的构建形态里会静默失效。
import { tryGetSettings } from './settings-provider';

/** jsDelivr 的四个入口（同一个 CDN 的不同边缘域名）。
 *
 *  为什么不是只有 cdn.jsdelivr.net：国内实测 2026-10-28 **cdn 与 raw 同时不通**
 *  （`code=000`，1.2s / 0.5s 两个都连不上），而 fastly / gcore / testingcf 三个入口
 *  全通（200）。它们指向同一份内容，只是边缘域名不同——这是零成本的冗余。 */
const JSDELIVR_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net'];

/** 仓库多通道基址（master 分支），按「新鲜度优先」排：
 *  raw（无缓存，最真实）→ cdn → fastly → gcore → testingcf（后三个是国内能通的那几个）。
 *  唯一事实源——资源通道（remote-asset）、发布指针、插件自更新共用。
 *
 *  代价说明：国内无代理时会先撞两个不通的（约 1.7s）再落到能用的那个。这个顺序是刻意的——
 *  jsDelivr 对 `@master` 有缓存（分钟到小时级），把指针文件放前面会让「检查更新」读到旧值。 */
export const REPO_BASES = [
  `https://raw.githubusercontent.com/${REPO_SLUG}/master`,
  ...JSDELIVR_HOSTS.map((h) => `https://${h}/gh/${REPO_SLUG}@master`),
];

/**
 * 发布指针（master 上的小文件）：`{ "version": "1.34.0", "tag": "v1.34.0" }`。
 *
 * 为什么不是 GitHub API 的 `releases/latest`：那个域名限流（未登录 60 次/小时，按 IP 算，
 * 同一出口的整个局域网共用）且国内常在超时名单里；而本指针走的是与在线资源同一套双源，
 * 失败口径、缓存口径、被墙兜底全部复用，不引入第二条网络栈。
 */
export const RELEASE_POINTER = 'version.json';

/** tag 名的合法形状（防把远端返回的脏串拼进 URL 造出别的地址） */
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** tag 是否可安全拼进 URL（空串/含斜杠/含空白一律 false） */
export function isValidTag(tag: unknown): boolean {
  return typeof tag === 'string' && TAG_RE.test(tag);
}

/**
 * 某个 tag 的双源基址。tag 不合法 → 空数组（调用方据此判「这条发布不可用」，
 * 而不是拿一个拼坏了的 URL 去撞网络）。
 *
 * GitHub raw 用 `refs/tags/<tag>` 而不是裸 `<tag>`：裸写法在 tag 与分支同名时解析到
 * 分支，refs/tags 是无歧义的那种写法。jsDelivr 的 tag 语法本来就是 `@<tag>`。
 */
export function tagBasesFor(tag: string): string[] {
  if (!isValidTag(tag)) return [];
  return [
    `https://raw.githubusercontent.com/${REPO_SLUG}/refs/tags/${tag}`,
    ...JSDELIVR_HOSTS.map((h) => `https://${h}/gh/${REPO_SLUG}@${tag}`),
  ];
}

/** 仓库根文件的双源 URL（master；用于发布指针这类「恒取最新」的小文件）。
 *  含用户自定义镜像在前——只用镜像的封闭网络里也能检查更新。 */
export function repoRemotesFor(name: string): string[] {
  return repoBases().map((b) => `${b}/${name}`);
}

/** 某个 tag 下仓库根文件的双源 URL（自更新三件套：manifest.json / main.js / styles.css） */
export function repoRemotesForTag(tag: string, name: string): string[] {
  return tagBasesFor(tag).map((b) => `${b}/${name}`);
}

/** downloads/ 资产的双源 URL（fileName 是相对 downloads/ 的路径，可为多级） */
export function downloadRemotesFor(fileName: string): string[] {
  return repoBases().map((b) => `${b}/downloads/${fileName}`);
}

/* ============================================================
 * 自定义镜像（企业内网 / 无外网环境）
 *
 * 上面那五条通道都在公网。公司网里可能**全部**不通，那时除了「改系统代理」之外没有别的路 ——
 * 而系统代理不是每个人都有权限改。所以留一个口子：用户自己填基址（内网 nginx 静态目录、
 * 自建镜像都行），下载时**优先**走它。
 *
 * 地址形状必须与仓库一致（`<基址>/downloads/xxx`），这样「把仓库 downloads/ 目录挂到
 * nginx 上」就是全部工作量。镜像只影响**资源下载**（master 路径）；插件自更新的三件套
 * 仍走官方 tag —— 让用户自己镜像主程序，出问题时没人分得清是谁的锅。
 *
 * 读设置是惰性的（每次调用现读）：改完镜像点保存立刻生效，不需要重载插件。
 * `core/settings-provider.ts` 只有 type import，不会与这里成环。
 * ============================================================ */

/** 一条镜像基址的合法形状（只接受 http/https，去尾斜杠；空/非法 → 空串） */
export function normalizeMirrorBase(raw: unknown): string {
  const text = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(text)) return '';
  return text;
}

/** 用户填的镜像基址（空格/逗号/换行分隔，可多条；读不到设置 → 空数组） */
export function mirrorBases(): string[] {
  try {
    const raw = String((tryGetSettings() as { resourceMirror?: unknown }).resourceMirror ?? '');
    return raw
      .split(/[\s,;]+/)
      .map(normalizeMirrorBase)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 实际使用的通道（镜像在前，官方通道在后兜底） */
export function repoBases(): string[] {
  const mirror = mirrorBases();
  return mirror.length ? [...mirror, ...REPO_BASES] : REPO_BASES;
}
