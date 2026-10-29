# bz —— 干活约定

Obsidian 插件。域 = `src/<域>/`，`core` 是共享层。中文输出。

## 跑什么
改一个域：`node scripts/test-domain.mjs <域>`（~10s）。跨域、说不清、或要下「通过」结论：`node scripts/test-affected.mjs`（~12s）——只跑受影响的测试 + 扫树守卫，**它的结论就是结论**；没变过的文件复用上次成功结果，通常几秒。

改到 core、依赖清单、测试配置、全局夹具时，选择器自己升格为全量，不用你判断。合回主干前跑 `node scripts/test-affected.mjs --since master`（覆盖整条分支）。手动强制全量才用 `--full`。

别用 `vitest --changed` / `related`：一批守卫靠读源码文本断言，模块图里没有这条边，改样式会「命中 0 个、退出码 0」——假绿，不是慢。

测试一律 `node` 直调，别走 `pnpm run`（package.json 同名脚本已同口径）：pnpm 11 跑脚本前的依赖自检默认会自动 `pnpm install`，本仓必判「过期」——主仓里 `tools/*` 子包被算成工作区项目，worktree 里还经 junction 读到主仓的状态文件。

## 硬约束（看见就是错）
- 样式源只有 `src/<域>/styles.css`（根 `styles.css` 是聚合产物）。域内禁 `scrollbar-width: thin/auto`、禁自绘 thumb、禁运行时注入 `<style>`、禁内联视觉样式。例外只有两处，都要先有 ADR：① 远端皮肤包，只在 `src/core/skin-pack.ts` 单一注入点（ADR-0199）；② 展示板**沙箱框文档内部**的滚动条样式，只在 `src/dock/ui.ts` 的 `FRAME_SCROLLBAR_CSS`（ADR-0243 补记，作用域仅 iframe 文档、守卫掐死范围）。
- 域 UI 的唯一真理源是与评审壳共用的实现源码；两侧不一致 = 缺陷，改源码，别改壳、别改产物。未定稿的探索稿只写 `.scratch/<名>/`。
- 不手改生成物：根 `main.js` / `styles.css`、`changelog-data.ts`、`prototypes/**/prototype-*.js`、`downloads/manifest.json`、`downloads/skins/`、`tools/dock-watch/dock-core.cjs`（+ 同目录 `core-version.json`）。
- 命令 ID `bz-<域>-<动作>`；通知正文不带 emoji（新语义查 `src/core/notice.ts` 的 ICONS）。
- 改动走 worktree（仓库外，从最新 master 分叉）；**worktree 内不构建**——产物直出本机 vault（`esbuild.config.mjs` 硬编码）与仓库根。

## 「走快速原型」= 不许验证
不测试、不截图、不比对：禁 vitest 任何跑法（含「只跑当前域」）、禁 CDP / 无头探针、禁壳 `?selftest=1`、禁读计算样式自证。

改完源码 → 起或复用预览服务 → 把网址交给他，让他判。门禁等他喊「同步」一次补齐（改到类型边界可顺手 `tsc --noEmit`，但那不算验证、不许拿它拖交付）。

## 坑
- Git Bash 里 pnpm 起不来（shim 把路径解析成 `D:\d\...`）→ 用 PowerShell，或 `node node_modules/<包>/…` 直调。
- `git worktree remove` 后常残留 `node_modules`，要另删。**删前必须先 `cmd /c rmdir` 掉 worktree 里的 `node_modules` junction**——worktree 的 junction 指向主仓 node_modules 时，remove/remove --force 会穿透删除主仓 `.pnpm` 里的包（表层包还在、深处依赖悬空，测试报 Cannot find module）；穿透后 `pnpm install` 修不回（workspace 状态文件误判 up to date），要 `rm -rf node_modules && pnpm install` 整体重建（store 硬链接，很快）。
- 发布顺序固定：`tools-pack → skin-pack → changelog → catalog → manifest → build → assets`（前四个出产物、`manifest` 对产物现算 hash、`build` 出插件本体、`assets` 把产物镜像到分发仓库；`pnpm assets` 与 `node scripts/push-assets.mjs` 是同一件事，Git Bash 里用后者）。**少跑 `manifest` = 清单永远停在上一版**（`changelog` 重出了出版页、sha256 却没跟着算），而且只有跑门禁时 `skin-pack-split-guard` 才会说话。**少跑 `tools-pack` 同理**（旧 tar.gz 还在，用户端显示「已是最新」但内容没更新）。**少跑 `assets` = 客户端拿到的还是上一版**（下载通道只认分发仓库，见下条）。
- **下载走独立分发仓库 `yeshimei/bz-assets`**（ADR-0269）：主仓 `.git` 284 MB 超过 jsDelivr 的 50 MB 上限，它对主仓未缓存文件一律 403；国内无代理时 raw 又不通。`node scripts/push-assets.mjs` 把 `downloads/**` 与 `releases/<tag>/`（三件套）镜像过去，只保留最近 3 份发布，`.git` 超 25 MB 自动压平历史。**主仓仍是唯一产出地**，分发仓库随时可删可重建。改了 base 地址只改 `src/core/remote-base.ts`（脚本从那里读 slug，别在两处各写一份）——`tests/core/remote-base-assets.test.ts` 钉着这条。
- 对外发布还要**打 tag**：tag 名 = `v<manifest.json 的 version>`。自更新分两段——先读分发仓库 master 的 `downloads/version.json` 拿到 tag，再去 `<分发仓库>/releases/<tag>/` 拉三件套（ADR-0263 / ADR-0269）。指针由 `pnpm manifest` 从 `manifest.json` 推出来，两者不同步 `--check` 会拦；`releases/<tag>` 目录由 `push-assets` 按同一个版本号命名，两者天然对齐。
- **tag 之后是 GitHub Release**（`yeshimei/bz`，Release 页是普通人唯一看得到的安装说明）：三个资产 + 一份带安装教程的正文。
  - `bz-<版本>.zip` ← 主仓根 `main.js` / `manifest.json` / `styles.css`，包内必须留一层 `bz/`（压平了就是三个文件散一地，用户得自己猜往哪放）。
  - `bz-offline-<版本>.zip` ← 主仓 `downloads/` 整目录，包内路径必须是 `bz-offline/downloads/<file>`。插件按 `<vault>/bz-offline/downloads/…` 直接开文件（`src/core/offline-source.ts`），**多套一层（`bz-offline/bz-offline/downloads`）不会报错，只会静默回落到联网**，然后用户以为包没用。
  - `SHA256SUMS.txt` ← `sha256sum *.zip | sed 's/\*/ /'`（msys 默认输出 `hash *file`，那个 `*` 要去掉，不然 `sha256sum -c` 之外的工具认不出）。
  - 正文每次重写，不复制上一版：这次改了什么 + 三条安装路（压缩包 / 三个文件 / 手机：文件 App 解压后移进 `.obsidian/plugins/`，先关限制模式）+ **离线包装法单独一节**（解压 → `bz-offline/` 放 vault 根目录、与 `.obsidian` 同级 → 目录结构图 → 回插件再点下载），并写明离线包只管资源下载与便携 Node（`bz-offline/node/`）、**插件本体升级仍要手动覆盖三件套**；内网有静态服务可改走「镜像源」。
  - 顺序不能倒：**先本地 `git tag -a v<版本>` 并 push，再 `gh release create`** —— tag 不存在时 `gh` 会自建一个轻量 tag，和已 push 的标注 tag 对不上。
  - 命令（Git Bash；Windows 没有 `zip`/`7z`，打包用 PowerShell `Compress-Archive`，别用 `Add-Type`——安全策略直接拦）：`gh release create v<版本> -R yeshimei/bz --title "bz v<版本>" --notes-file note.md bz-<版本>.zip bz-offline-<版本>.zip SHA256SUMS.txt`
  - 同一天发第二个版本：`_gen-changelog.mjs` 的版本块按部署日切，自己推不出新号，要显式 `--version=<新号>`，否则 `manifest.json` 与日志版本对不上。
- 改了工具坞的**判据**（`src/dock/rules.ts` / `schema.ts` / `registry.ts` / `declaration.ts` 的读侧）要重跑 `node scripts/build-dock-watch.mjs` —— 值守进程用的 `dock-core.cjs` 是这么打出来的，不重打它就还在按旧判据决定「该不该跑」（`pnpm run build` 已含这一步）。

## 提交
Conventional Commits，**提交信息即更新日志正文**（写法 `docs/changelog.md`）；只有 `feat` / `fix` / `perf` 进更新日志。标题的**主句**（`——` 之前那段）至少 4 个字 —— 短于它整条会被 `_gen-changelog.mjs` 的 `rewrite()` **静默丢弃**：提交照样成功，日志里就是没这条。流程：worktree → `git merge master` → 门禁全绿（`node scripts/test-affected.mjs --since master` + `tsc --noEmit` + 自审 + diff 审查）→ 合回主仓 → 主仓 `tools-pack` → `skin-pack` → `changelog` → `catalog` → `manifest` → `build` → `assets`（七步都要，前五步顺序固定）→ 打 tag（`v<版本号>`）并 push → GitHub Release（`bz-<版本>.zip` + `bz-offline-<版本>.zip` + `SHA256SUMS.txt` + 重写的安装正文，见上）→ 子代理 review → 清 worktree。

占 issues / ADR 编号前先查主仓库最新号；拍板结论进 `.scratch/memo-suite-plugin/spec.md`，决策进 `docs/adr/` 并同步 `CONTEXT.md`。

## 去哪儿查
| 要什么 | 去哪 |
|---|---|
| 某域数据落在哪 | 该域 `data.ts` 的路径 / 键常量（缺省数据根 `<插件目录>/storage/`，ADR-0270；`CONFIG/STORAGE/` 是老库的落位，不是缺省） |
| 域职责、术语、口径 | `CONTEXT.md` |
| 单源域名单 | `build-preview.mjs` 的 `PREVIEW_DOMAINS` / `BEHAVIOR_DOMAINS` |
| 皮肤清单 | `scripts/skins.catalog.json` |
| 离线值守（Obsidian 关着也跑） | `tools/dock-watch/README.md`（装法/排障）· 租约与状态接口 `src/dock/watchdog.ts` · ADR-0242 |
| 值守跑之前等网络 | `tools/dock-watch/net.js` 文件头 · ADR-0242 补记（等不到不记账，留给下一拍） |
| 写一个接入工具坞的外部脚本 | `docs/dock-tool-guide.md`（声明文件 / 参数值文件 / 四行协议 / 运行记录 / 展示板 `panel.html`） |
| 发布怎么推、分发仓库怎么重建 | `scripts/push-assets.mjs`（保留份数 / 压平阈值 / slug 读哪里）· ADR-0269 |
| 发布页正文怎么写、离线包要什么结构 | 上一个 Release 的正文（`gh release view <tag> -R yeshimei/bz --json body -q .body`）· `src/core/offline-source.ts` 文件头的目录图 |
| 资源地址、通道顺序 | `src/core/remote-base.ts`（唯一事实源；别在别处再写一份 slug 或域名）· ADR-0269 |

本文与代码冲突时以代码为准，并顺手改这里。历史注释里的「铁律 N」是旧编号，按内容找，别按号找。
