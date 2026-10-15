import { createContext } from "react";
import type { CanvasBoardScope } from "@/store/canvasBoardStore.js";

/** 画布 scope 只经 context 下发给节点组件，避免节点 props 与 React Flow 布局耦合。 */
export const CanvasBoardScopeContext = createContext<CanvasBoardScope | null>(null);
