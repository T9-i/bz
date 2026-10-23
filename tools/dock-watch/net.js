/**
 * 触网前的网闸 —— 值守专有（ADR-0242 补记）。
 *
 * 要解决的那次现场（2026-10-23 04:27，iamtxt 签到）：登录后计划任务两秒内就拉起值守，
 * 而这时 Wi-Fi / 拨号往往还没就绪。规则当场命中 → 拉起工具 → `fetch failed`；更糟的是
 * **规则已经记账了**，于是这一天不会再自动重试一次。用户看到的是「签到失败了」，
 * 实际发生的是「它跑得太早」。
 *
 * 所以判据前移一格：**命中 run 规则后、记账之前**先等网络接通。等到就照常跑；
 * 等不到就**不记账**（`lastFiredAt` 不动），把这次留给下一拍 —— 「到点没网」不等于
 * 「今天跑过了」。这一点是整套东西的关键：只加等待、照旧记账，等于把失败换成静默跳过。
 *
 * 为什么探测公网 443、而不是「工具要访问的那个站」：值守服务所有工具，不该知道谁的接口
 * 在哪里；链路通不通是**系统级事实**。TCP 三次握手成功即算通 —— 不解析 HTTP、不校验证书，
 * 便宜、不挑工具，也不会因为某个站当天挂了就把所有工具晾着。
 *
 * 探测目标用 **IP 直连**（不走 DNS）：DNS 本身可能还没就绪，而「DNS 通了」也不等于链路通；
 * 多个目标任一通即算通，避免单个地址被墙/被劫持时误判成断网。
 */
'use strict';

const net = require('net');

/**
 * 缺省探测目标 —— 三个公共 DNS 的 443（DoH 端口，常年开放）。
 * 直连 IP，不经解析；任一可连即认为链路通。
 */
const DEFAULT_HOSTS = ['223.5.5.5:443', '119.29.29.29:443', '1.1.1.1:443'];

/** 缺省参数：最多等 5 分钟（开机到联网的典型窗口），每 3 秒探一次，单次连接 3 秒超时 */
const DEFAULTS = {
  waitMs: 5 * 60 * 1000,
  probeEveryMs: 3000,
  connectTimeoutMs: 3000,
  hosts: DEFAULT_HOSTS,
};

/** 配置归一：`config.net`（来自 `config.json` 的可选块）逐项覆盖缺省，坏值一律回落 */
function optionsOf(config) {
  const raw = config && typeof config.net === 'object' && config.net ? config.net : {};
  const num = (v, fallback, min) => (Number.isFinite(v) && v >= min ? v : fallback);
  const hosts = Array.isArray(raw.hosts)
    ? raw.hosts.map((h) => String(h || '').trim()).filter(Boolean)
    : [];
  return {
    waitMs: num(raw.waitMs, DEFAULTS.waitMs, 0),
    probeEveryMs: num(raw.probeEveryMs, DEFAULTS.probeEveryMs, 200),
    connectTimeoutMs: num(raw.connectTimeoutMs, DEFAULTS.connectTimeoutMs, 200),
    hosts: hosts.length ? hosts : DEFAULT_HOSTS,
  };
}

/**
 * 探一个 `host:port`：TCP 连上就算通。**恒 resolve**（断网是常态，不是异常）。
 * `socket.setTimeout` 管住「连接挂死」那种更烦的失败 —— 它既不成功也不报错。
 */
function probeTarget(target, timeoutMs) {
  const at = target.lastIndexOf(':');
  const host = at > 0 ? target.slice(0, at) : target;
  const port = at > 0 ? Number(target.slice(at + 1)) : 443;
  const usable = host && Number.isInteger(port) && port > 0 && port < 65536;

  return new Promise((resolve) => {
    if (!usable) {
      resolve(false);
      return;
    }
    let done = false;
    let sock;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* 已经断了 */
      }
      resolve(ok);
    };
    try {
      sock = net.connect({ host, port });
    } catch {
      resolve(false);
      return;
    }
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

/**
 * 并行探全部目标，**任一先通就立刻收场**。
 *
 * 不能写成 `Promise.all` + `some`：那要等最慢的那个落定 —— 某个公共 DNS 在本地被墙时，
 * 有网也要白等 3 秒才判「通」。有网是常态，常态必须零成本。
 */
function probeAny(o) {
  return new Promise((resolve) => {
    let left = o.hosts.length;
    let done = false;
    const settle = (ok) => {
      if (done) return;
      if (ok) {
        done = true;
        resolve(true);
        return;
      }
      left -= 1;
      if (left === 0) {
        done = true;
        resolve(false);
      }
    };
    for (const target of o.hosts) {
      probeTarget(target, o.connectTimeoutMs).then(settle, () => settle(false));
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等网络接通。**恒 resolve**，事实全在返回值里：
 *
 *  - `ok: true` —— 通了。`waitedMs` 是等了多久（`0` 附近 = 一开始就通，调用方别报「等网」）；
 *  - `ok: false` —— 到上限仍不通。调用方**必须**据此不跑、不记账（见文件头）。
 *
 * `deps.probe` 是测试缝（注入假探测，别真去连网）；`deps.onWait` 在**确认没网**的那一刻
 * 调一次 —— 只调一次的用意：日志要能看见「它正在等」，又不能在每 3 秒的轮询里刷屏。
 */
async function waitForNet(config, deps = {}) {
  const o = optionsOf(config);
  const probe = typeof deps.probe === 'function' ? deps.probe : probeAny;
  const started = Date.now();
  const deadline = started + o.waitMs;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    let ok = false;
    try {
      ok = (await probe(o)) === true;
    } catch {
      ok = false; // 探测自己抛了，也只能当没通
    }
    if (ok) return { ok: true, waitedMs: Date.now() - started, attempts };

    if (attempts === 1 && typeof deps.onWait === 'function') deps.onWait(o);
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, waitedMs: Date.now() - started, attempts };
    await sleep(Math.min(o.probeEveryMs, left));
  }
}

module.exports = { DEFAULT_HOSTS, DEFAULTS, optionsOf, probeTarget, probeAny, waitForNet };
