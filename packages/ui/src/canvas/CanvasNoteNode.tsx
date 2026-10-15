import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Node as CanvasNodeShell } from "@/components/ai-elements/node.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import {
  TID_CANVAS_NOTE_DELETE,
  TID_CANVAS_NOTE_EDITOR,
  TID_CANVAS_NOTE_NODE,
  testId,
} from "@shucode/shared";
import { useCanvasBoardStore } from "@/store/canvasBoardStore.js";
import { CanvasBoardScopeContext } from "@/canvas/canvasBoardScopeContext.js";

export type CanvasFlowNode = Node<{ text: string }, "note">;

export const CanvasNoteNode = memo(function CanvasNoteNode({
  id,
  data,
  selected,
}: NodeProps<CanvasFlowNode>) {
  const scope = useContext(CanvasBoardScopeContext);
  const { intl } = useShucodeIntl();
  const updateNoteText = useCanvasBoardStore((state) => state.updateNoteText);
  const removeNodes = useCanvasBoardStore((state) => state.removeNodes);
  const [draft, setDraft] = useState(data.text);

  // 外部把文本改回初始值（如删除后重挂载）时同步本地草稿。
  useEffect(() => {
    setDraft(data.text);
  }, [data.text]);

  const handleDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  }, []);

  const commitDraft = useCallback(() => {
    if (!scope?.boardId || draft === data.text) {
      return;
    }
    updateNoteText({ ...scope, nodeId: id, text: draft });
  }, [data.text, draft, id, scope, updateNoteText]);

  const handleDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!scope?.boardId) {
        return;
      }
      removeNodes({ ...scope, nodeIds: [id] });
    },
    [id, removeNodes, scope],
  );

  return (
    <CanvasNodeShell
      handles={{ target: true, source: true }}
      data-testid={testId(TID_CANVAS_NOTE_NODE, id)}
      className={cn(
        "group/note gap-0 p-2",
        // xyflow handle 定位在卡片边缘外约 4px，Card 基类的 overflow-hidden 会裁掉它的
        // 指针热区（elementFromPoint 直接落到卡片本体、连线拖不出去），必须放开裁剪；
        // 删除按钮同样悬在卡外，依赖该设置才可点击。
        "overflow-visible",
        "[&>.react-flow__handle]:z-10",
        selected && "ring-2 ring-ring",
      )}
    >
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "canvas.deleteNode" })}
        data-testid={testId(TID_CANVAS_NOTE_DELETE, id)}
        onClick={handleDelete}
        className="nodrag absolute -end-2 -top-2 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-foreground-subtle hover:bg-hover hover:text-foreground group-hover/note:flex"
      >
        <X className="size-3" />
      </button>
      <textarea
        data-testid={testId(TID_CANVAS_NOTE_EDITOR, id)}
        value={draft}
        placeholder={intl.formatMessage({ id: "canvas.notePlaceholder" })}
        onChange={handleDraftChange}
        onBlur={commitDraft}
        className="nodrag nowheel h-28 w-full resize-none bg-transparent text-ui-base text-foreground outline-none placeholder:text-foreground-subtle"
      />
    </CanvasNodeShell>
  );
});

// 需定义在 CanvasNoteNode 之后：模块求值时对象字面量要捕获组件引用。
export const CANVAS_NODE_TYPES = { note: CanvasNoteNode };
