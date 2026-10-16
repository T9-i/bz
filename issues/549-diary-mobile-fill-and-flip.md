# 549 · 移动端日记本：顶部一条空白、翻页全废、写完回册首却不显示那一篇

用户原话（一句里报了三件事）：

> 日记本在移动端上关闭按钮距离顶部不是 44px，距离顶部的 44px 是空白，这不对应该也有日记本的背景，
> 翻页有 bug，异常卡顿，写新日记保存后不显示等等各种问题

用无头 Edge 复现（`scripts/preview-live.mjs` + `prototype-view.html?mob=1`，视口 412×915）后分了两拨：
**「翻页全废」「写完不显示」是同一条根因**（页宽两处各写一份，差 33px，见下），
**「异常卡顿」是另一条**（第三方库的无条件 rAF 循环每帧重写 200+ 个页元素的 `style`），
顶部那 44px 空白则是决策 9 那版留下的观感问题。

## 根因：移动端页宽两处各写一份，差了 33px

`dff12730`（决策 9 那版）把移动端 CSS 写成 `--bz-diary-pg-w: 100vw`（= 412），
而 `ui.ts::pageWidth()` 里单页档仍留着旧口径 `min(innerWidth * 0.92, 480)`（= 379.04）。
书宽与页宽就此分家，而 StPageFlip 的 HTML 渲染器是**按宿主宽度**折算 aspect 盒的
（`wrapper.style.paddingBottom = height / width * 100%`）：

```
宿主宽 412、页宽 379.04  →  padding-bottom 229.791% × 412 = 947   （应为 871）
```

实测（修前）：

| 量什么 | 值 |
|---|---|
| `.bz-diary-book` | `16,44 412×871` |
| `.bz-diary-flipbook`（宿主） | `0,44 412×**947**` |
| `.bz-diary-page-item`（纸面） | `16,**82** 379×871` ← 在 947 里垂直居中，整体下移 38px |
| 纸面下沿 | 82 + 871 = **953 > 915**，冲出屏幕 38px |

由此带出三个症状：

1. **纸面下移、页底冲出屏幕**（那 38px 里的正文永远看不见）。
2. **离屏测量盒（`.bz-diary-probe`，宽读 `--pg-w` = 412）比真页（379）宽 33px**
   → 正文按 **344px** 的栏宽量高、按 **311px** 渲染 → 每页都排得下更多字 →
   渲染时溢出、被 `overflow: hidden` 裁掉（页底截字）。
3. **滚轮 / 方向键 / 跳页三条翻页路全废**（用户报的「翻页有 bug」）：
   库的 `flipNext()` → `flip({x: rect.left + 2*pageWidth - 10, y: 1})`，而
   `disableFlipByClick: true` 会让 `flip()` 先过一道 `isPointOnCorners()`：

   ```js
   isPointOnCorners(t) {
     const n = this.render.convertToBook(t);        // 用 rect.top 折算
     return n.x > 0 && n.y > 0 && …;
   }
   ```

   `rect.top = blockHeight/2 - pageHeight/2 = 947/2 - 871/2 = **38**`，
   而 `flip()` 传的 `y = 1` → `n.y = 1 - 38 = -37` → **判据不过、直接 return**。
   实测：未修前按 ← → 与滚轮，当前页恒为 `0`；页宽对齐后立刻恢复（0 → 2 → Esc 回 0）。
   注：`turnToPage()`（跳页）不受这条判据管，所以「跳日子」看着像好的——
   但纸面整体下移 + 分页按错宽度，跳过去也不是该有的样子。

## 「异常卡顿」：库的 rAF 循环每帧重写 200+ 个页元素的 `style`（已修）

StPageFlip 的 `render.start()` 是无条件死循环（`requestAnimationFrame` 自己递归），
HTML 渲染器的 `clear()` 每帧都会给**所有非当前页**写一次 `style.cssText = "display:none"`
—— 同一个值、每帧重写。本册 213 页时实测（MutationObserver，1 秒窗）：

```
rAF frames/s = 171
style 变更 = 36720 次/秒
  └ bz-diary-page-item（隐藏页）36594 次
  └ bz-diary-page-item --right（当前页）342 次
```

≈ 每帧 213 次 `cssText` 写入（≈ 页数 × 帧率）。手机上按 60fps 折算仍是 ~12.8k 次/秒的样式属性写入，
一直烧着、一直失效 —— 这就是那股**持续**的底噪，与「读久了烫手 / 顿手」对得上。

**修法：`src/diary/flip-idle-guard.ts`（新增）。** 只省「写同一个值」：

- 逐页判：元素还不是隐藏态时才写一次 `display:none`，否则只读一下 `style.display`；
- 整段短路：当前页 / 翻动页 / 底页这组引用没变 ⇒ 没有页会「从可见变不可见」，整个循环跳过
  （翻页动画与拖拽期间这组引用一直在变，判据自然落空，逐帧照画）；
- 结构对不上（换库版本 / 测试替身）⇒ **原样不动**，只省冗余、不改行为、绝不让书打不开。

实测（同一台无头 Edge、同一本书）：

| | 修前 | 修后 |
|---|---|---|
| 静止时 style 变更 | **36 720 次/秒** | **342 次/秒**（只剩当前页的 `simpleDraw`，2/帧） |
| 隐藏页 | 36 594 次/秒 | **0** |

观感逐像素不变（省掉的永远是「写同一个值」）；翻页动画、拖拽折页、索引跳页、Esc 回最新
全部复测过：静止时只有 1 页 `display≠none`（跨页 2 页），动画中 3 页（跨页 4 页），落定后回到 1 / 2 页，
无幽灵页。`hideTemporaryCopy()` 语义照旧。

## 「一次性渲所有日记」确实是乘数，但它是**一次性的**，不是那股底噪

用户问得对：全量渲染就是上面那条的乘数（`每帧开销 ∝ 页数`）。实测这本 213 页的册子：

```
书里 DOM 节点 = 3343（213 页，平均每页 16 个）
一次全量成册（改稿宽触发重排）= 一个 57ms 长任务
```

所以它是**每次重排一个几百毫秒级的冻结**（手机按 3~5 倍折算，300ms 上下），
不是持续开销。守卫装上之后，`每帧开销 ∝ 页数` 这条已经不成立了 ——
剩下的 O(页数) 只有每帧 213 次廉价属性读，量级在微秒。

但**重排的次数**仍然值钱，而其中一半是白冻的：

```
移动端软键盘弹出 → 视口高变 → onResize → 整册重排
移动端软键盘收起 → 视口高变 → onResize → 整册重排
```

写一篇要白冻两次。两处改掉：

1. **判据换成书盒**（`onResize`）：分页的输入只有「书宽 / 书高 / 页内边距 / 单页模式」，
   前三个都由**书盒 + 媒体查询**决定，而页宽更是直接 = 书宽。原先按 `window.innerHeight`
   判（差 >40px 就重排）会白跑：书高是 CSS 的 `--pg-h`（移动端 `100vh`），窗口高变了它未必变。
   快照 `lastBookW/H` 落在 `relayout()` 里 —— 不放 `onResize`，
   否则「915 → 键盘 480（让路）→ 收纸补排 → 回 915」这一串会漏掉最后那次。
2. **写作内页摊着时不让路**（`onResize` + `resizePending`）：纸是盖在书页上的浮层，
   底下那本册子这几十毫秒里没人看。记一笔，`dropWrite()` 时走同一条防抖回刷补排，
   与「落笔」那次 `diary:entry-added` 合并成一次。

实测（412×915，真行为预览）：写作中把视口缩到 480 → 页数**纹丝不动**（213）；
揉掉纸 → 补排到 348 页；视口回 915 → 回到 213 页。

**没动的**：一次性全量渲染本身（ADR-0171 的拍板，窗口化渲染当时是回滚掉的方案），
以及「一次性成册」这个 57ms 长任务 —— 要治得先做惰性分页，属新决策。

## 「写完回最新那页，可刚写的内容不在」

`saveWrite()` 落盘后 `jumpToPage(0)`，随后靠 `diary:entry-added` 的**防抖回刷**（400ms）把新篇排进册子。
`relayout(keepRatio = true)` 按 `cursor / lastSpreadCount` 折算目标页——**`cursor` 是可以被别处写脏的**
（旧实例迟到的 `flip` 回调、重排前一刻收尾的翻页动画），一旦非 0，书就停在半路，
用户看到的就是「回了最新那页，可内容不在」。

改法：新增 `pendingHome`，`diary:entry-added` 触发的回刷与落笔本身都显式落第 0 页，
不再从游标推断意图（`relayout` 消费该旗后 `cursor` 归零）。

## 顶部 44px 那条空白

决策 9 让书从第 44px 起铺满，于是刘海那一条露出的是 `.bz-diary-desk` 的 token 遮罩
（`rgba(0,0,0,.35)` + backdrop-blur）压在宿主上的灰底——「空白」的观感来源。
用户拍板（2026-10-16）改成**整本铺满整屏**：`--pg-h: 100vh` + 书顶 `top: 50%`，
那 44px 就是书自己的纸面天头；关闭钮跟着挪到距顶 `max(44px, env(safe-area-inset-top, 0px))`，
正文顶距 56px 保证它落不进字区（正文右缘 361 < 钮左缘 368）。
书签条原来「从书顶翻出来」（`top:-20px`）会整条出屏，改挂关闭钮底下（`top:88px`）。

## 改动清单

| 文件 | 改了什么 |
|---|---|
| `src/diary/ui.ts` | `pageWidth()` 只读书宽做单页/跨页除法（CSS 是唯一源）；`pendingHome` + `scheduleRelayout(home)`，`diary:entry-added` 落册首；建书后装空转守卫；`onResize` 判据换成书盒 + 写作期间让路（`resizePending`，收纸补排） |
| `src/diary/flip-idle-guard.ts` | **新增**：StPageFlip 空转守卫（每帧重复写 `display:none` 只做一次） |
| `src/diary/vendor/page-flip.browser.d.ts` | 补 `getRender()` 声明（守卫要用它的 `clear()`） |
| `src/diary/styles.css` | 移动端 `--pg-w: min(92vw, 480px)`、`--pg-h: 100vh`、书顶 `top: 50%`、关闭钮 `top: max(44px, …)`、书签条 `top: 88px` |
| `tests/walkthrough-fix-c.test.ts` | 窄屏断言按新口径重写（含反向断言 `--bz-diary-pg-w: 100vw` 不回流） |
| `tests/diary/flip-idle-guard.test.ts` | **新增**：守卫 7 例（装不上原样不动 / 只省重复写 / 不漏藏 / 临时页照收 / 幂等） |
| `docs/adr/adr-0230-diary-book-ui.md` | 补决策 10、11 |
| `CONTEXT.md` | 「日记本」条目同步移动端口径与空转守卫 |
| `prototypes/diary/prototype-behavior.js` | 产物重出 |

## 验收（无头 Edge，412×915）

修前 → 修后：

| 量什么 | 修前 | 修后 |
|---|---|---|
| `book / flip / page` 顶 | `44 / 44 / **82**` | `0 / 0 / **0**` |
| `flip` 高（= 宿主 aspect 盒） | 947 | 871 = 页高 ✓ |
| 离屏测量盒宽 vs 真页宽 | 412 vs 379 ✗ | **379.031 vs 379.031** ✓ |
| 页底溢出 | 冲出屏底 38px | 末块底 729 < 内容底 839 ✓ |
| ← → / 滚轮 / 跳页 | 恒停在 0 | 0 → 2；索引跳第 213 页；Esc 回 0 |
| 从第 3 页落笔 | 停在半路（或不显示） | 回第 0 页且该篇在纸上 |
| `.bz-diary-close` | `368,6` | `368,44` |
| `elementFromPoint(206, 8)` | `.bz-diary-desk`（灰底） | `.bz-diary-page-inner`（纸面） |
| 静止时 style 变更 | **36 720 次/秒** | **342 次/秒** |
| 写作中软键盘改视口 | 每次白排一遍整册 | 让路（213 页纹丝不动），收纸补排一次 |
| 幽灵页 | — | 静止 1 页（跨页 2）、动画中 3 页（跨页 4），落定复原 |

门禁：`node scripts/test-affected.mjs` **599 files / 9236 tests 全绿**；`tsc --noEmit` 干净。
