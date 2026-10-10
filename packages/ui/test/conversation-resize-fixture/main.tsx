import { createRoot } from "react-dom/client";
import { useLayoutEffect, useState } from "react";
import {
  ArrowUpIcon,
  BrainIcon,
  ChevronDownIcon,
  LightbulbIcon,
  MonitorCogIcon,
  PlusIcon,
  ShieldIcon,
} from "lucide-react";
import { Button } from "../../src/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu.js";
import { useComposerToolbarFit } from "../../src/prompt-editor/useComposerToolbarFit.js";
import "./fixture.css";

const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "platform-mac-desktop",
  query.get("platform") === "desktop",
);

type Controls = {
  width: (value: number) => void;
  locale: (value: "en" | "zh") => void;
  model: (value: string) => void;
  computer: (value: boolean) => void;
  unmount: () => void;
  toggle: () => void;
};
declare global {
  interface Window {
    resizeFixture: Controls;
  }
}

/** 与 ChatPromptEditor 的 DOM 契约一致；不复制 fit 决策或业务服务。 */
function Toolbar({
  locale,
  model,
  computer,
}: {
  locale: "en" | "zh";
  model: string;
  computer: boolean;
}) {
  const toolbarRef = useComposerToolbarFit();
  const zh = locale === "zh";
  return (
    <div className="@container/composer">
      <div className="pk-composer-shell flex flex-col gap-3 rounded-2xl border border-input-border bg-input p-3">
        <textarea
          data-testid="draft"
          aria-label="Draft"
          className="min-w-0 resize-none text-ui-base"
          defaultValue="Unsubmitted draft / 尚未提交的草稿"
        />
        <div
          ref={toolbarRef}
          data-testid="composer-toolbar"
          className="pk-composer-toolbar group/toolbar flex items-end gap-3"
        >
          <div className="flex min-w-0 flex-1 items-center" data-composer-leading-actions>
            <div className="flex shrink-0 items-center gap-1" data-composer-leading-content>
              <Button variant="ghost" aria-label="Add attachment">
                <PlusIcon className="size-4" />
                <span className="hidden @sm/composer:inline-flex">Files</span>
              </Button>
              {computer && (
                <Button
                  variant="ghost"
                  data-testid="computer"
                  data-composer-collapse-priority="0"
                  className="group/cua h-7 w-fit justify-center gap-1 rounded-lg px-1.5 py-1.5 text-ui-base data-[composer-compact=true]:size-7 data-[composer-compact=true]:gap-0 data-[composer-compact=true]:p-0"
                >
                  <MonitorCogIcon className="size-4 shrink-0" />
                  <span className="inline-flex whitespace-nowrap group-data-[composer-compact=true]/cua:hidden">
                    {zh ? "电脑控制" : "Computer"}
                  </span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Permission menu"
                    data-testid="mode"
                    data-composer-collapse-priority="1"
                    className="group/mode h-7 gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0"
                  >
                    <ShieldIcon className="size-4" />
                    <span className="inline group-data-[composer-compact=true]/mode:hidden">
                      {zh ? "完全访问" : "Full access"}
                    </span>
                    <ChevronDownIcon className="size-3.5 group-data-[composer-compact=true]/mode:hidden" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top">
                  <DropdownMenuItem>Read only</DropdownMenuItem>
                  <DropdownMenuItem>Full access</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                data-testid="plan"
                data-composer-collapse-priority="2"
                className="group/plan h-7 gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0"
              >
                <LightbulbIcon className="size-4" />
                <span className="inline group-data-[composer-compact=true]/plan:hidden">
                  {zh ? "计划模式" : "Plan"}
                </span>
              </Button>
            </div>
          </div>
          <div
            className="ml-auto flex shrink-0 items-center justify-end gap-1.5"
            data-composer-trailing-actions
          >
            <Button
              variant="ghost"
              data-testid="model"
              className="composer-model-trigger group-data-[composer-model-icon=true]/toolbar:size-7 group-data-[composer-model-icon=true]/toolbar:p-0 group-data-[composer-model-icon=true]/toolbar:gap-0 group-data-[composer-model-icon=true]/toolbar:justify-center"
            >
              <BrainIcon className="hidden size-4 group-data-[composer-model-icon=true]/toolbar:inline-flex" />
              <span className="block min-w-0 text-left group-data-[composer-model-icon=true]/toolbar:hidden">
                <span className="composer-provider-prefix inline group-data-[composer-provider-compact=true]/toolbar:hidden">
                  fixture-provider/
                </span>
                {model}
              </span>
              <ChevronDownIcon className="size-3.5 group-data-[composer-model-icon=true]/toolbar:hidden" />
            </Button>
            <Button
              variant="ghost"
              data-testid="thought"
              data-composer-thought-control
              data-composer-collapse-priority="3"
              className="group/thought h-7 shrink-0 gap-1 px-1.5 py-1.5 text-ui-base data-[composer-compact=icon]:size-7 data-[composer-compact=icon]:justify-center data-[composer-compact=icon]:gap-0 data-[composer-compact=icon]:p-0"
            >
              <BrainIcon className="size-4" />
              <span className="hidden w-1 self-stretch rounded-full bg-success group-data-[composer-compact=true]/thought:inline-flex" />
              <span className="min-w-0 whitespace-nowrap group-data-[composer-compact]/thought:hidden">
                {zh ? "最高思考" : "Highest reasoning"}
              </span>
            </Button>
            <Button size="icon-md" aria-label="Send">
              <ArrowUpIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fixture() {
  const [width, setWidth] = useState(1140);
  const [locale, setLocale] = useState<"en" | "zh">("en");
  const [model, setModel] = useState("claude-opus-4-8");
  const [computer, setComputer] = useState(true);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(true);
  useLayoutEffect(() => {
    window.resizeFixture = {
      width: setWidth,
      locale: setLocale,
      model: setModel,
      computer: setComputer,
      unmount: () => setMounted(false),
      toggle: () => setOpen((value) => !value),
    };
  }, []);
  const paragraphs = query.get("text") === "long" ? 180 : 2;
  return (
    <main className="resize-fixture bg-background text-foreground" style={{ width }}>
      <section className="resize-fixture-conversation">
        <Button
          data-testid="toggle-panel"
          variant="outline"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((value) => !value)}
        >
          Toggle right panel
        </Button>
        <article className="resize-fixture-body text-ui-base" data-testid="message-body">
          {Array.from({ length: paragraphs }, (_, index) => (
            <p key={index} className="mb-3">
              {index + 1}. Long message changes wrapping as the panel opens.
              开关右侧面板时长正文反复换行。Markdown、工具结果和用户草稿不应改变。
            </p>
          ))}
        </article>
        {mounted && <Toolbar locale={locale} model={model} computer={computer} />}
      </section>
      <aside
        data-testid="right-panel"
        className="resize-fixture-panel bg-panel"
        data-open={open}
        aria-label="Right panel"
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
