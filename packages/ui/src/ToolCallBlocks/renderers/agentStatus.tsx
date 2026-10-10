import { CircleIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

// 子智能体运行/完成/失败的状态色；遵循 DESIGN.md「station lamps / agent pills」约定：
// 运行中=warning(琥珀)、已完成=success(绿)、失败=destructive(红)、其它=中性。
// 身份色(subagentColors)仍只表达 Agent 身份，不参与状态。
export type AgentStatusTone = "running" | "success" | "error" | "neutral";

export const AGENT_STATUS_WORD_CLASS: Record<AgentStatusTone, string> = {
  running: "text-warning",
  success: "text-success",
  error: "text-destructive",
  neutral: "text-foreground-subtle",
};

export function resolveAgentStatusTone(
  isRunning: boolean,
  status: string | undefined,
): AgentStatusTone {
  if (isRunning) {
    return "running";
  }
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  return "neutral";
}

// 运行中用旋转 loader 表达进行中，其余状态用实心圆点；颜色 + 状态词双通道，不只靠颜色。
export function AgentStatusIndicator({ tone }: { tone: AgentStatusTone }) {
  if (tone === "running") {
    return <Loader2Icon className="size-3 shrink-0 animate-spin text-warning" />;
  }
  return (
    <CircleIcon className={cn("size-2 shrink-0 fill-current", AGENT_STATUS_WORD_CLASS[tone])} />
  );
}
