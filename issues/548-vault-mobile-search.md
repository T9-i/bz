# 548 · 保险库移动端搜索框被撑成半屏：core 的 `flex:1` 落进了纵向容器

## 症状

移动端（≤768px）打开保险库（截图，issue 548）：搜索框下方一大片空白，「搜索全部资产…」的放大镜
孤零零飘在屏幕中段，输入框本身贴着顶部。看起来像"布局散了"，其实是**搜索框整框被拉高**——
它已经占了几百 px，放大镜是它的 `top: 50%`。

## 根因

`src/encrypt/ui.ts` 的移动壳骨架 `.bz-vault-mob` 是 `flex-direction: column`，四个直系孩子：

| 元素 | 纵轴 flex |
|---|---|
| `.bz-vault-mbar` | 默认（按内容） |
| `.bz-search.bz-vault-msearch` | **core 的 `flex: 1`** ⚠️ |
| `.bz-vault-mseg` | 默认（按内容） |
| `.bz-vault-mbody` | `flex: 1` |

`src/core/ui/components.css:982` 里 `.bz-search { position: relative; flex: 1; min-width: 0; }`，
这个 `flex: 1` 是给**横向**工具行（`.bz-toolrow`：搜索 + 排序 + spacer）写"水平撑满"用的。
`flex: 1` = `grow:1 / shrink:1 / basis:0%`，方向不是天然绑死的 —— 一旦落进纵向 flex 容器，
它变成"**沿纵轴**分剩余空间"，于是和 `.bz-vault-mbody` 各分一半：搜索框被撑到数百 px。

放大镜 `.bz-ic` 是 `position:absolute; top:50%`（相对 `.bz-search` 定位），跟着跑到被撑高后的
垂直中点；`input` 有固定 `height: 44px`，只能贴在被撑高框的顶部 —— 三个现象正好凑成截图那样。

域内注释（呈报#60/E4 收编那条）当时写的是「`.bz-search` 的 relative/flex:1 由 core 供」，
把 `flex:1` 当成了"框撑满宽度"的意图，漏了它在纵向容器里会换个方向生效。

## 修法

移动端断点块里显式覆盖：

```css
#bz-encrypt-popup .bz-search.bz-vault-msearch { flex: none; margin: …; min-height: 44px; }
```

`flex: none` = `0 0 auto`，纵向回落到按内容定高（`input` 44px + `min-height: 44px`），
剩余纵轴空间归 `.bz-vault-mbody` 独占。桌面侧不受影响（那条规则在 `@media (max-width: 768px)` 内，
桌面列表头的 `.bz-vault-lc-head` 本身就是 `display:flex` 横向行，`flex:1` 语义正确）。

## 同型排查

全仓 `.bz-search` / `uiSearch` 的落点过了一遍，只有移动壳这一处是"纵向 flex 直系孩子"：

| 落点 | 父容器 | 判定 |
|---|---|---|
| `encrypt` 移动壳 `.bz-vault-msearch` | `.bz-vault-mob`（**column**） | 实症 → 本 issue |
| `encrypt` 桌面列表头 | `.bz-vault-lc-head`（flex row） | 安全 |
| `memo` `.bz-memo-search` | `.bz-toolrow`（flex row） | 安全 |
| `clipbook` `.bz-clip-head-search` | `.bz-clip-head-strip`（flex row） | 安全 |
| `belongings` 海报版 | `.bz-toolrow`（flex row） | 安全 |
| `gameshelf` / `dock` / `diary` 的 `uiSearch` | 工具行 / 对话框行 | 安全 |

## 刻意没做

- **不改 core 的 `.bz-search { flex: 1 }`**：横向工具行是它的主场，改它得逐个域评估（上表五处都在
  横向行里）。域内一行覆盖，爆炸半径最小。
- **不加 `.bz-vault-mob > * { flex: none }` 之类兜底**：只这一次是实症；兜底规则会盖掉后来想用
  `flex:1` 的孩子（比如给 mbody 加个兄弟区），把真意图也一起压住。
- **不给放大镜加 `top` 兜底**：`.bz-ic` 的 `top:50%` 是 core 的正确写法，问题在高，不在定位。

## 守卫

`tests/encrypt/style-fix-d.test.ts`（读源 `styles.css` 文本的样式守卫）增一条：移动端断点块内
`.bz-search.bz-vault-msearch` 必须带 `flex: none`，防再被 core 的 `flex:1` 顶回去。
