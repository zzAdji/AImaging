import { AnimatePresence, motion } from "framer-motion";
import { Activity, ArrowLeft, ImagePlus, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiDisclaimer } from "./ai/AiDisclaimer";
import { AiSidebarLeft } from "./ai/AiSidebarLeft";
import { AiSidebarRight } from "./ai/AiSidebarRight";
import { FloatingCommandBar } from "./ai/FloatingCommandBar";
import { ReportEditorModal } from "./ai/ReportEditor";
import { CanvasViewport } from "./CanvasViewport";
import { cn } from "../lib/cn";
import { readImportedImageFiles, type ExamImageState, type Examination } from "../lib/examinations";
import { recordRecent } from "../lib/recent";
import { useWorkspace } from "../state/workspace";

type EditorSnapshot = ExamImageState;

type FileWindow = Window & {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    startIn?: FileSystemFileHandle;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

/** Minimal IA-only shell for phones & small tablets (< 768 px) */
export function MobileShell({
  examCtx,
  exams,
  onBack,
  onSaveImageState,
}: {
  examCtx: { examId: string; index: number } | null;
  exams: Examination[];
  onBack?: () => void;
  onSaveImageState: (examId: string, index: number, state: EditorSnapshot) => void;
}) {
  const w = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [imageIndex, setImageIndex] = useState(examCtx?.index ?? 0);

  const exam = examCtx ? exams.find((e) => e.id === examCtx.examId) ?? null : null;

  /* IA-only experience: force the switch once */
  useEffect(() => {
    w.setAiMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Load / restore the examination image into the editor */
  useEffect(() => {
    if (!exam) return;
    const img = exam.images[imageIndex];
    if (!img) return;
    if (img.state) {
      w.applyImageState(img.state);
      w.setImageId(img.id);
    } else {
      w.openImageData(img.src, img.name, img.id);
      if (img.metadata?.windowWidth && img.metadata.windowWidth > 1) {
        w.setWl({ window: img.metadata.windowWidth, level: img.metadata.windowCenter ?? 127.5 });
      }
    }
    w.setImageMetadata(img.metadata ?? null);
    w.setDicomLinear(img.linear ?? null);
    w.setPixelSpacingMm(img.metadata?.pixelSpacingMm ?? null);
    w.setGradcamResult(img.gradcam ?? null);
    w.setGradcamOn(Boolean(img.gradcam));
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
    onBack?.();
  };

  const openFile = useCallback(
    async (file: File) => {
      const imported = await readImportedImageFiles([file]);
      const image = imported.images[0];
      if (!image) throw new Error(imported.warnings[0] ?? `Impossible d'ouvrir '${file.name}'.`);
      w.openImageData(image.src, image.name);
      w.setImageMetadata(image.metadata ?? null);
      w.setDicomLinear(image.linear ?? null);
      if (image.metadata?.windowWidth && image.metadata.windowWidth > 1) {
        w.setWl({ window: image.metadata.windowWidth, level: image.metadata.windowCenter ?? 127.5 });
      }
      w.setPixelSpacingMm(image.metadata?.pixelSpacingMm ?? null);
      imported.warnings.forEach((warning) => w.recordAiAction(`Import : ${warning}`));
      if (imported.images.length > 1) w.recordAiAction("Import : première frame d'un DICOM multi-frame ouverte.");
      recordRecent(image.name, image.src);
    },
    [w],
  );

  const openImage = useCallback(async () => {
    const picker = (window as FileWindow).showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          multiple: false,
          types: [
            {
              description: "Images & DICOM",
              accept: { "image/*": [".png", ".jpg", ".jpeg", ".dcm", ".dicom"] },
            },
          ],
        });
        const file = await handle.getFile();
        await openFile(file);
        return;
      } catch {
        /* fall through to the plain input */
      }
    }
    fileRef.current?.click();
  }, [openFile]);

  const toggleDrawer = (side: "left" | "right") =>
    setDrawer((d) => (d === side ? null : side));

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

      {/* Header */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-titlebar px-2.5">
        {onBack && (
          <button
            type="button"
            data-attr="editor-back"
            onClick={handleBack}
            title="Retour aux examens"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <img
          src="/icon_dark.ico"
          alt="AImaging"
          data-attr="editor-logo"
          className="h-6 w-auto shrink-0 rounded-md"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{w.imageName}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-px text-[10px] font-semibold text-accent">
          <Sparkles size={10} strokeWidth={2.4} />
          IA
        </span>
        <button
          type="button"
          data-attr="mobile-import"
          onClick={openImage}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[#4f8ef7] active:bg-[#2563eb]"
        >
          <ImagePlus size={12} />
          Importer
        </button>
      </header>

      {/* Exam image switch strip */}
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

      {/* Main stage */}
      <div className="relative flex min-h-0 flex-1">
        {!w.imageSrc ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            data-attr="mobile-empty"
            className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center"
          >
            <img src="/icon_dark.ico" alt="AImaging" className="h-16 w-auto rounded-xl opacity-90" />
            <div>
              <h1 className="text-[16px] font-semibold text-ink">Mode IA — Analyse</h1>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                Importez une image : vous pourrez ensuite la décrire à l'IA par écrit ou
                à la voix.
              </p>
            </div>
            <button
              type="button"
              data-attr="mobile-import-cta"
              onClick={openImage}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-medium text-white shadow-lg shadow-black/30 transition-colors duration-150 ease-out hover:bg-[#4f8ef7] active:bg-[#2563eb]"
            >
              <ImagePlus size={15} />
              Importer une image
            </button>
          </motion.div>
        ) : (
          <>
            <CanvasViewport pane="A" onOpenImage={openImage} />
            {/* Drawer toggles */}
            <button
              type="button"
              data-attr="mobile-drawer-left"
              onClick={() => toggleDrawer("left")}
              title="Outils IA"
              className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/95 text-icon shadow-2xl shadow-black/50 backdrop-blur transition-colors duration-150 ease-out hover:text-ink"
            >
              <Wand2 size={15} />
            </button>
            <button
              type="button"
              data-attr="mobile-drawer-right"
              onClick={() => toggleDrawer("right")}
              title="Résultats IA"
              className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/95 text-icon shadow-2xl shadow-black/50 backdrop-blur transition-colors duration-150 ease-out hover:text-ink"
            >
              <Activity size={15} />
            </button>
          </>
        )}
        <AnimatePresence>{w.aiMode && <FloatingCommandBar key="ai-command-bar" mobile />}</AnimatePresence>
      </div>

      {/* Drawers (hidden while the report editor is open so it stays above) */}
      <AnimatePresence initial={false}>
        {drawer === "left" && w.aiMode && !w.reportEditOpen && (
          <div key="left-drawer">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[120] bg-black/55"
              onClick={() => setDrawer(null)}
            />
            <AiSidebarLeft key="ai-left-drawer" variant="drawer" />
          </div>
        )}
        {drawer === "right" && w.aiMode && !w.reportEditOpen && (
          <div key="right-drawer">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[120] bg-black/55"
              onClick={() => setDrawer(null)}
            />
            <AiSidebarRight key="ai-right-drawer" variant="drawer" />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {w.aiMode && !w.aiDisclaimerAck && !w.aiDisclaimerDismissed && (
          <AiDisclaimer
            key="ai-disclaimer"
            onContinue={(ack) => {
              if (ack) w.setAiDisclaimerAck(true);
              else w.setAiDisclaimerDismissed(true);
            }}
            onBack={handleBack}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{w.reportEditOpen && <ReportEditorModal key="report-editor" mobile />}</AnimatePresence>
    </div>
  );
}
