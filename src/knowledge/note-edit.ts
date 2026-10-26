/**
 * 知识盒 · 笔记 frontmatter 行级手术（2026-10-26 列表右键菜单：添加 / 删除来源、改领域）
 *
 * 口径与 source.ts 的 upgradeSourceLine / retireSourceLine 完全一致：
 * **只动命中的那几行**，其余键、正文、缩进与换行符零扰动——绝不做整体 YAML 重序列化
 * （用户的 frontmatter 可能是手写的、带注释的、键序有意义的）。
 *
 * 不含「读笔记 → 改 → 写盘」的 IO；那一层在 writeNoteFm（写口径与 note-gen 的
 * upgradeNoteSourceInFile 同源：读一次、有变化才写、失败静默返回 false）。
 */
import type { App } from 'obsidian';
import { quoteYaml } from './source';

/** 一条键改动：value 为 null = 删掉该键（键不存在则无操作） */
export interface FmEdit {
  key: string;
  value: string | null;
}

/** 正则元字符转义（键来自代码常量，这里只做防御，别让未来的动态键炸出意外匹配） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 改写 frontmatter 里的若干键，返回新全文。
 * - 键已存在 → 整行替换（值走 quoteYaml，与 note-gen 落盘同范式）
 * - value 为 null → 删掉该行；键不存在 = 无操作
 * - 键不存在且值非空 → 追加到 frontmatter 末尾（关闭 `---` 之前），按 edits 顺序
 * - 没有 frontmatter → 前置造一个只含这些键的块；全是删键则原样返回
 * - 换行符保真（CRLF 文件不会被悄悄改行尾）；同一键有多行时只动第一行
 * - 幂等：写同样的值再跑一次，输出不变
 */
export function setFrontmatterKeys(content: string, edits: FmEdit[]): string {
  const src = String(content ?? '');
  if (!edits.length) return src;
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const hasFm = lines[0]?.trim() === '---';
  let close = -1;
  if (hasFm) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { close = i; break; }
    }
  }
  // 无 frontmatter：只造新增项（删键没有落点，直接忽略）
  if (!hasFm || close === -1) {
    const add = edits.filter((e) => e.value !== null);
    if (!add.length) return src;
    const head = add.map((e) => `${e.key}: ${quoteYaml(e.value!)}`).join(eol);
    const body = src.replace(/^(?:\r?\n)+/, '');
    return `---${eol}${head}${eol}---${eol}${eol}${body}`;
  }
  const append: string[] = [];
  for (const e of edits) {
    const re = new RegExp(`^${escapeRe(e.key)}\\s*:`);
    let at = -1;
    for (let i = 1; i < close; i++) {
      if (re.test(lines[i])) { at = i; break; }
    }
    if (at === -1) {
      if (e.value !== null) append.push(`${e.key}: ${quoteYaml(e.value)}`);
      continue;
    }
    if (e.value === null) {
      lines.splice(at, 1);
      close--;
    } else {
      lines[at] = `${e.key}: ${quoteYaml(e.value)}`;
    }
  }
  if (append.length) lines.splice(close, 0, ...append);
  return lines.join(eol);
}

/**
 * 把改动写进库内笔记。返回 true = 真的写了盘（调用方据此决定要不要就地更新列表）。
 * 文件缺失 / 读失败 / 内容无变化 → false 静默（与 upgradeNoteSourceInFile 同语义）。
 */
export async function writeNoteFm(app: App, notePath: string, edits: FmEdit[]): Promise<boolean> {
  const path = String(notePath ?? '').trim();
  if (!path || !edits.length) return false;
  const file = app.vault.getAbstractFileByPath(path);
  if (!file || (file as any).isFolder) return false;
  let raw = '';
  try {
    raw = await app.vault.read(file as any);
  } catch {
    return false;
  }
  const next = setFrontmatterKeys(raw, edits);
  if (next === raw) return false;
  await app.vault.modify(file as any, next);
  return true;
}
