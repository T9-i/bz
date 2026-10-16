# 551 · 日记本正文段首不缩进、超长段落不再硬切、灯箱零文字

> 用户 2026-10-16 第四轮。前情见 `issues/549`（书页铺满 + 翻页真因 + 库空转守卫）与
> `issues/550`（窄屏一天一卷）。ADR 落点：`docs/adr/adr-0230-diary-book-ui.md` 决策 13。

## 用户原话

1. 「为什么正文会莫名其妙会换行呢？我看笔记中是一段的」
2. 「段落不增加首缩进」
3. 「然后点击图片视频，打开大屏时去掉底部的名称显示，不显示任何文字」

## 「莫名换行」的真因：`splitTextBlocks` 按字数硬切段落

不是分页、不是 CSS 折行，是**渲染期就把一段切成了好几块**。

`splitTextBlocks` 的 `pushPara` 有一条旧规则：段落超过 240 字就按句读（`。!?;~」”…`）
切成 ~200 字的续块，每块各 `emit` 成一个 `para` 块。而 `para` 块落成的是**块级** `div.bz-diary-b-para`
—— 块级元素各起一行，于是原文的**一段**在册子里成了好几「段」。

用真函数 + 真数据量（本机 `E:\Obsidian\叫我包仔\我的\日记`，1244 篇 / 2837 段）：

```
超 240 字的段落 = 43 段
2511012023.md   1256 字 → 6 块（5 处多出来的换行）
2605050139.md   1188 字 → 6 块
2609181106.md    873 字 → 5 块
```

旧版给「首块」挂 `bz-diary-p-indent`（`text-indent: 2em`）、「续块」挂 `bz-diary-p-cont`（不缩进），
所以真机看到的是：正文中间凭空起一行、还顶着 2em 缩进 —— 就是「莫名其妙会换行 + 有缩进」。

### 修法

一段就是一块。折行交给排版自己：

- 窄屏（一天一卷）：纸面自然折行，没有任何人工段界；
- 跨页档：一页装不下时走 `splitParagraph`（Range 二分，按页尾**实际高度**切），
  本来就是为长段落准备的（`paginateFlow` 规则 2/3b），不必再预先切。

`Block` 的 `para` 去掉 `cont` 字段、`pushPara` 去掉 240/200 两条阈值 —— 代码也随之短了一截。

## 段首不缩进

`.bz-diary-b-para` 去掉 `text-indent: 2em`；`.bz-diary-p-indent` / `.bz-diary-p-cont`
**整对**退役（它们存在的唯一理由就是表达首行缩进，`splitParagraph` 里那次「续块换类」一并删除）。

段距仍是 0：段与段的距离只由原文的空行块（`.bz-diary-b-blank`，26 / 52 / 78px 三档）给出 ——
原文一段就排一段，段与段之间该有多少空，是**原文**说了算。

## 灯箱零文字

底部两件文字连同 CSS 一并退役：

| 撤掉的 | 原来是 |
|---|---|
| `.bz-diary-lb-cap` | `2026-10-14 18:21 · IMG_20261014_181738….jpg` |
| `.bz-diary-lb-count` | `1 / 3` |

`.bz-diary-lb-photo`（白卡）的内边距收成四边等宽 `16px` —— 原来的下边 12px 是给题注让的位。
留着的只有左右两枚翻页箭头（`◂ ▸`，看多张时要走）。图片与视频同一套，不分开处理。

## 改动清单

| 文件 | 改了什么 |
|---|---|
| `src/diary/render.ts` | `pushPara` 去掉 240 字硬切；`Block` 的 `para` 去掉 `cont`；`paraHTML` 只出 `.bz-diary-b-para`；灯箱模板删 `figcaption` 与计数 div |
| `src/diary/ui.ts` | `splitParagraph` 删「续块换类」；删 `lbCapEl` / `lbCountEl` 两个字段与两处赋值；`sheetParas` 不再挂 `bz-diary-p-indent` |
| `src/diary/styles.css` | 删两条缩进规则与两条灯箱文字规则；`.bz-diary-lb-photo` 内边距改 `16px` |
| `tests/diary/ui-book.test.ts` | 灯箱用例改锁「一个字都不出」（白卡零字 + 整层除两枚箭头外零字 + 两个类名下元素为空） |

## 验收

- `node scripts/test-domain.mjs diary` 385 用例全绿；`tsc --noEmit` 干净。
- 真数据复核：`splitTextBlocks` 对 `2511012023.md`（1256 字）现在只出 **1 块**（原 6 块）。
