/* esbuild dataurl loader 的类型声明（esbuild.config.mjs 的 loader 段）：
 * 图片 import 得到的是 `data:image/png;base64,…` 字符串，直接可作 <img src>。
 * 赞赏码走这条路内置（2026-10-30 用户拍板）：图固定不变、体积 68KB，
 * 走远端要等下载且要多一条单文件二进制通道，不划算。 */
declare module '*.png' {
  const dataUrl: string;
  export default dataUrl;
}
