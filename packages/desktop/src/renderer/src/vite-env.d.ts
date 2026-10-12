// vite 资源导入的 tsc 侧声明：CSS 由 vite 构建处理，tsc 只做类型检查（noEmit）。
// 全局脚本文件（无 import/export），ambient 声明对 renderer 工程全局生效。
declare module "*.css";
