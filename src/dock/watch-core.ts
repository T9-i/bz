/**
 * 值守进程（`dock-watch`）的**打包入口** —— 只做再导出，一行逻辑都没有（ADR-0242）。
 *
 * 为什么需要这个文件：值守进程要回答「这条规则此刻该不该跑」，而这个问题的答案**只有一份**：
 * 本域的 `ruleDue`（纯函数，`rules.ts`）。复刻一份就是两套真理源 —— 一边改了边界条件
 * （比如 `interval` 首次无基线该不该跑），另一边的实现不知道，迟早漂。
 *
 * 所以 `scripts/build-dock-watch.mjs` 以本文件为入口，把下面这些**零 obsidian 依赖**的
 * 模块打成一个 node 可直跑的 `tools/dock-watch/dock-core.cjs`，值守进程 `require` 它。
 *
 * **边界靠「这里只写 re-export」维持**：只许导出 `schema` / `schedule` / `rules` / `registry` /
 * `declaration` 五个纯模块里的东西。一旦引入 `data` / `store` / `ui`／`scheduler` 这类碰宿主
 * 的模块，打包就会把 `obsidian` 拖进去，值守进程一 require 就炸 —— 判据是「打包产物里不该出现
 * 宿主 API」，据此守。
 *
 * 具名导出而不是 `export *`：五个模块之间有同名导出（如 `durationText` 在 `rules` 与 `schedule`
 * 里各有一份），`export *` 撞上同名会变成有歧义的导出；值守进程要用的面其实很窄，逐条列出来
 * 反而把契约写清楚了。
 */

// 声明与记录的形状（工具目录那两份文件）
export {
  DOCK_RUNS_PER_TOOL_LIMIT,
  buildArgs,
  parseJsonObjectText,
  parseManifest,
  parseRunsFileText,
  parseSchedule,
} from './schema';

// 判据本体 —— 值守进程存在的唯一理由就是复用这一个函数
export { effectiveRules, hasActiveRule, parseRuleState, parseRules, ruleDue } from './rules';

// 「必填参数填了吗」（门槛里那一条；纯函数，零依赖）
export { missingRequiredParams } from './schedule';

// 登记表与命令签名（信任比对：命令改过就不许跑）
export { TOOL_ID_MAX_LEN, TOOL_ID_RE, parseToolEntries, runSignature } from './registry';

// 工具目录三份文件的读侧（fs 是注入缝：值守进程塞 node 的 fs）
export {
  DECLARATION_FILENAME,
  MAIN_ENTRY_FILENAME,
  RUNS_FILENAME,
  SETTINGS_FILENAME,
  currentFs,
  dirOf,
  joinPath,
  readDeclaration,
  readRunsText,
  readSettings,
  resolveRun,
  runsPathFor,
  setDockFs,
  settingsPathFor,
  toolDirOf,
} from './declaration';
