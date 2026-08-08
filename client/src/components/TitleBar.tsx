import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "../lib/cn";
import { getRecentFiles, type RecentFile } from "../lib/recent";
import {
  BC_PRESETS,
  IMAGE_SELECTION,
  WL_PRESETS,
  useWorkspace,
} from "../state/workspace";
import {
  IconButton,
  MenuItemRow,
  Tooltip,
  type MenuEntry,
} from "./ui";
import { ModeSwitch } from "./ai/ModeSwitch";

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function recentShortcut(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MenuLabel({ label, open }: { label: string; open: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2 py-[3px] text-[12.5px] transition-colors duration-100",
        open ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

export function TitleBar({
  onOpenImage,
  onOpenRecent,
  onSave,
  onSaveAs,
  onExport,
  onClose,
  onOpenPrefs,
  onToggleGrid,
  onTogglePixelGrid,
  onOpenHistogram,
  onOpenImageInfo,
  onOpenDocs,
  onOpenShortcuts,
  onOpenAbout,
  onBack,
  backLabel,
  onAiModeChange,
}: {
  onOpenImage: () => void;
  onOpenRecent: (f: RecentFile) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onClose: () => void;
  onOpenPrefs: () => void;
  onToggleGrid: () => void;
  onTogglePixelGrid: () => void;
  onOpenHistogram: () => void;
  onOpenImageInfo: () => void;
  onOpenDocs: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
  onBack?: () => void;
  backLabel?: string;
  onAiModeChange?: (v: boolean) => void;
}) {
  const w = useWorkspace();
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  const activeView = w.activePane === "B" ? w.viewB : w.view;
  const zoomIn = () => {
    w.setZoomPreset("actual");
    w.setActiveView({ ...activeView, s: Math.min(16, activeView.s * 1.25) });
  };
  const zoomOut = () => {
    w.setZoomPreset("actual");
    w.setActiveView({ ...activeView, s: Math.max(0.05, activeView.s / 1.25) });
  };
  const setZoom = (s: number) => {
    w.setZoomPreset("actual");
    w.setActiveView({ ...activeView, s });
  };
  const rotate = () => {
    w.pushHistory();
    w.setRotation((w.rotation + 90) % 360);
  };

  const recents = getRecentFiles();
  const hasImage = Boolean(w.imageSrc);
  const hasShapeSel = w.selection !== null && w.selection !== IMAGE_SELECTION;
  const isPixelGrid =
    w.gridOn && w.prefs.gridStyle === "lines" && w.prefs.gridSize === 1;

  const ZOOM_PRESET_VALUES = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8];
  const GRID_SIZES = [8, 12, 16, 24, 32, 48];

  const menus: { label: string; entries: MenuEntry[] }[] = [
    {
      label: "File",
      entries: [
        { label: "Open Image…", shortcut: "Ctrl+O", onSelect: onOpenImage },
        {
          label: "Open Recent",
          children:
            recents.length === 0
              ? [{ label: "No Recent Files", disabled: true }]
              : recents.map((r) => ({
                  label: r.name,
                  shortcut: recentShortcut(r.ts),
                  onSelect: () => onOpenRecent(r),
                })),
        },
        { label: "Import DICOM…", shortcut: "Ctrl+Shift+I", disabled: true },
        {
          label: "Save",
          shortcut: "Ctrl+S",
          dividerBefore: true,
          disabled: !hasImage,
          onSelect: onSave,
        },
        { label: "Save As…", disabled: !hasImage, onSelect: onSaveAs },
        {
          label: "Export Image…",
          shortcut: "Ctrl+E",
          dividerBefore: true,
          disabled: !hasImage,
          onSelect: onExport,
        },
        {
          label: "Close",
          shortcut: "Ctrl+W",
          dividerBefore: true,
          disabled: !hasImage,
          onSelect: onClose,
        },
      ],
    },
    {
      label: "Edit",
      entries: [
        {
          label: "Undo",
          shortcut: "Ctrl+Z",
          onSelect: w.undo,
          disabled: !w.canUndo,
        },
        {
          label: "Redo",
          shortcut: "Ctrl+Shift+Z",
          onSelect: w.redo,
          disabled: !w.canRedo,
        },
        {
          label: "Cut",
          shortcut: "Ctrl+X",
          dividerBefore: true,
          disabled: !hasShapeSel,
          onSelect: w.cutSelection,
        },
        {
          label: "Copy",
          shortcut: "Ctrl+C",
          disabled: !hasShapeSel,
          onSelect: w.copySelection,
        },
        {
          label: "Paste",
          shortcut: "Ctrl+V",
          disabled: !w.canPaste,
          onSelect: w.pasteClipboard,
        },
        {
          label: "Duplicate",
          shortcut: "Ctrl+D",
          disabled: !hasShapeSel,
          onSelect: w.duplicateSelection,
        },
        {
          label: "Select All",
          shortcut: "Ctrl+A",
          dividerBefore: true,
          disabled: w.shapes.length === 0,
          onSelect: w.selectAll,
        },
        {
          label: "Preferences…",
          shortcut: "Ctrl+,",
          dividerBefore: true,
          onSelect: onOpenPrefs,
        },
      ],
    },
    {
      label: "View",
      entries: [
        { label: "Zoom In", shortcut: "Ctrl+=", onSelect: zoomIn },
        { label: "Zoom Out", shortcut: "Ctrl+-", onSelect: zoomOut },
        { label: "Fit to Screen", shortcut: "Ctrl+1", onSelect: w.requestFit },
        { label: "100%", shortcut: "Ctrl+0", onSelect: () => setZoom(1) },
        {
          label: "Zoom Presets",
          children: [
            { label: "Fit to Screen", onSelect: w.requestFit },
            ...ZOOM_PRESET_VALUES.map((z) => ({
              label: `${Math.round(z * 100)}%`,
              selected: Math.abs(z - activeView.s) < 0.001,
              onSelect: () => setZoom(z),
            })),
          ],
        },
        {
          label: "Grid",
          shortcut: "Ctrl+'",
          dividerBefore: true,
          selected: w.gridOn,
          onSelect: onToggleGrid,
        },
        {
          label: "Pixel Grid",
          shortcut: "Ctrl+G",
          selected: isPixelGrid,
          onSelect: onTogglePixelGrid,
        },
        {
          label: "Grid Style",
          children: [
            {
              label: "Dots",
              selected: w.prefs.gridStyle === "dots",
              onSelect: () => w.setPrefs({ gridStyle: "dots" }),
            },
            {
              label: "Lines",
              selected: w.prefs.gridStyle === "lines",
              onSelect: () => w.setPrefs({ gridStyle: "lines" }),
            },
          ],
        },
        {
          label: "Grid Size",
          children: GRID_SIZES.map((g) => ({
            label: `${g} px`,
            selected: w.prefs.gridSize === g,
            onSelect: () => w.setPrefs({ gridSize: g }),
          })),
        },
        {
          label: "Rulers",
          shortcut: "Ctrl+R",
          dividerBefore: true,
          selected: w.rulersOn,
          onSelect: () => w.setRulersOn(!w.rulersOn),
        },
        {
          label: "Toolbar",
          shortcut: "Ctrl+\\",
          dividerBefore: true,
          selected: w.toolbarOpen,
          onSelect: () => w.setToolbarOpen(!w.toolbarOpen),
        },
        {
          label: "Right Panel",
          selected: w.rightPanelOpen,
          onSelect: () => w.setRightPanelOpen(!w.rightPanelOpen),
        },
        {
          label: "Status Bar",
          shortcut: "Ctrl+M",
          selected: w.statusBarOpen,
          onSelect: () => w.setStatusBarOpen(!w.statusBarOpen),
        },
      ],
    },
    {
      label: "Image",
      entries: [
        {
          label: "Brightness / Contrast",
          children: BC_PRESETS.map((p) => ({
            label: p.label,
            selected:
              p.brightness === w.brightness && p.contrast === w.contrast,
            onSelect: () => {
              w.setBrightness(p.brightness);
              w.setContrast(p.contrast);
            },
          })),
        },
        {
          label: "Window / Level",
          children: WL_PRESETS.map((p) => ({
            label: p.label,
            selected: p.wl.window === w.wl.window && p.wl.level === w.wl.level,
            onSelect: () => w.setWl(p.wl),
          })),
        },
        {
          label: "Invert",
          selected: w.inverted,
          onSelect: () => {
            w.pushHistory();
            w.setInverted(!w.inverted);
          },
        },
        { label: "Rotate 90° CW", dividerBefore: true, onSelect: rotate },
        {
          label: "Flip Horizontal",
          selected: w.flipH,
          onSelect: () => {
            w.pushHistory();
            w.setFlipH(!w.flipH);
          },
        },
        {
          label: "Flip Vertical",
          selected: w.flipV,
          onSelect: () => {
            w.pushHistory();
            w.setFlipV(!w.flipV);
          },
        },
        {
          label: "Histogram",
          dividerBefore: true,
          disabled: !hasImage,
          onSelect: onOpenHistogram,
        },
        {
          label: "Image Info…",
          shortcut: "Ctrl+I",
          disabled: !hasImage,
          onSelect: onOpenImageInfo,
        },
      ],
    },
    {
      label: "AI",
      entries: [
        {
          label: "Run Analysis",
          shortcut: "Ctrl+Enter",
          onSelect: w.runAnalysis,
        },
        { label: "Auto Segmentation", dividerBefore: true },
        { label: "Magic Wand", onSelect: () => w.setTool("magicwand") },
        { label: "AI Selection", onSelect: () => w.setTool("aiselection") },
        {
          label: "Grad-CAM",
          selected: w.gradcamOn,
          onSelect: () => w.setGradcamOn(!w.gradcamOn),
        },
        {
          label: "Model",
          dividerBefore: true,
          children: [
            { label: "ChestNet v3.1", selected: true },
            { label: "FetalBrain v2.1" },
            { label: "Radiomics v1.2" },
          ],
        },
        { label: "AI Settings…" },
      ],
    },
    {
      label: "Analyze",
      entries: [
        { label: "Classification", onSelect: w.runAnalysis },
        { label: "Segmentation" },
        { label: "Auto Measurements" },
        { label: "Radiomics…" },
        { label: "Compare with Reference", dividerBefore: true },
        { label: "Generate Report…", dividerBefore: true },
      ],
    },
    {
      label: "Window",
      entries: [
        {
          label: "Reset Layout",
          onSelect: () => {
            w.setRightWidth(312);
            w.setToolbarOpen(true);
            w.setRightPanelOpen(true);
            w.setSplitOn(false);
          },
        },
        {
          label: "1 Window",
          dividerBefore: true,
          selected: !w.splitOn,
          onSelect: () => w.setSplitOn(false),
        },
        {
          label: "2 Windows",
          selected: w.splitOn,
          onSelect: () => w.setSplitOn(true),
        },
      ],
    },
    {
      label: "Help",
      entries: [
        { label: "Documentation", onSelect: onOpenDocs },
        {
          label: "Keyboard Shortcuts",
          shortcut: "?",
          onSelect: onOpenShortcuts,
        },
        { label: "About AImaging", dividerBefore: true, onSelect: onOpenAbout },
      ],
    },
  ];

  const zoomPct = Math.round(activeView.s * 100);

  return (
    <header className="relative z-[80] flex h-10 shrink-0 items-center border-b border-border bg-titlebar px-2.5">
      {/* Back to examinations */}
      {onBack && (
        <>
          <button
            type="button"
            data-attr="editor-back"
            onClick={onBack}
            className="mr-2 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
            title="Back to examinations"
          >
            <ArrowLeft size={14} />
            {backLabel}
          </button>
          <div className="mr-2 flex items-center">
            <img
              src="/icon_dark.ico"
              alt="AImaging"
              data-attr="editor-logo"
              className="h-8 w-auto rounded-md"
            />
          </div>
        </>
      )}

      {/* Menus */}
      <nav
        className="relative z-[95] flex items-center gap-0.5"
        onMouseLeave={() => setOpenMenu(null)}
      >
        {menus.map((m, i) => (
          <div
            key={m.label}
            className="relative"
            onMouseEnter={() => openMenu !== null && setOpenMenu(i)}
          >
            <div onClick={() => setOpenMenu(i)}>
              <MenuLabel label={m.label} open={openMenu === i} />
            </div>
            {openMenu === i && (
              <>
                <div
                  className="fixed inset-x-0 bottom-0 top-10 z-[90]"
                  onClick={() => setOpenMenu(null)}
                />
                <div className="absolute left-0 top-full z-[100] mt-0.5 min-w-56 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop">
                  {m.entries.map((e, j) => (
                    <MenuItemRow
                      key={j}
                      entry={e}
                      onClose={() => setOpenMenu(null)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </nav>

      <div className="mx-2.5 h-4 w-px shrink-0 bg-border" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <Tooltip label="Undo" shortcut="Ctrl+Z">
          <IconButton
            icon={Undo2}
            label="Undo"
            onClick={w.undo}
            disabled={!w.canUndo}
          />
        </Tooltip>
        <Tooltip label="Redo" shortcut="Ctrl+Shift+Z">
          <IconButton
            icon={Redo2}
            label="Redo"
            onClick={w.redo}
            disabled={!w.canRedo}
          />
        </Tooltip>
      </div>

      <div className="mx-2.5 h-4 w-px shrink-0 bg-border" />

      {/* Zoom */}
      <div className="relative flex items-center gap-0.5">
        <Tooltip label="Zoom out">
          <IconButton icon={Minus} label="Zoom out" onClick={zoomOut} />
        </Tooltip>
        <button
          type="button"
          onClick={() => setZoomOpen((o) => !o)}
          className={cn(
            "w-12 rounded-md py-[3px] text-center text-[12px] tabular-nums transition-colors duration-100",
            zoomOpen
              ? "bg-hover text-ink"
              : "text-ink-2 hover:bg-hover hover:text-ink",
          )}
        >
          {zoomPct}%
        </button>
        {zoomOpen && (
          <>
            <div
              className="fixed inset-x-0 bottom-0 top-10 z-[90]"
              onClick={() => setZoomOpen(false)}
            />
            <div className="absolute left-1/2 top-full z-[100] mt-0.5 w-40 -translate-x-1/2 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop">
              <MenuItemRow
                entry={{
                  label: "Fit to Screen",
                  shortcut: "Ctrl+1",
                  onSelect: w.requestFit,
                }}
                onClose={() => setZoomOpen(false)}
              />
              {ZOOM_PRESETS.map((z) => (
                <MenuItemRow
                  key={z}
                  entry={{
                    label: `${Math.round(z * 100)}%`,
                    selected: Math.abs(z - activeView.s) < 0.001,
                    onSelect: () => setZoom(z),
                  }}
                  onClose={() => setZoomOpen(false)}
                />
              ))}
            </div>
          </>
        )}
        <Tooltip label="Zoom in">
          <IconButton icon={Plus} label="Zoom in" onClick={zoomIn} />
        </Tooltip>
      </div>

      <div className="mx-2.5 h-4 w-px shrink-0 bg-border" />

      {/* Rotation */}
      <Tooltip label="Rotate" shortcut="Ctrl+Alt+R">
        <button
          type="button"
          onClick={rotate}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[12px] tabular-nums text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
        >
          <RotateCw size={14} />
          {w.rotation}°
        </button>
      </Tooltip>

      <div className="mx-2.5 h-4 w-px shrink-0 bg-border" />

      {/* Mode switch: Normal ⇄ AI */}
      <ModeSwitch
        aiMode={w.aiMode}
        onChange={(v) => {
          onAiModeChange?.(v);
          w.setAiMode(v);
        }}
      />

      {/* Document info — right side */}
      <div className="ml-auto flex items-center gap-1">
        {hasImage ? (
          <>
            <div className="mr-1 hidden items-center gap-1.5 text-[12px] text-ink-2 lg:flex">
              <span className="max-w-44 truncate">{w.imageName}</span>
              <Check size={13} className="shrink-0 text-accent" />
              <span className="text-ink-3">Saved</span>
            </div>
            <div className="mx-2.5 hidden h-4 w-px shrink-0 bg-border lg:block" />
            <span className="hidden text-[11px] tabular-nums text-ink-3 lg:inline">
              {w.dims.w > 0
                ? `${w.dims.w} × ${w.dims.h} · ${((w.dims.w * w.dims.h * 4) / 1048576).toFixed(1)} MB`
                : "No image"}
            </span>
          </>
        ) : (
          <span className="mr-1 text-[12px] text-ink-3">No image</span>
        )}
        <div className="mx-2.5 h-4 w-px shrink-0 bg-border" />
        <Tooltip
          label={w.toolbarOpen ? "Hide toolbar" : "Show toolbar"}
          shortcut="Ctrl+\\"
        >
          <IconButton
            icon={PanelLeft}
            label="Toggle toolbar"
            active={w.toolbarOpen}
            onClick={() => w.setToolbarOpen(!w.toolbarOpen)}
          />
        </Tooltip>
        <Tooltip label={w.rightPanelOpen ? "Hide panel" : "Show panel"}>
          <IconButton
            icon={PanelRight}
            label="Toggle panel"
            active={w.rightPanelOpen}
            onClick={() => w.setRightPanelOpen(!w.rightPanelOpen)}
          />
        </Tooltip>
      </div>
    </header>
  );
}
