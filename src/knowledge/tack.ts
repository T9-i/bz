/**
 * 知识盒 · 挂到笔记（2026-10-26；文案「挂到笔记…」，代码标识 tack）
 *
 * 把一条**素材型文献**（图版 / 影像）里的媒体，挂到另一篇**已存在的笔记**末尾——
 * 目标笔记原有正文一个字不动，只在尾部追加一段 quote callout：
 *
 * ```
 * > [!quote] [[王虹证明三维挂谷集维数为三并解释转针问题]]
 * > ![[CONFIG/APPENDIX/xxx_BV1Z6H56oEcQ.mp4]]
 * ```
 *
 * 口径：
 * - **只搬嵌入，不搬正文**。转录/解读留在源笔记里（它才是那段文字的家），目标笔记拿到的
 *   是「这里有一条材料，内容去那篇看」——搬正文会让同一段文字在库里出现两份，向量索引
 *   重复、每周动态报「高度重合」，且从此双写分叉。
 * - **幂等**：块头 `> [!quote] <源双链>` 就是锚点。再挂一次不叠加，整块就地换成最新嵌入
 *   （源笔记换了视频也能跟上）。用户手删掉块 = 取下，重挂照常生效。
 * - **换行符保真**：CRLF 文件追加后仍是 CRLF；尾部原有的多个空行收成一个，块前恰好一个空行。
 */
import type { App } from 'obsidian';

/** 去掉 YAML frontmatter（只认文件首行的 `---` 块，与 note-edit 的判据同源）；换行符保真 */
export function stripFrontmatter(content: string): string {
  const src = String(content ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return src;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return lines.slice(i + 1).join(eol);
  }
  return src;
}

/**
 * 抽出正文里的媒体嵌入，原样返回 `![[…]]` 片段（含尺寸别名）。
 * 去重保序：同一张图在一次挂载里只出现一次。
 */
export function mediaEmbedsOf(content: string): string[] {
  const body = stripFrontmatter(content);
  const re = /!\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g; // 局部实例：全局正则的 lastIndex 不跨调用残留
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(re)) {
    const hit = m[0];
    const key = m[1].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/**
 * 源笔记路径 → 块头里的双链：**只留标题，不带目录**（`文献盒/挂谷集.md` → `[[挂谷集]]`）。
 * 块头是给人看的一行，带路径会把 callout 标题撑得很长；重名时的消歧交给 Obsidian
 * （同名笔记的链接在编辑器里会显示完整路径，用户一眼能看出来）。
 */
export function tackLinkOf(notePath: string): string {
  const base = String(notePath ?? '').replace(/\\/g, '/').split('/').pop() || '';
  const name = base.replace(/\.md$/i, '').trim();
  return name ? `[[${name}]]` : '';
}

/** 组装挂载块（不含前后空行；每行带 `> ` 前缀，空行不带） */
export function tackBlock(link: string, embeds: string[]): string {
  const head = `> [!quote] ${link}`;
  return [head, ...embeds.map((e) => `> ${e}`)].join('\n');
}

/**
 * 追加或就地更新挂载块，返回新全文 + 是否真的变了。
 * - 已有同源块 → 整块替换（块范围 = 块头行起，往下吃连续的 `>` 行与块内空行，
 *   遇到「非空且不以 `>` 开头」的行即止）
 * - 没有 → 正文右裁空白后补一个空行再追加
 */
export function upsertTackBlock(
  content: string,
  link: string,
  embeds: string[],
): { text: string; action: 'added' | 'updated' } {
  const src = String(content ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const block = tackBlock(link, embeds);
  const lines = src.split(/\r?\n/);

  const headAt = lines.findIndex((l) => l.trim() === `> [!quote] ${link}`);
  if (headAt >= 0) {
    // 块范围 = 从块头起的连续 `>` 行。遇到空行即止——同一篇笔记连挂两条材料时，
    // 两块之间就靠这个空行分界，多吃的写法会把下一块吞进这一块。
    let end = headAt;
    while (end + 1 < lines.length && lines[end + 1].trim().startsWith('>')) end++;
    const next = [...lines.slice(0, headAt), ...block.split('\n'), ...lines.slice(end + 1)];
    return { text: next.join(eol), action: 'updated' };
  }

  const body = src.replace(/\s+$/, '');
  const tail = block.split('\n').join(eol); // 块内部用 \n 组装，落盘按目标文件的行尾改写
  const text = body ? body + eol + eol + tail + eol : tail + eol;
  return { text, action: 'added' };
}

export type TackResult = 'added' | 'updated' | 'no-media' | 'no-target' | 'failed';

/**
 * 把 sourcePath 里的媒体挂到 targetPath 末尾。调用方负责「选哪篇」与 toast；
 * 这里只做「读源 → 抽嵌入 → 读目标 → 追加 → 写盘」，失败一律返回枚举不抛。
 */
export async function tackMediaToNote(
  app: App,
  sourcePath: string,
  targetPath: string,
): Promise<TackResult> {
  const srcPath = String(sourcePath ?? '').trim();
  const dstPath = String(targetPath ?? '').trim();
  if (!srcPath || !dstPath || srcPath === dstPath) return 'failed';
  const srcFile = app.vault.getAbstractFileByPath(srcPath);
  const dstFile = app.vault.getAbstractFileByPath(dstPath);
  if (!srcFile || !dstFile || (dstFile as any).isFolder) return 'no-target';
  let srcRaw = '';
  try {
    srcRaw = await app.vault.read(srcFile as any);
  } catch {
    return 'failed';
  }
  const embeds = mediaEmbedsOf(srcRaw);
  const link = tackLinkOf(srcPath);
  if (!embeds.length || !link) return 'no-media';
  let dstRaw = '';
  try {
    dstRaw = await app.vault.read(dstFile as any);
  } catch {
    return 'failed';
  }
  const { text, action } = upsertTackBlock(dstRaw, link, embeds);
  if (text === dstRaw) return action; // 内容一致：不写盘（省一次磁盘事件）
  try {
    await app.vault.modify(dstFile as any, text);
  } catch {
    return 'failed';
  }
  return action;
}
