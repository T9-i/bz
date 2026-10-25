# 558 · 日记本一页装不下时正文被裁在纸边，滚轮还翻不动

- 状态：已交付（2026-10-26，worktree `bz-wt-book-page`）
- 提出：2026-10-26 用户反馈「内容溢出，鼠标放在右侧滚动无法往后翻页」（附截图：右页正文一直写到纸边，
  下面那句被裁掉；书是跨页档，页号在左页底）

## 是两个缺陷叠在一起

### ① 分页漏切：比一整页还高的块，换页之后没人再切它

`paginateFlow` 的规则 3b（`src/diary/ui.ts`）：页尾装不下 → 页尾够高（≥ 84px）就逐行切一刀，
不够高就 `newPage()`。**换页之后就走了**——而「空页上遇到超长块先按整页切一刀」是规则 2，
它在进入这个块时已经跑过一次，那时 `cur` 还有内容，条件不成立。

于是「一整段比一页还高、且页尾又够不着切点」这一种，整段被原样压在新页上，`used` 直接超
`availH`。页内是 `overflow: hidden`（跨页档，`src/diary/styles.css`），超出的部分**被裁掉、也不在下一页**——
就是截图里那段看不见的正文。

### ② 滚轮死角：滚不动的页照样把滚轮扣下

同文件 `bindChrome` 的滚轮门控：先把滚轮让给 `.bz-diary-page-inner`，滚到顶/底才换页——
判据是 `scrollHeight > clientHeight` 且 `scrollTop` 没到底。跨页档的页内是 `overflow: hidden`，
`scrollTop` 永远是 0，于是「内容溢出」的页恒判「没到底」→ `return` → 滚轮被吞，页也翻不了。

窄屏（一天一卷，`overflow-y: auto`）是这条判据的正当场景，跨页档不是。

## 修法

| 位置 | 改了什么 |
|---|---|
| `paginateFlow` | 把规则 2 的本体抽成 `fitOnEmptyPage(it, at)`；3b 的 `newPage()` 之后补调一次——换到空页就按整页高度再切一刀，下半照常流进下一页 |
| `bindChrome` | 新增 `innerScrollable(el)`：读 `getComputedStyle(el).overflowY`，只有 `auto` / `scroll` 才算「这一页真能滚」。滚轮与触屏两条门控都加上它，跨页档恒不成立 → 滚轮一律归翻页 |
| `tests/diary/ui-book.test.ts` | 两条：`paginateFlow` 换页后补切（钉住「切点只问一次 96」且下半真进了流）；跨页档页内 `overflow:hidden` + 内容溢出时滚轮照样翻页；另加窄屏「卷能滚时滚轮先归卷」 |

`paginateFlow` 是纯函数，两条分页断言走桩（`split` / `heightOf` 由测试给），jsdom 无排版也能钉死；
滚轮那条用 `Object.defineProperty` 手造 `scrollHeight` / `clientHeight`。两条都做过变异验证：
去掉修法即红。

## 验收

- `node scripts/test-domain.mjs diary` → 22 文件 / 412 用例全绿；`tsc --noEmit` 干净。
- 变异验证：删掉 `fitOnEmptyPage(it, i)` 那行 → 分页用例红（切点断言拿到 `[]`）；删掉
  `innerScrollable` 判据 → 滚轮用例红（页没翻）。

## 还留着的边角

切不出来时（段尾只剩不到 6 个字，`splitParagraph` 的 `cut > text.length - 6` 直接拒切）
仍会留下**约一行**的溢出。这是「宁可裁一行也不留 5 字孤行」的取舍，不是这次要动的东西；
真要清零得改 `splitParagraph` 的收尾策略，另起一次。
