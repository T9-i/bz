/**
 * 展示板动作（ADR-0247）：`#bz-act:` 解析、参数掐口、模板替换。
 *
 * 这一层的价值全在**边界**上：href 来自工具自己写的 `panel.html`（不可信输入），
 * 目标是把一次点击变成一条命令行。所以这里的用例绝大多数是「畸形 → 拒绝，且理由是人话」。
 */
import { describe, it, expect } from 'vitest';
import {
  ACT_HREF_PREFIX,
  buildActArgs,
  parseActHref,
  resolveActArgs,
} from '../../src/dock/action';
import { parseManifest } from '../../src/dock/schema';
import type { DockActionSpec } from '../../src/dock/schema';

describe('parseActHref', () => {
  it('认出最简形态（无参数）', () => {
    expect(parseActHref('#bz-act:wish:remove')).toEqual({ id: 'wish:remove', args: {} });
  });

  it('带参数时逐个收下（值已 decode）', () => {
    const r = parseActHref('#bz-act:wish:remove?appid=1332010&note=a%20b')!;
    expect(r.id).toBe('wish:remove');
    expect(r.args).toEqual({ appid: '1332010', note: 'a b' });
  });

  it('同名参数只认第一个（后面那些是手误或想覆盖）', () => {
    const r = parseActHref('#bz-act:x:y?appid=1&appid=2')!;
    expect(r.args.appid).toBe('1');
  });

  it('不是动作链接 → null', () => {
    for (const h of [
      '',
      'https://store.steampowered.com',
      '#别的锚点',
      'obsidian://open?vault=x',
      `${ACT_HREF_PREFIX}`, // 只有前缀
      `${ACT_HREF_PREFIX}?a=1`, // 没有 id
    ]) {
      expect(parseActHref(h), h).toBeNull();
    }
  });

  it('id 形态不合法 → null（斜杠、大写、超长都拒）', () => {
    for (const h of [
      '#bz-act:../etc',
      '#bz-act:Wish:Remove',
      '#bz-act:-lead',
      `#bz-act:${'a'.repeat(80)}`,
    ]) {
      expect(parseActHref(h), h).toBeNull();
    }
  });

  it('永不抛：整串垃圾也只返回 null', () => {
    expect(() => parseActHref('#bz-act:%zz%%')).not.toThrow();
    expect(parseActHref(null as unknown as string)).toBeNull();
  });
});

describe('resolveActArgs', () => {
  const spec: DockActionSpec = {
    args: { appid: { type: 'appid' }, note: { type: 'text' }, ids: { type: 'appid', many: true } },
    run: { args: ['--unwish={{appid}}'] },
  };

  it('合法值原样通过', () => {
    const r = resolveActArgs(spec, { appid: '1332010' });
    expect(r).toEqual({ ok: true, values: { appid: '1332010' } });
  });

  it('多值按逗号拆开、逐个校验后再拼回去', () => {
    const r = resolveActArgs(spec, { ids: '1,2,3' });
    expect(r).toEqual({ ok: true, values: { ids: '1,2,3' } });
  });

  it('多值里有一个不合法就整条拒', () => {
    const r = resolveActArgs(spec, { ids: '1,abc,3' });
    expect(r.ok).toBe(false);
  });

  it('声明之外的参数名 → 拒', () => {
    const r = resolveActArgs(spec, { appid: '1', '--evil': 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('--evil');
  });

  it('appid 不是数字 → 拒（这是唯一的注入面）', () => {
    for (const v of ['abc', '1;rm', '--unwish=1', '1 2', '']) {
      const r = resolveActArgs(spec, { appid: v });
      expect(r.ok, v).toBe(false);
    }
  });

  it('text 不许以 - 开头（shell:true 的声明里会被当成另一个开关）', () => {
    expect(resolveActArgs(spec, { note: '--force' }).ok).toBe(false);
    expect(resolveActArgs(spec, { note: '正常文本' }).ok).toBe(true);
  });

  it('text 不许带控制字符、不许超长', () => {
    expect(resolveActArgs(spec, { note: 'a\nb' }).ok).toBe(false);
    expect(resolveActArgs(spec, { note: 'a'.repeat(201) }).ok).toBe(false);
  });
});

describe('buildActArgs', () => {
  const spec: DockActionSpec = {
    args: { appid: { type: 'appid' } },
    run: { args: ['--unwish={{appid}}'] },
  };

  it('把洞换成值', () => {
    expect(buildActArgs(spec, { appid: '1332010' })).toEqual(['--unwish=1332010']);
  });

  it('没给值 → 空串（声明里可选的参数靠脚本自己判空）', () => {
    expect(buildActArgs(spec, {})).toEqual(['--unwish=']);
  });

  it('没有 run 段 → 空数组', () => {
    expect(buildActArgs({}, {})).toEqual([]);
  });
});

describe('parseManifest 的 actions 段', () => {
  const base = { v: 1, id: 'steam-cheap-radar', name: '白菜价雷达', params: [] };

  it('合法动作进表', () => {
    const m = parseManifest({
      ...base,
      actions: {
        'wish:remove': {
          args: { appid: { type: 'appid' } },
          run: { args: ['--unwish={{appid}}'] },
        },
      },
    })!;
    expect(Object.keys(m.actions!)).toEqual(['wish:remove']);
    expect(m.actions!['wish:remove'].run!.args).toEqual(['--unwish={{appid}}']);
  });

  it('模板引用了没声明的参数 → 这条动作整条丢（别等运行时才炸）', () => {
    const m = parseManifest({
      ...base,
      actions: { bad: { run: { args: ['--x={{nope}}'] } } },
    })!;
    expect(m.actions).toBeUndefined();
  });

  it('没有 run 的动作丢掉（否则点了只能跑一整轮）', () => {
    const m = parseManifest({
      ...base,
      actions: {
        onlyArgs: { args: { appid: { type: 'appid' } } },
        empty: {},
      },
    })!;
    expect(m.actions).toBeUndefined();
  });

  it('id 形态非法 / 参数类型不认识 → 逐条丢，不连累其余', () => {
    const m = parseManifest({
      ...base,
      actions: {
        '': { run: { args: ['--x'] } },
        'BAD ID': { run: { args: ['--x'] } },
        badType: { args: { a: { type: 'shell' } }, run: { args: ['--x'] } },
        good: { run: { args: ['--x'] } },
      },
    })!;
    expect(Object.keys(m.actions!)).toEqual(['good']);
  });

  it('actions 不是对象 / 是空表 → 视同没声明', () => {
    expect(parseManifest({ ...base, actions: 'x' })!.actions).toBeUndefined();
    expect(parseManifest({ ...base, actions: {} })!.actions).toBeUndefined();
    expect(parseManifest({ ...base, actions: [] })!.actions).toBeUndefined();
  });

  // 业务字段不进契约：确认界面归展示板，兜底归脚本（用户 2026-10-20 拍板）。
  // 「保留」是前向兼容（未知字段原样带过去），「消费」才是契约 —— 这里只断言后者。
  it('label / confirm 这类业务字段原样保留，但不参与解析', () => {
    const m = parseManifest({
      ...base,
      actions: { 'wish:remove': { label: '移除', confirm: '真的？', run: { args: ['--x'] } } },
    })!;
    expect(m.actions!['wish:remove'].run!.args).toEqual(['--x']);
    // 留着（低版本 bz 不该丢掉高版本声明里的信息），但没有一段代码会去读它
    expect((m.actions!['wish:remove'] as unknown as Record<string, unknown>).confirm).toBe('真的？');
  });
});
