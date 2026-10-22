/**
 * 展示板动作（ADR-0247）：把 `panel.html` 里的一条 href 变成一次真正的运行。
 *
 * 为什么单独一个模块：
 *  - 动作链接两侧都走宿主挂的 click 监听（ADR-0247）：框里能不能跑脚本不改变这一条 ——
 *    白名单与参数掐口必须由宿主做，交给框里自己判断就等于没有门。这条路的全部逻辑 ——
 *    认出 `#bz-act:`、查声明、掐参数、拼命令行 —— 都在这里，UI 那边只负责弹框和调 runner。
 *  - 三段都是纯函数，node 能直接加载，便于单测（与 `registry.ts` / `schema.ts` 同口径）。
 *
 * 边界（ADR-0247 定的三条，缺一条就等于开了远程执行）：
 *  1. **声明即白名单**：`manifest.actions` 里没有的 id，一律拒。
 *  2. **参数不能自由拼**：href 里出现声明之外的参数名、或值不合类型（`appid` 只收数字），整条拒。
 *  3. **模板只做替换**：`run.args` 里写死的部分来自声明（受信任的作者），href 只填 `{{...}}` 的洞。
 */

import { DOCK_ACTION_ID_RE, type DockActionArg, type DockActionSpec } from './schema';

/** href 的前缀。用 `#` 锚点而不是自定义协议 —— 没被拦下时只是框内跳一下，不会有副作用 */
export const ACT_HREF_PREFIX = '#bz-act:';

/** `text` 类型值的长度上限（防把整个展示板塞进一个参数里） */
const TEXT_MAX_LEN = 200;
/** 多值最多几个（`?appid=1,2,3...`） */
const MANY_MAX = 50;

/**
 * `text` 里一个都不收的字符。
 *
 * 为什么连这些也要掐：声明里写了 `shell: true` 的工具（Windows 的 .cmd / .bat 必须这么写），
 * `spawn` 在 shell 模式下**只是把 args 拼成一行字符串**，不做转义 —— 值里一个 `&` 就能接上
 * 第二条命令。而 `text` 的用途本来就是「简单的标识符 / 名字」，不缺这些字符；
 * 真要传带标点的长文本，该走脚本自己的参数文件，不该从展示板的 href 里过。
 *
 * `%` 是 cmd 的变量展开、`^` 是转义符、`!` 是延迟展开，同样收掉。
 * 空格**留着**：shell 模式下它只会把值拆成两个参数（行为错，但不会注入）。
 */
const TEXT_BANNED_RE = /[&|<>^%!"'`\\;$(){}\[\]]/;

/** 从 href 里解析出来的东西：动作 id + 原始参数（值已 decode，未校验） */
export interface ParsedActRef {
  id: string;
  args: Record<string, string>;
}

/**
 * 认一条 href 是不是动作引用。不是就返回 null（调用方据此把链接交回原来的处理）。
 *
 * 形态：`#bz-act:<id>` 或 `#bz-act:<id>?k=v&k2=v2`
 * （id 里允许冒号，所以取第一个 `?` 之前的部分当 id，不按冒号切）。
 *
 * 永不抛：href 里可能有任意垃圾（它来自工具写的 HTML）。
 */
export function parseActHref(href: string): ParsedActRef | null {
  const s = String(href ?? '').trim();
  if (!s.startsWith(ACT_HREF_PREFIX)) return null;
  const body = s.slice(ACT_HREF_PREFIX.length);
  if (!body) return null;

  const q = body.indexOf('?');
  const rawId = (q < 0 ? body : body.slice(0, q)).trim();
  if (!rawId || rawId.length > 64 || !DOCK_ACTION_ID_RE.test(rawId)) return null;

  const args: Record<string, string> = {};
  if (q >= 0) {
    const sp = new URLSearchParams(body.slice(q + 1));
    for (const [k, v] of sp) {
      // 同名多次出现只认第一个：后面那些要么是手误，要么是有人想覆盖
      if (!(k in args)) args[k] = v;
    }
  }
  return { id: rawId, args };
}

export type ActArgsResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; reason: string };

/** 单个值的校验。`appid` 只收数字；`text` 掐长度、禁控制字符、禁 shell 元字符、禁以 `-` 开头 */
function checkValue(type: DockActionArg['type'], v: string): string | null {
  if (type === 'appid') {
    return /^\d{1,10}$/.test(v) ? v : null;
  }
  // text：不能以 `-` 开头（否则在 shell:true 的声明里会被当成另一个开关），
  // 不能带控制字符与换行（换行在 cmd 里等于命令分隔），不能带 shell 元字符（见 TEXT_BANNED_RE）。
  // 不做 HTML 转义 —— 它只进命令行，不进 DOM。
  if (v.length === 0 || v.length > TEXT_MAX_LEN) return null;
  if (/^-/.test(v)) return null;
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  if (TEXT_BANNED_RE.test(v)) return null;
  return v;
}

/**
 * 按声明掐一遍参数。
 *
 * 拒掉的三种情形，理由都写进 `reason` —— 会原样显示给用户，
 * 「为什么点了没反应」必须当场能回答，而不是回头翻日志。
 */
export function resolveActArgs(
  spec: DockActionSpec,
  raw: Record<string, string>,
): ActArgsResult {
  const declared = spec.args ?? {};
  const out: Record<string, string> = {};

  for (const [k, v] of Object.entries(raw)) {
    if (!(k in declared)) return { ok: false, reason: `动作没声明参数「${k}」` };
    const arg = declared[k];
    const list = arg.many ? v.split(',') : [v];
    if (list.length > MANY_MAX) return { ok: false, reason: `参数「${k}」一次最多 ${MANY_MAX} 个` };
    const checked: string[] = [];
    for (const item of list) {
      const one = checkValue(arg.type, item.trim());
      if (one === null) return { ok: false, reason: `参数「${k}」的取值不合法：${item.slice(0, 40)}` };
      checked.push(one);
    }
    // 多值原样保留逗号（声明那边怎么写模板就怎么用），单值就是那一个
    out[k] = checked.join(',');
  }

  // 声明成必填的参数？schema 里没有 required 的概念 —— 缺参数的动作由模板自然露馅
  //（模板里 `{{x}}` 换成空串会得到一个空值，比这里多一套 required 校验更可预测）
  return { ok: true, values: out };
}

/**
 * 模板替换：`run.args` 里每个 `{{name}}` 换成 `values[name]`。
 *
 * 没给值的洞换成空串 —— 声明阶段已经保证模板里的名字都声明过（`parseAction`），
 * 这里再兜一次空串，是为了「参数是可选的」这种情况也能正常跑（例：`--unwish={{appid}}`
 * 在没传 appid 时变成 `--unwish=`，脚本自己判空）。
 */
export function buildActArgs(spec: DockActionSpec, values: Record<string, string>): string[] {
  const tpl = spec.run?.args;
  if (!tpl || !tpl.length) return [];
  return tpl.map((t) => t.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_m, name: string) => values[name] ?? ''));
}
