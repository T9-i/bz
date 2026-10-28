# ADR-0269：下载与自更新改走独立分发仓库

- 状态：已采纳
- 日期：2026-10-28
- 相关：ADR-0199（皮肤分发的注入例外）、ADR-0203（在线资源与下载清单）、ADR-0263（外部工具分发与指针）、ADR-0268（本轮报障的另一半）

## 背景

2026-10-28 用户报「插件里所有下载都是红的、连不上」。查下来网络本身没问题，问题在**载体**：

| 通道 | 实测（本机，裸网 = 不走代理） | 结论 |
|---|---|---|
| `raw.githubusercontent.com/yeshimei/bz/...` | `http=000`，8s 超时 | 国内无代理不通 |
| `fastly/gcore/testingcf.jsdelivr.net/gh/yeshimei/bz@master/...` | `403`，正文 `Package size exceeded the configured limit of 50 MB` | 主仓 `.git` 284 MB，超 jsDelivr 上限，**未缓存文件一律拒发** |
| 同上，但目标是 `version.json` 这类早年被缓存过的文件 | `200` | 只有缓存命中的才出得来 —— 这就是「探测说通道可达、拉开清单却失败」的来源 |

两条通道同时死掉 = 下载功能等于不存在。而这两个约束都不是能绕的：raw 的被墙是网络层事实，
jsDelivr 的 50 MB 是服务条款。唯一能改的是**东西放在哪儿**。

## 决策

### 1. 客户端要下载的一切搬进独立小仓库 `yeshimei/bz-assets`

`src/core/remote-base.ts` 里新增 `ASSETS_SLUG`，`REPO_BASES` 全部指向它；`REPO_SLUG`
（源码/issue/反馈）保持不变。搬过去的是：

```
downloads/**        在线资源逐字镜像（手册、更新日志、皮肤、目录包、下载清单、发布指针）
releases/<tag>/*    插件本体三件套（manifest.json / main.js / styles.css）
```

主仓仍是**产物唯一的产出地**，分发仓库只是镜像 —— 删掉重建没有任何副作用。

实测搬完之后（同一个裸网）：`fastly` / `gcore` / `testingcf` 对 `downloads/manifest.json`
全部 `200`（约 1.0–1.3s），`releases/<tag>/main.js` 也是 `200`，内容与主仓逐字节一致。

### 2. 三件套也搬，但用目录 `releases/<tag>/`，不用 git tag

只搬 `downloads/` 会留下「能检查到新版、装不上」的半截状态（自更新拉的正是主仓 tag 上的
三件套，同样被 403）。搬法上刻意不用 git tag：

- tag 是**不可变**的，发一次留一份 4 MB，十几版之后仓库又回到 50 MB 上限；
- 目录名可以由发布脚本按「版本号」生成、**旧的随时删**，客户端指针只会指向最新那份。

所以 `releases/<tag>/` 只保留最近 3 份（`RELEASES_KEEP`）：jsDelivr 看的是当前快照体积，
历史对这个仓库没有价值。目录名与 `downloads/version.json` 里的 `tag` 同源（都从
`manifest.json` 的 version 推），不会错位。

### 3. 发布多一步 `node scripts/push-assets.mjs`

发布顺序变为 `tools-pack → skin-pack → changelog → catalog → manifest → build → assets`。
脚本三件事：镜像文件、修剪旧发布、`.git` 超 25 MB 自动压平历史（jsDelivr 只服务当前快照，
历史留着早晚重新撞上限，而那个失败是「下载全挂」而不是慢慢变差）。

slug 只在 `src/core/remote-base.ts` 写一次，脚本从那里读 —— 两处各写一份字面量的结果
一定是某天只改了一处，客户端去拉一个不存在的仓库。`tests/core/remote-base-assets.test.ts`
钉住这一点，同时钉住「没有一条基址指回主仓」。

### 4. 通道顺序：raw 主，jsDelivr 三个能通的在前、`cdn` 垫底

jsDelivr 的 `cdn.jsdelivr.net` 在国内实测 `000`（0.25s 就连不上），一直是死入口。既然分发
仓库小到 jsDelivr 肯发，就把能通的那三个提到前面，`cdn` 退成长尾。raw 仍排第一：它无缓存，
是发布指针「取到最新」的唯一保证，而 jsDelivr 对 `@master` 有分钟到小时级缓存。代价是
裸网下第一次请求会白等 raw 超时，之后 `remote-asset` 的通道记忆（`preferredBase`）会把
成功过的那条排到队首。

## 代价与已知项

- **发布多一个仓库、多一步**。忘了跑 `assets`，客户端看到的就是上一版内容（主仓产物新了，
  分发仓库没动）。已在 `AGENTS.md` 的发布清单里列为必跑项。
- **jsDelivr 的 `@master` 缓存**会让发布后的头几十分钟（最长约 12 小时）有客户端读到旧文件。
  清单里每个文件都带 sha256，读到旧清单 + 新文件会校验失败并换通道重试，不会静默写坏。
- **新仓库第一次被 jsDelivr 索引**有明显延迟（本次实测约 1 分钟）。
- 没做的：`downloads/` 仍是主仓的一部分（产物要继续进版本库、`--check` 守卫要读它们）。
  真要瘦主仓得重写历史，tag 全废 —— 与本决策无关，另议。

## 验证

```
# 裸网（不走系统代理 = 国内默认网络）
fastly/gcore/testingcf  gh/yeshimei/bz-assets@master/downloads/manifest.json   → 200
fastly                  gh/yeshimei/bz-assets@master/downloads/version.json    → 200
fastly                  gh/yeshimei/bz-assets@master/releases/v1.33.0/main.js → 200
fastly                  gh/yeshimei/bz-assets@master/downloads/tools/*.tar.gz  → 200
# 走系统代理
raw.githubusercontent.com/yeshimei/bz-assets/master/downloads/manifest.json    → 200
```

`tests/core/remote-base-assets.test.ts` 新增 8 条（两个 slug 不同、每条基址指分发仓库、
raw/jsDelivr 形状、`downloads/` 与 `releases/<tag>/` 的 URL 形状、非法 tag 返空、
发布脚本不许自带 slug 字面量）。

## 补记（2026-10-28 当晚）：jsDelivr 不服务 HTML

搬完仓库后逐条验通，发现有一类文件仍然拉不到：

```
fastly.jsdelivr.net/gh/yeshimei/bz-assets@master/downloads/bz-manual.html   → 301
   Location: https://raw.githubusercontent.com/yeshimei/bz-assets/master/downloads/bz-manual.html
```

jsDelivr 对 `.html` 一律 301 回 raw（反钓鱼策略：不肯以自家域名直接吐 HTML）。于是手册与
更新日志走成一个死循环：jsDelivr 301 → raw 在国内裸网超时。而 `.css` / `.json` / `.tar.gz`
全部 200 —— 唯独那两页永远下不来，且**在带代理的开发机上表现完全正常**（301 之后 raw 通），
又是一条只有裸网用户才会撞上的坑。

修法：`downloadRemotesFor` 给 `.html` 追加**最后一跳**公开反代 `gh-proxy.com`
（`HTML_PROXY_BASE`）。实测裸网只有它可用：

| 反代 | 实测 |
|---|---|
| `gh-proxy.com` | **200**，手册 154 KB，4.1 s，内容 sha256 与清单一致 |
| `cdn.statically.io` | 超时（15 s） |
| `ghfast.top` | 超时 |
| `ghproxy.net` | 502 |
| `raw.gitmirror.com` | 拒连 |

只挂在 html 上，其余资产不碰第三方：反代是别人家的服务，能少用就少用。内容有清单里
的 sha256 兜底（走反代取回的字节与被篡改的字节算得出不同 hash，`ensureAssetWithHash` 直接
拒收），被投毒也进不来。

代价：`.html` 的最后一跳依赖一个公开反代，它哪天挂了手册就得靠代理。真要根治得改分发
格式（例如发布成 `.txt` 再在本地改名），那要动清单字段与本地路径口径，本轮没做。
