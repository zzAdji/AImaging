import {
  ArrowUpRight,
  Circle,
  Contrast,
  Crop,
  DraftingCompass,
  Hand,
  Highlighter,
  Map,
  MousePointer2,
  Pencil,
  Ruler,
  ScanSearch,
  Settings,
  Slash,
  SlidersHorizontal,
  Square,
  StretchHorizontal,
  Sun,
  Type,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { useWorkspace, type ToolId } from "../state/workspace";
import { Tooltip } from "./ui";

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: "move", icon: MousePointer2, label: "Move", shortcut: "V" },
    { id: "hand", icon: Hand, label: "Hand", shortcut: "H" },
    { id: "zoom", icon: ZoomIn, label: "Zoom", shortcut: "Z" },
  ],
  [
    { id: "rectangle", icon: Square, label: "Rectangle", shortcut: "R" },
    { id: "ellipse", icon: Circle, label: "Ellipse", shortcut: "O" },
    { id: "arrow", icon: ArrowUpRight, label: "Arrow", shortcut: "Shift+A" },
    { id: "line", icon: Slash, label: "Line", shortcut: "L" },
    { id: "freedraw", icon: Pencil, label: "Free Draw", shortcut: "P" },
  ],
  [
    { id: "measure", icon: Ruler, label: "Measure", shortcut: "M" },
    { id: "angle", icon: DraftingCompass, label: "Angle", shortcut: "A" },
    { id: "distance", icon: StretchHorizontal, label: "Distance", shortcut: "D" },
  ],
  [
    { id: "annotation", icon: Highlighter, label: "Annotation", shortcut: "N" },
    { id: "text", icon: Type, label: "Text", shortcut: "T" },
  ],
  [{ id: "crop", icon: Crop, label: "Crop", shortcut: "C" }],
  [
    { id: "windowlevel", icon: SlidersHorizontal, label: "Window / Level", shortcut: "W" },
    { id: "brightness", icon: Sun, label: "Brightness", shortcut: "B" },
    { id: "contrast", icon: Contrast, label: "Contrast" },
  ],
  [
    { id: "magicwand", icon: WandSparkles, label: "Magic Wand" },
    { id: "aiselection", icon: ScanSearch, label: "AI Selection" },
    { id: "gradcam", icon: Map, label: "Grad-CAM" },
  ],
];

function ToolButton({ def }: { def: ToolDef }) {
  const { tool, setTool } = useWorkspace();
  const active = tool === def.id;
  const Icon = def.icon;
  return (
    <Tooltip label={def.label} shortcut={def.shortcut} side="right">
      <button
        type="button"
        title={def.label}
        onClick={() => setTool(def.id)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 ease-out",
          active ? "text-accent" : "text-icon hover:bg-hover hover:text-ink",
        )}
      >
        <Icon size={17} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

export function LeftToolbar() {
  return (
    <aside className="relative z-40 flex w-10 shrink-0 flex-col items-center border-r border-border bg-panel py-1.5">
      {GROUPS.map((group, i) => (
        <div key={i} className="flex w-full flex-col items-center">
          {i > 0 && <div className="my-1.5 h-px w-5 bg-border" />}
          {group.map((def) => (
            <ToolButton key={def.id} def={def} />
          ))}
        </div>
      ))}
      <div className="mt-auto w-full">
        <div className="mx-auto my-1.5 h-px w-5 bg-border" />
        <div className="flex w-full justify-center">
          <Tooltip label="Settings" side="right">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <Settings size={17} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
