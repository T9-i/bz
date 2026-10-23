/**
 * 网闸的单元测试 —— 只测 `net.js` 自己的事实：参数归一、探测目标解析、等待循环的收尾。
 *
 * 这里**不连网**：等待循环注入假探测，`probeTarget` 只喂非法目标（它必须恒 resolve，
 * 断网是常态，不是异常）。真探测由系统测试环境决定，不该成为测试的隐含依赖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeNet from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const net = require('../net.js');

test('参数归一：缺省值齐备，坏值一律回落（不猜、不抛）', () => {
  const o = net.optionsOf(undefined);
  assert.equal(o.waitMs, 5 * 60 * 1000);
  assert.deepEqual(o.hosts, net.DEFAULT_HOSTS);

  const bad = net.optionsOf({ net: { waitMs: -1, probeEveryMs: 'x', hosts: [] } });
  assert.equal(bad.waitMs, 5 * 60 * 1000, '负数不是「不等」—— 那是 0 的意思');
  assert.ok(bad.probeEveryMs >= 200);
  assert.deepEqual(bad.hosts, net.DEFAULT_HOSTS, '空数组等于没配');

  const custom = net.optionsOf({ net: { waitMs: 0, hosts: ['127.0.0.1:9', ' '] } });
  assert.equal(custom.waitMs, 0, '0 是合法值：只探一次就走');
  assert.deepEqual(custom.hosts, ['127.0.0.1:9']);
});

test('探测目标写坏了也只回 false，不抛（目标是用户可配的）', async () => {
  assert.equal(await net.probeTarget('没有端口也不是主机', 20), false);
  assert.equal(await net.probeTarget('127.0.0.1:0', 20), false);
  assert.equal(await net.probeTarget('127.0.0.1:99999', 20), false);
});

test('真实连接：本地开一个监听就算通，不拖到超时（有网是常态，必须快）', async () => {
  const srv = nodeNet.createServer((s) => s.destroy());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const res = await net.waitForNet({
      net: { hosts: [`127.0.0.1:${port}`], waitMs: 2000, probeEveryMs: 200, connectTimeoutMs: 500 },
    });
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 1);
    assert.ok(res.waitedMs < 400, `握手成功不该等满超时，实际 ${res.waitedMs}ms`);
  } finally {
    srv.close();
  }
});

test('真实连接：端口没人听就判不通（ECONNREFUSED 不该被当成通）', async () => {
  const srv = nodeNet.createServer((s) => s.destroy());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r)); // 关掉，端口空着
  const res = await net.waitForNet({
    net: { hosts: [`127.0.0.1:${port}`], waitMs: 200, probeEveryMs: 200, connectTimeoutMs: 300 },
  });
  assert.equal(res.ok, false);
});

test('等到上限仍不通：ok=false，且确实等满了（不是立刻放弃）', async () => {
  let calls = 0;
  const res = await net.waitForNet(
    { net: { waitMs: 120, probeEveryMs: 200, connectTimeoutMs: 10 } },
    {
      probe: async () => {
        calls += 1;
        return false;
      },
    },
  );
  assert.equal(res.ok, false);
  assert.ok(res.waitedMs >= 100, `该等满再收场，实际只等了 ${res.waitedMs}ms`);
  assert.ok(calls > 1, '期间该反复重试');
});

test('中途接通就立刻收场，不多等一轮', async () => {
  let calls = 0;
  const res = await net.waitForNet(
    { net: { waitMs: 5000, probeEveryMs: 200, connectTimeoutMs: 10 } },
    {
      probe: async () => {
        calls += 1;
        return calls === 2;
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.ok(res.waitedMs < 1000, '通了就别再等');
});

test('onWait 只在「确认没网」时叫一次（日志不能刷屏）', async () => {
  let waits = 0;
  let calls = 0;
  await net.waitForNet(
    { net: { waitMs: 500, probeEveryMs: 200, connectTimeoutMs: 10 } },
    {
      probe: async () => {
        calls += 1;
        return false;
      },
      onWait: () => {
        waits += 1;
      },
    },
  );
  assert.ok(calls > 2, '确实轮询过');
  assert.equal(waits, 1, '每 3 秒刷一行「正在等」会把日志写成噪音');
});

test('探测自己抛异常：当没通（一次探测崩了不该带走整拍）', async () => {
  const res = await net.waitForNet(
    { net: { waitMs: 60, probeEveryMs: 200, connectTimeoutMs: 10 } },
    {
      probe: async () => {
        throw new Error('探测炸了');
      },
    },
  );
  assert.equal(res.ok, false);
});
