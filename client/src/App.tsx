import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasViewport } from "./components/CanvasViewport";
import {
  AboutModal,
  DocumentationModal,
  HistogramModal,
  ImageInfoModal,
  ShortcutsModal,
} from "./components/Dialogs";
import { ExamsScreen } from "./components/ExamsScreen";
import { LeftToolbar } from "./components/LeftToolbar";
import { LoginScreen } from "./components/LoginScreen";
import { RightPanel } from "./components/RightPanel";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { WorkspaceProvider } from "./state/WorkspaceProvider";
import {
  ACCENT_COLORS,
  DEFAULT_PREFS,
  DEFAULT_SHAPE_STYLE,
  IMAGE_SELECTION,
  SELECT_ALL,
  TEXT_COLORS,
  buildImageFilter,
  useWorkspace,
  type ToolId,
} from "./state/workspace";
import { downloadDataUrl, downloadJson, exportImageDataUrl } from "./lib/exportImage";
import {
  loadExaminations,
  saveExaminations,
  type ExamImageState,
  type Examination,
} from "./lib/examinations";
import {
  getLastFileHandle,
  recordRecent,
  storeLastFileHandle,
  type RecentFile,
} from "./lib/recent";
import { SHORTCUTS } from "./lib/shortcuts";
import { Button, Divider, Modal, Segmented, Slider } from "./components/ui";
import { cn } from "./lib/cn";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "move",
  h: "hand",
  z: "zoom",
  r: "rectangle",
  o: "ellipse",
  a: "angle",
  l: "line",
  p: "freedraw",
  m: "measure",
  d: "distance",
  n: "annotation",
  t: "text",
  c: "crop",
  w: "windowlevel",
  b: "brightness",
};

function RightPanelRail() {
  const { setRightPanelOpen } = useWorkspace();
  return (
    <div
      onClick={() => setRightPanelOpen(true)}
      className="group relative w-1 shrink-0 cursor-pointer bg-panel transition-[width] duration-150 ease-out hover:w-2"
      title="Show panel"
    >
      <div className="absolute left-0 top-0 h-full w-px bg-border" />
      <div className="absolute left-1/2 top-1/2 flex h-16 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-hover opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100">
        <div className="h-1 w-1 rounded-full bg-accent" />
      </div>
    </div>
  );
}

type FileWindow = Window & {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    startIn?: FileSystemFileHandle;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

function Shell({
  examCtx,
  exams,
  onBack,
  onSaveImageState,
}: {
  examCtx: { examId: string; index: number } | null;
  exams: Examination[];
  onBack: () => void;
  onSaveImageState: (examId: string, index: number, state: EditorSnapshot) => void;
}) {
  const w = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [histogramOpen, setHistogramOpen] = useState(false);
  const [imageInfoOpen, setImageInfoOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState(0.9);
  const [saveAsName, setSaveAsName] = useState("");
  const [imageIndex, setImageIndex] = useState(examCtx?.index ?? 0);

  const exam = examCtx ? exams.find((e) => e.id === examCtx.examId) ?? null : null;

  /* Load / restore the examination image into the editor */
  useEffect(() => {
    if (!exam) return;
    const img = exam.images[imageIndex];
    if (!img) return;
    if (img.state) {
      w.applyImageState(img.state);
    } else {
      w.openImageData(img.src, img.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examCtx?.examId, imageIndex]);

  const switchImage = (i: number) => {
    if (!exam || i === imageIndex) return;
    const snap = w.captureImageState();
    if (snap) onSaveImageState(exam.id, imageIndex, snap);
    setImageIndex(i);
  };

  const handleBack = () => {
    if (exam) {
      const snap = w.captureImageState();
      if (snap) onSaveImageState(exam.id, imageIndex, snap);
    }
    onBack();
  };

  const isPixelGrid = w.gridOn && w.prefs.gridStyle === "lines" && w.prefs.gridSize === 1;
  const togglePixelGrid = useCallback(() => w.setPixelGrid(!isPixelGrid), [w, isPixelGrid]);

  const resetPrefs = () => {
    w.setPrefs({ ...DEFAULT_PREFS });
    w.setShapeStyle({ ...DEFAULT_SHAPE_STYLE });
  };

  const openFile = useCallback(async (file: File) => {
    const name = file.name.replace(/\.[^.]+$/, "");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    w.openImageData(dataUrl, name);
    recordRecent(name, dataUrl);
  }, [w]);

  const openImage = useCallback(async () => {
    const picker = (window as FileWindow).showOpenFilePicker;
    if (picker) {
      try {
        const last = await getLastFileHandle();
        const [handle] = await picker({
          multiple: false,
          startIn: last ?? undefined,
          types: [
            {
              description: "Images & DICOM",
              accept: { "image/*": [".png", ".jpg", ".jpeg", ".dcm", ".dicom"] },
            },
          ],
        });
        const file = await handle.getFile();
        await storeLastFileHandle(handle);
        await openFile(file);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* fall through to the plain input */
      }
    }
    fileRef.current?.click();
  }, [openFile]);

  const openRecent = async (f: RecentFile) => {
    if (f.dataUrl) {
      w.openImageData(f.dataUrl, f.name);
      recordRecent(f.name, f.dataUrl);
      return;
    }
    openImage();
  };

  const save = useCallback(async () => {
    if (!w.imageSrc) return;
    await w.saveDocument();
  }, [w]);

  const confirmSaveAs = async () => {
    const name = saveAsName.trim();
    if (!name) return;
    const res = await w.saveDocument(name);
    if (!res) return;
    downloadJson(res.doc, `${res.name}.aimaging.json`);
    setSaveAsOpen(false);
  };

  const doExport = async () => {
    if (!w.imageSrc) return;
    const url = await exportImageDataUrl({
      imageSrc: w.imageSrc,
      dims: w.dims,
      shapes: w.shapes,
      filter: buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted),
      format,
      quality,
    });
    downloadDataUrl(url, `${w.imageName}.${format === "jpeg" ? "jpg" : "png"}`);
    setExportOpen(false);
  };

  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openImage();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          setSaveAsName(w.imageName);
          setSaveAsOpen(true);
        } else {
          save();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (w.imageSrc) setExportOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (w.imageSrc) w.closeDocument();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) w.redo();
        else w.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        w.cutSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        w.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        w.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        w.duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        w.selectAll();
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        setPrefsOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        togglePixelGrid();
        return;
      }
      if (mod && e.key === "'") {
        e.preventDefault();
        w.toggleGrid();
        return;
      }
      if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        w.setRulersOn(!w.rulersOn);
        return;
      }
      if (mod && e.key.toLowerCase() === "m") {
        e.preventDefault();
        w.setStatusBarOpen(!w.statusBarOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === "m") {
        e.preventDefault();
        w.setStatusBarOpen(!w.statusBarOpen);
        return;
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        w.setToolbarOpen(!w.toolbarOpen);
        return;
      }
      if (mod && e.shiftKey && e.key === "\\") {
        e.preventDefault();
        w.setRightPanelOpen(!w.rightPanelOpen);
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        w.runAnalysis();
        return;
      }
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (w.imageSrc) setImageInfoOpen(true);
        return;
      }
      if (!mod && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === "Enter" && w.crop) {
        e.preventDefault();
        w.applyCrop();
        return;
      }
      if (mod && e.key === "1") {
        e.preventDefault();
        w.requestFit();
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        w.setActiveView({ ...(w.activePane === "B" ? w.viewB : w.view), s: 1 });
        w.setZoomPreset("actual");
        return;
      }
      if (e.key === "Escape") {
        if (w.crop) {
          w.setCrop(null);
          return;
        }
        if (w.selection !== null) {
          w.setSelection(null);
        } else {
          w.setTool("move");
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && w.selection && w.selection !== IMAGE_SELECTION) {
        e.preventDefault();
        w.pushHistory();
        if (w.selection === SELECT_ALL) w.removeShapes(w.shapes.map((s) => s.id));
        else w.removeShape(w.selection);
        w.setSelection(null);
        return;
      }
      if (
        !mod &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") &&
        w.selection !== null &&
        w.selection !== IMAGE_SELECTION
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        w.nudgeSelection(dx, dy);
        return;
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool && !mod) {
        w.setTool(tool);
        return;
      }
      if (e.key === "1" && !mod) w.requestFit();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [w, openImage, save, togglePixelGrid]);

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-bg font-sans text-ink">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.dcm,.dicom"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) openFile(file);
        }}
      />
      <TitleBar
        onOpenImage={openImage}
        onOpenRecent={openRecent}
        onSave={save}
        onSaveAs={() => {
          setSaveAsName(w.imageName);
          setSaveAsOpen(true);
        }}
        onExport={() => setExportOpen(true)}
        onClose={w.closeDocument}
        onOpenPrefs={() => setPrefsOpen(true)}
        onToggleGrid={w.toggleGrid}
        onTogglePixelGrid={togglePixelGrid}
        onOpenHistogram={() => setHistogramOpen(true)}
        onOpenImageInfo={() => setImageInfoOpen(true)}
        onOpenDocs={() => setDocsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onBack={exam ? handleBack : undefined}
        backLabel={exam ? exam.name : undefined}
      />
      {exam && exam.images.length > 1 && (
        <div className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-panel px-3">
          {exam.images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              data-attr={`exam-image-${i}`}
              onClick={() => switchImage(i)}
              title={img.name}
              className={cn(
                "flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition-colors duration-100",
                i === imageIndex ? "border-accent" : "border-border hover:border-accent/60",
              )}
            >
              <img src={img.src} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {w.toolbarOpen && <LeftToolbar />}
        <CanvasViewport pane="A" onOpenImage={openImage} />
        {w.splitOn && (
          <>
            <div className="w-px shrink-0 bg-border" />
            <CanvasViewport pane="B" onOpenImage={openImage} />
          </>
        )}
        {w.rightPanelOpen ? <RightPanel /> : <RightPanelRail />}
      </div>
      {w.statusBarOpen && <StatusBar />}

      {saveAsOpen && (
        <Modal title="Save As" onClose={() => setSaveAsOpen(false)} width="w-80">
          <label className="block text-[12px] text-ink-2">
            File name
            <input
              autoFocus
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveAs();
              }}
              className="mt-1 w-full rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent/60"
            />
          </label>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
            <span>Saved to localStorage</span>
            <span className="text-ink-3">·</span>
            <span>Downloads a .aimaging.json snapshot</span>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSaveAsOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmSaveAs} disabled={!saveAsName.trim()}>
              Save As
            </Button>
          </div>
        </Modal>
      )}

      {exportOpen && (
        <Modal title="Export Image" onClose={() => setExportOpen(false)} width="w-80">
          <div className="space-y-3">
            <Segmented<"png" | "jpeg">
              options={[
                { label: "PNG", value: "png" },
                { label: "JPEG", value: "jpeg" },
              ]}
              value={format}
              onChange={setFormat}
            />
            {format === "jpeg" && (
              <Slider
                label="Quality"
                value={Math.round(quality * 100)}
                min={50}
                max={100}
                onChange={(v) => setQuality(v / 100)}
                display={`${Math.round(quality * 100)}%`}
              />
            )}
            <p className="text-[11px] text-ink-3">
              {w.dims.w} × {w.dims.h} px · includes annotations · {format === "jpeg" ? "white" : "transparent"} background
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={doExport}>
              Export
            </Button>
          </div>
        </Modal>
      )}

      {prefsOpen && (
        <Modal title="Preferences" onClose={() => setPrefsOpen(false)} width="w-[440px]">
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div>
              <p className="mb-1.5 text-[12px] text-ink-2">Appearance</p>
              <div className="flex items-center gap-1.5">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => w.setPrefs({ accent: c })}
                    className="h-5 w-5 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: w.prefs.accent === c ? "1.5px solid var(--color-accent)" : "none",
                      outlineOffset: 1,
                    }}
                  />
                ))}
                <span className="ml-1 text-[11px] text-ink-3">Accent color</span>
              </div>
            </div>

            <Divider />

            <div>
              <p className="mb-1.5 text-[12px] text-ink-2">Editing defaults</p>
              <Slider
                label="Annotation font size"
                value={w.shapeStyle.fontSize}
                min={10}
                max={32}
                onChange={(v) => w.setShapeStyle({ ...w.shapeStyle, fontSize: v })}
                display={`${w.shapeStyle.fontSize} px`}
              />
              <div className="mt-2 flex items-center gap-1.5">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => w.setShapeStyle({ ...w.shapeStyle, color: c })}
                    className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: w.shapeStyle.color === c ? "1.5px solid var(--color-accent)" : "none",
                      outlineOffset: 1,
                    }}
                  />
                ))}
                <span className="ml-1 text-[11px] text-ink-3">Text color</span>
              </div>
            </div>

            <Divider />

            <div>
              <p className="mb-1.5 text-[12px] text-ink-2">View defaults</p>
              <Segmented<"dots" | "lines">
                options={[
                  { label: "Dots", value: "dots" },
                  { label: "Lines", value: "lines" },
                ]}
                value={w.prefs.gridStyle}
                onChange={(v) => w.setPrefs({ gridStyle: v })}
              />
              <div className="mt-2.5">
                <Slider
                  label="Grid size"
                  value={w.prefs.gridSize}
                  min={8}
                  max={64}
                  onChange={(v) => w.setPrefs({ gridSize: v })}
                  display={`${w.prefs.gridSize} px`}
                />
              </div>
            </div>

            <Divider />

            <div>
              <p className="mb-1.5 text-[12px] text-ink-2">History</p>
              <Slider
                label="Undo steps"
                value={w.prefs.undoCap}
                min={10}
                max={200}
                step={10}
                onChange={(v) => w.setPrefs({ undoCap: v })}
                display={`${w.prefs.undoCap} steps`}
              />
            </div>

            <Divider />

            <div>
              <p className="mb-1.5 text-[12px] text-ink-2">Keyboard shortcuts</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {SHORTCUTS.map(([k, s]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-ink-3">{k}</span>
                    <kbd className="rounded border border-border bg-btn px-1.5 py-px font-mono text-[10px] text-ink-2">
                      {s}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={resetPrefs}>
              Reset defaults
            </Button>
            <Button variant="primary" onClick={() => setPrefsOpen(false)}>
              Done
            </Button>
          </div>
        </Modal>
      )}

      {histogramOpen && <HistogramModal onClose={() => setHistogramOpen(false)} />}
      {imageInfoOpen && <ImageInfoModal onClose={() => setImageInfoOpen(false)} />}
      {docsOpen && <DocumentationModal onClose={() => setDocsOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

type Page = "login" | "exams" | "editor";

/** Editor state snapshot captured against an examination image (see captureImageState) */
type EditorSnapshot = ExamImageState;

function loadSession(): { email: string } | null {
  try {
    const raw =
      localStorage.getItem("aimaging.session") ??
      sessionStorage.getItem("aimaging.session");
    if (!raw) return null;
    const s = JSON.parse(raw) as { email?: unknown };
    return s && typeof s.email === "string" ? { email: s.email } : null;
  } catch {
    return null;
  }
}

function storeSession(email: string, remember: boolean) {
  const payload = JSON.stringify({ email });
  try {
    if (remember) {
      localStorage.setItem("aimaging.session", payload);
      sessionStorage.removeItem("aimaging.session");
    } else {
      sessionStorage.setItem("aimaging.session", payload);
      localStorage.removeItem("aimaging.session");
    }
  } catch {
    /* storage unavailable */
  }
}

function clearSession() {
  try {
    localStorage.removeItem("aimaging.session");
    sessionStorage.removeItem("aimaging.session");
  } catch {
    /* storage unavailable */
  }
}

function initialPage(): Page {
  const s = new URLSearchParams(window.location.search).get("screen");
  if (s === "login" || s === "exams" || s === "editor") return s;
  return loadSession() ? "exams" : "login";
}

export default function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const [session, setSession] = useState(loadSession);
  const [examCtx, setExamCtx] = useState<{ examId: string; index: number } | null>(null);
  const [exams, setExams] = useState<Examination[]>(loadExaminations);

  const mutateExams = useCallback((fn: (list: Examination[]) => Examination[]) => {
    setExams((prev) => {
      const next = fn(prev);
      saveExaminations(next);
      return next;
    });
  }, []);

  const openExam = useCallback(
    (examId: string) => {
      const now = new Date().toISOString();
      mutateExams((list) =>
        list.map((e) => (e.id === examId ? { ...e, lastOpenedAt: now } : e)),
      );
      setExamCtx({ examId, index: 0 });
      setPage("editor");
    },
    [mutateExams],
  );

  const saveImageState = useCallback(
    (examId: string, index: number, state: EditorSnapshot) => {
      mutateExams((list) =>
        list.map((e) =>
          e.id === examId
            ? {
                ...e,
                lastOpenedAt: new Date().toISOString(),
                images: e.images.map((img, i) => (i === index ? { ...img, state } : img)),
              }
            : e,
        ),
      );
    },
    [mutateExams],
  );

  const autoRestore = page === "editor" && examCtx === null;

  return (
    <WorkspaceProvider autoRestore={autoRestore}>
      {page === "login" && (
        <LoginScreen
          initialEmail={session?.email}
          onLogin={(email, remember) => {
            storeSession(email, remember);
            setSession({ email });
            setPage("exams");
          }}
        />
      )}
      {page === "exams" && (
        <ExamsScreen
          exams={exams}
          userEmail={session?.email ?? ""}
          onCreateExam={(e) => mutateExams((list) => [...list, e])}
          onUpdateExam={(id, patch) =>
            mutateExams((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
          }
          onDeleteExam={(id) => mutateExams((list) => list.filter((e) => e.id !== id))}
          onOpenExam={openExam}
          onOpenStandalone={() => {
            setExamCtx(null);
            setPage("editor");
          }}
          onSignOut={() => {
            clearSession();
            setSession(null);
            setPage("login");
          }}
        />
      )}
      {page === "editor" && (
        <Shell
          examCtx={examCtx}
          exams={exams}
          onBack={() => {
            setExamCtx(null);
            setPage("exams");
          }}
          onSaveImageState={saveImageState}
        />
      )}
    </WorkspaceProvider>
  );
}
