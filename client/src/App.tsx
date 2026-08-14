import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AiDisclaimer } from "./components/ai/AiDisclaimer";
import { AiSidebarLeft } from "./components/ai/AiSidebarLeft";
import { AiSidebarRight } from "./components/ai/AiSidebarRight";
import { FloatingCommandBar } from "./components/ai/FloatingCommandBar";
import { ReportEditorModal } from "./components/ai/ReportEditor";
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
import { MobileShell } from "./components/MobileShell";
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
  isRadiographyCompatible,
  readImportedImageFiles,
  saveExaminations,
  type ExamImage,
  type ExamImageState,
  type Examination,
  type GradCamResult,
} from "./lib/examinations";
import {
  getLastFileHandle,
  recordRecent,
  storeLastFileHandle,
  type RecentFile,
} from "./lib/recent";
import { SHORTCUTS } from "./lib/shortcuts";
import { useIsMobile } from "./lib/useMediaQuery";
import { Button, Divider, Modal, Segmented, Slider } from "./components/ui";
import { cn } from "./lib/cn";
import { buildWorkspaceManifest, captureAnnotatedImage, type AiActionPlan } from "./lib/workspaceProtocol";
import { captureMutableSnapshots, type MutableSnapshotMap } from "./lib/aiTransaction";
import {
  analyzeWorkspaceImages,
  createWorkspaceExam,
  generateWorkspaceGradcam,
  generateRadiographyReport,
  parseExplicitCommand,
  runWorkspaceAgentTurn,
  type RadiographyPrediction,
} from "./lib/workspaceApi";

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

async function captureCanvasContext(
  images: Examination["images"],
  requestedImageIds: string[],
): Promise<{ captures: Record<string, string>; warnings: string[] }> {
  const captures: Record<string, string> = {};
  const warnings: string[] = [];
  const imageById = new Map(images.map((image) => [image.id, image]));
  for (const imageId of [...new Set(requestedImageIds)]) {
    const image = imageById.get(imageId);
    if (!image) {
      warnings.push(`Contexte visuel ignoré : image inconnue '${imageId}'.`);
      continue;
    }
    if (image.dims.w <= 0 || image.dims.h <= 0) {
      warnings.push(`Contexte visuel indisponible pour '${image.name}' : dimensions inconnues.`);
      continue;
    }
    try {
      captures[image.id] = await captureAnnotatedImage(image);
    } catch {
      warnings.push(`La capture canvas de '${image.name}' n'a pas pu être créée.`);
    }
  }
  return { captures, warnings };
}

function Shell({
  examCtx,
  exams,
  onBack,
  onSaveImageState,
  onClearImageState,
  onSavePredictions,
  onSaveGradcams,
}: {
  examCtx: { examId: string; index: number } | null;
  exams: Examination[];
  onBack: () => void;
  onSaveImageState: (examId: string, index: number, state: EditorSnapshot) => void;
  onClearImageState: (examId: string, index: number) => void;
  onSavePredictions: (examId: string, predictions: Record<string, RadiographyPrediction>) => void;
  onSaveGradcams: (examId: string, gradcams: Record<string, GradCamResult>) => void;
}) {
  const w = useWorkspace();
  const { aiMode, splitOn, setSplitOn } = w;
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
  const autoAnalysisStartedFor = useRef<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);

  const exam = examCtx ? exams.find((e) => e.id === examCtx.examId) ?? null : null;

  const applyPrediction = useCallback((prediction: RadiographyPrediction) => {
    const diagnostics = Object.entries(prediction.ensemble_probabilities)
      .sort(([, left], [, right]) => right - left)
      .map(([label, prob]) => ({
        label,
        prob,
        severity: prob >= 0.7 ? "high" as const : prob >= 0.3 ? "medium" as const : "low" as const,
      }));
    w.setAiDiagnostics(diagnostics, {
      modelName: prediction.per_model.map((model) => model.architecture).join(" + "),
      modelCount: prediction.num_models,
    });
  }, [w]);

  const analyzeExamImages = useCallback(async (scope: "active" | "all" = "active") => {
    if (!exam) throw new Error("Ouvrez un examen avant de lancer une analyse.");
    const snapshot = w.captureImageState();
    const current = exam.images[imageIndex];
    if (!current) throw new Error("Image active introuvable.");
    const synchronizedExam = {
      ...exam,
      images: exam.images.map((image, index) => index === imageIndex && snapshot ? { ...image, state: snapshot } : image),
    };
    const session = await createWorkspaceExam(buildWorkspaceManifest(synchronizedExam, current.id));
    const requestedTargets = scope === "all" ? synchronizedExam.images : [current];
    const unsupportedTargets = requestedTargets.filter((image) => !isRadiographyCompatible(image));
    const targets = requestedTargets.filter(isRadiographyCompatible);
    if (targets.length === 0) {
      throw new Error("Le modèle radiographique accepte uniquement les DICOM CR ou DX ; aucune image compatible n'est sélectionnée.");
    }
    setAnalysisProgress({ completed: 0, total: targets.length });
    const response = await analyzeWorkspaceImages(session.workspace_id, targets);
    [
      ...(session.consistency_issues ?? []).map((issue) => issue.message),
      ...response.warnings,
      ...unsupportedTargets.map((image) => `${image.name} : modèle radiographique non applicable à la modalité ${image.metadata?.modality ?? "DICOM inconnue"}.`),
    ]
      .filter((message, index, all) => all.indexOf(message) === index)
      .forEach((warning) => w.recordAiAction(`Cohérence examen : ${warning}`));
    setAnalysisProgress({ completed: response.results.length, total: targets.length });
    onSavePredictions(exam.id, Object.fromEntries(response.results.map((result) => [result.image_id, result.prediction])));
    const activeResult = response.results.find((result) => result.image_id === current.id);
    if (!activeResult) throw new Error("Le serveur n'a pas renvoyé de résultat pour l'image active.");
    applyPrediction(activeResult.prediction);
  }, [applyPrediction, exam, imageIndex, onSavePredictions, w]);

  useEffect(() => {
    if (!analysisProgress || analysisProgress.completed !== analysisProgress.total) return;
    const timer = window.setTimeout(() => setAnalysisProgress(null), 350);
    return () => window.clearTimeout(timer);
  }, [analysisProgress]);

  const transactionStack = useRef<
    Array<{
      examId: string;
      originalIndex: number;
      snapshots: MutableSnapshotMap;
    }>
  >([]);

  const undoLastTransaction = useCallback(() => {
    const record = transactionStack.current.pop();
    if (!record || !exam) return false;
    for (const [imageId, snapshot] of record.snapshots) {
      const idx = exam.images.findIndex((img) => img.id === imageId);
      if (idx < 0) continue;
      if (snapshot.state) {
        onSaveImageState(record.examId, idx, snapshot.state);
      } else {
        onClearImageState(record.examId, idx);
      }
    }
    const currentImg = exam.images[imageIndex];
    if (currentImg) {
      const activeSnapshot = record.snapshots.get(currentImg.id);
      if (activeSnapshot) {
        if (activeSnapshot.state) w.applyImageState(activeSnapshot.state);
        w.setDicomLinear(activeSnapshot.linear);
      }
    }
    if (record.originalIndex !== imageIndex) {
      setImageIndex(record.originalIndex);
    }
    w.recordAiAction("Annulation globale de la dernière transaction IA multi-images.");
    w.setAiTransactionUndoable(transactionStack.current.length > 0);
    return true;
  }, [exam, imageIndex, onClearImageState, onSaveImageState, w]);

  useEffect(() => {
    transactionStack.current = [];
    w.setAiTransactionUndoable(false);
    /* Enregistre l'annulation globale auprès du provider (bouton sidebar). */
    w.setAiTransactionUndo(undoLastTransaction);
  }, [examCtx?.examId, undoLastTransaction, w]);

  const waitForActiveImage = useCallback(
    async (targetImageId: string, timeoutMs = 3000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (w.imageIdRef.current === targetImageId) return true;
        await new Promise((res) => window.setTimeout(() => res(true), 25));
      }
      return w.imageIdRef.current === targetImageId;
    },
    [w.imageIdRef],
  );

  useEffect(() => {
    if (!exam) {
      w.setAiCommandResolver(null);
      return;
    }
    w.setAiCommandResolver(async (text) => {
      const snapshot = w.captureImageState();
      const current = exam.images[imageIndex];
      if (!current) throw new Error("Image active introuvable.");
      const synchronizedExam = {
        ...exam,
        images: exam.images.map((image, index) => index === imageIndex && snapshot ? { ...image, state: snapshot } : image),
      };
      const generatePlanGradcams = async (workspaceId: string, plan: AiActionPlan) => {
        const warnings: string[] = [];
        const generated: Record<string, GradCamResult> = {};
        for (const action of plan.actions.filter((item) => item.type === "generate_gradcam")) {
          const targetImageId = action.target_image_id ?? current.id;
          const targetImage = synchronizedExam.images.find((image) => image.id === targetImageId);
          if (!targetImage) {
            warnings.push(`Grad-CAM ignorée : image inconnue '${targetImageId}'.`);
            continue;
          }
          if (!isRadiographyCompatible(targetImage)) {
            warnings.push(`Grad-CAM ignorée pour '${targetImage.name}' : le modèle radiographique n'accepte que les DICOM CR ou DX.`);
            continue;
          }
          const requestedClass = typeof action.class_name === "string"
            ? action.class_name
            : targetImage.prediction?.ensemble_prediction;
          if (targetImage.gradcam && (!requestedClass || targetImage.gradcam.className === requestedClass)) {
            generated[targetImageId] = targetImage.gradcam;
            if (targetImageId === current.id) w.setGradcamResult(targetImage.gradcam);
            continue;
          }
          try {
            const response = await generateWorkspaceGradcam(workspaceId, targetImage, requestedClass);
            generated[targetImageId] = response.result;
            if (targetImageId === current.id) w.setGradcamResult(response.result);
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "Échec de la génération Grad-CAM.");
          }
        }
        if (Object.keys(generated).length > 0) onSaveGradcams(exam.id, generated);
        return warnings;
      };
      const withoutHandledForeignGradcams = (plan: AiActionPlan): AiActionPlan => ({
        ...plan,
        actions: plan.actions.filter((action) => {
          if (!action.target_image_id || action.target_image_id === current.id) return true;
          return action.type !== "generate_gradcam" && action.type !== "show_gradcam";
        }),
      });

      const executePlanAcrossImages = async (
        planToRun: AiActionPlan,
        synchronizedImages: ExamImage[],
      ): Promise<{ plan: AiActionPlan; actionSummary: string; warnings: string[] }> => {
        const images = [...synchronizedImages];
        const targetIds: string[] = [];
        for (const action of planToRun.actions) {
          const tId = action.target_image_id ?? current.id;
          if (tId !== current.id && (action.type === "generate_gradcam" || action.type === "show_gradcam")) {
            continue;
          }
          if (!targetIds.includes(tId)) targetIds.push(tId);
        }

        if (targetIds.length === 0) {
          return { plan: planToRun, actionSummary: "", warnings: [] };
        }

        const snapshots = captureMutableSnapshots(images, targetIds);
        const warnings: string[] = [];
        const applied: string[] = [];
        let activeIdx = imageIndex;

        try {
          for (const targetId of targetIds) {
            const targetIndex = images.findIndex((img) => img.id === targetId);
            if (targetIndex < 0) {
              warnings.push(`Image cible inconnue '${targetId}'.`);
              continue;
            }
            const targetPlan: AiActionPlan = {
              ...planToRun,
              actions: planToRun.actions.filter((a) => (a.target_image_id ?? current.id) === targetId),
            };

            if (w.imageIdRef.current !== targetId) {
              const snap = w.captureImageState();
              if (snap) {
                onSaveImageState(synchronizedExam.id, activeIdx, snap);
                images[activeIdx] = { ...images[activeIdx], state: snap };
              }
              setImageIndex(targetIndex);
              activeIdx = targetIndex;
              const ok = await waitForActiveImage(targetId);
              if (!ok) throw new Error(`Chargement de l'image '${images[targetIndex].name}' impossible.`);
            }

            const result = w.executeAiActionPlan(targetPlan);
            applied.push(...result.appliedActionIds);
            warnings.push(...result.warnings);

            const snap = w.captureImageState();
            if (snap) {
              onSaveImageState(synchronizedExam.id, targetIndex, snap);
              images[targetIndex] = { ...images[targetIndex], state: snap };
            }
          }
        } catch (error) {
          for (const [imageId, snapshot] of snapshots) {
            const idx = images.findIndex((img) => img.id === imageId);
            if (idx < 0) continue;
            if (snapshot.state) {
              images[idx] = { ...images[idx], state: snapshot.state, src: snapshot.src, linear: snapshot.linear ?? undefined };
              onSaveImageState(synchronizedExam.id, idx, snapshot.state);
            } else {
              images[idx] = { ...images[idx], src: snapshot.src, linear: snapshot.linear ?? undefined, state: undefined };
              onClearImageState(synchronizedExam.id, idx);
            }
          }
          if (activeIdx !== imageIndex) {
            setImageIndex(imageIndex);
            await waitForActiveImage(current.id);
          }
          const own = snapshots.get(current.id);
          if (own) {
            if (own.state) w.applyImageState(own.state);
            w.setDicomLinear(own.linear);
          }
          throw new Error(
            `La commande multi-images a échoué : toutes les images ont été restaurées. ${error instanceof Error ? error.message : ""}`,
            { cause: error },
          );
        }

        if (activeIdx !== imageIndex) {
          setImageIndex(imageIndex);
          await waitForActiveImage(current.id);
        }

        transactionStack.current.push({
          examId: synchronizedExam.id,
          originalIndex: imageIndex,
          snapshots,
        });
        w.setAiTransactionUndoable(true);

        return {
          plan: { ...planToRun, actions: [] },
          actionSummary: `${applied.length} action(s) exécutée(s) sur ${targetIds.length} image(s) de l'examen.`,
          warnings,
        };
      };

      const routeExecution = async (p: AiActionPlan) => {
        const hasForeign = p.actions.some((a) => {
          const tId = a.target_image_id ?? current.id;
          if (tId === current.id) return false;
          return a.type !== "generate_gradcam" && a.type !== "show_gradcam";
        });
        if (!hasForeign) return { plan: p, actionSummary: undefined, warnings: [] as string[] };
        return executePlanAcrossImages(p, synchronizedExam.images);
      };

      if (!text.startsWith("@")) {
        const activeCapture = await captureCanvasContext(synchronizedExam.images, [current.id]);
        const predictions = Object.fromEntries(
          synchronizedExam.images
            .filter((image): image is typeof image & { prediction: RadiographyPrediction } => Boolean(image.prediction))
            .map((image) => [image.id, image.prediction]),
        );
        const requestTurn = async (captures: Record<string, string>) => {
          const manifest = buildWorkspaceManifest(synchronizedExam, current.id, captures);
          const session = await createWorkspaceExam(manifest);
          const turn = await runWorkspaceAgentTurn(
              session.workspace_id,
              text,
              predictions,
              { available: Object.keys(captures).length > 0, image_ids: Object.keys(captures) },
            );
          return {
            turn,
            workspaceId: session.workspace_id,
            consistencyWarnings: (session.consistency_issues ?? []).map((issue) => issue.message),
          };
        };

        let captureWarnings = activeCapture.warnings;
        let captures = activeCapture.captures;
        let turnRequest = await requestTurn(captures);
        let turn = turnRequest.turn;
        const requiredImageIds = turn.needs_visual_context === "all_exam_images"
          ? synchronizedExam.images.map((image) => image.id)
          : turn.needs_visual_context === "target_images"
            ? turn.target_visual_image_ids
            : turn.needs_visual_context === "active_image"
              ? [current.id]
              : [];
        const missingImageIds = requiredImageIds.filter((imageId) => !captures[imageId]);
        if (missingImageIds.length > 0) {
          const additionalCapture = await captureCanvasContext(synchronizedExam.images, missingImageIds);
          captureWarnings = [...captureWarnings, ...additionalCapture.warnings];
          if (Object.keys(additionalCapture.captures).length > 0) {
            captures = { ...captures, ...additionalCapture.captures };
            turnRequest = await requestTurn(captures);
            turn = turnRequest.turn;
          }
        }
        const gradcamWarnings = await generatePlanGradcams(turnRequest.workspaceId, turn.validation.plan);
        const localPlan = withoutHandledForeignGradcams(turn.validation.plan);
        const routed = await routeExecution(localPlan);

        return {
          plan: routed.plan,
          assistantMessage: turn.clarifying_question
            ? `${turn.assistant_message}\n\n${turn.clarifying_question}`
            : turn.assistant_message,
          warnings: [
            ...captureWarnings,
            ...turnRequest.consistencyWarnings,
            ...gradcamWarnings,
            ...turn.warnings,
            ...turn.validation.warnings,
            ...turn.validation.errors,
            ...routed.warnings,
          ],
          limitations: turn.limitations,
          ...(routed.actionSummary ? { actionSummary: routed.actionSummary } : {}),
        };
      }

      const manifest = buildWorkspaceManifest(synchronizedExam, current.id);
      const session = await createWorkspaceExam(manifest);
      const consistencyWarnings = (session.consistency_issues ?? []).map((issue) => issue.message);
      const parsed = await parseExplicitCommand(session.workspace_id, text);
      if (parsed.command === "analyze" || parsed.command === "predict") {
        await analyzeExamImages(/image:all\b/.test(text) ? "all" : "active");
      }
      if (parsed.command === "report") {
        if (!current.prediction) {
          throw new Error("Aucune prédiction disponible. Lancez d'abord @analyze ou @predict.");
        }
        const generated = await generateRadiographyReport(current.prediction);
        const reportAction = parsed.plan.actions.find((action) => action.type === "generate_report");
        if (!reportAction) throw new Error("Le plan de rapport est invalide.");
        const plan: AiActionPlan = {
          ...parsed.plan,
          summary: generated.coherence_passed
            ? "Rapport Gemini généré à partir de la prédiction de l'image active."
            : "Rapport généré avec avertissements de cohérence.",
          actions: [{ ...reportAction, type: "replace_report" as const, text: generated.rendered_text }],
        };
        return { plan, assistantMessage: plan.summary, warnings: [...consistencyWarnings, ...generated.coherence_issues] };
      }
      const gradcamWarnings = await generatePlanGradcams(session.workspace_id, parsed.plan);
      const localPlan = withoutHandledForeignGradcams(parsed.plan);
      const routed = await routeExecution(localPlan);
      return {
        plan: routed.plan,
        assistantMessage: parsed.plan.summary,
        warnings: [...consistencyWarnings, ...gradcamWarnings, ...routed.warnings],
        ...(routed.actionSummary ? { actionSummary: routed.actionSummary } : {}),
      };
    });
    return () => w.setAiCommandResolver(null);
  }, [analyzeExamImages, exam, imageIndex, onSaveGradcams, onSaveImageState, onClearImageState, waitForActiveImage, w]);

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
    if (img.prediction) applyPrediction(img.prediction);
    w.setImageMetadata(img.metadata ?? null);
    w.setDicomLinear(img.linear ?? null);
    w.setPixelSpacingMm(img.metadata?.pixelSpacingMm ?? null);
    w.setGradcamResult(img.gradcam ?? null);
    w.setGradcamOn(Boolean(img.gradcam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examCtx?.examId, imageIndex]);

  useEffect(() => {
    if (!exam || exam.images.length === 0 || exam.images.every((image) => image.prediction)) return;
    if (autoAnalysisStartedFor.current === exam.id) return;
    autoAnalysisStartedFor.current = exam.id;
    if (!exam.images.some(isRadiographyCompatible)) {
      w.recordAiAction("Analyse automatique ignorée : aucun DICOM CR/DX compatible avec le modèle radiographique.");
      return;
    }
    window.setTimeout(() => {
      void analyzeExamImages("all").catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Analyse automatique impossible.";
        w.recordAiAction(`Analyse automatique : ${message}`);
      });
    }, 0);
  }, [analyzeExamImages, exam, w]);

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
    const imported = await readImportedImageFiles([file]);
    const image = imported.images[0];
    if (!image) {
      throw new Error(imported.warnings[0] ?? `Impossible d'ouvrir '${file.name}'.`);
    }
w.openImageData(image.src, image.name);
    w.setImageMetadata(image.metadata ?? null);
    w.setDicomLinear(image.linear ?? null);
    if (image.metadata?.windowWidth && image.metadata.windowWidth > 1) {
      w.setWl({ window: image.metadata.windowWidth, level: image.metadata.windowCenter ?? 127.5 });
    }
    w.setPixelSpacingMm(image.metadata?.pixelSpacingMm ?? null);
    imported.warnings.forEach((warning) => w.recordAiAction(`Import : ${warning}`));
    if (imported.images.length > 1) {
      w.recordAiAction(`Import : DICOM multi-frame détecté ; la première frame est ouverte dans cet espace autonome.`);
    }
    recordRecent(image.name, image.src);
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
      imageSrc: w.dicomLinear ? w.renderSrc : w.imageSrc,
      dims: w.dims,
      shapes: w.shapes,
      filter: w.dicomLinear ? "none" : buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted),
      pixelSpacingMm: w.pixelSpacingMm,
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
      if (mod && e.shiftKey && e.key.toLowerCase() === "i") {
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
        if (e.shiftKey) {
          w.redo();
        } else if (!undoLastTransaction()) {
          /* Pas de transaction IA multi-images en attente : undo classique. */
          w.undo();
        }
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
        if (!w.aiMode) w.setTool(tool);
        return;
      }
      if (e.key === "1" && !mod) w.requestFit();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [w, openImage, save, togglePixelGrid, undoLastTransaction]);

  useEffect(() => {
    if (aiMode && splitOn) setSplitOn(false);
  }, [aiMode, splitOn, setSplitOn]);

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-bg font-sans text-ink">
      {analysisProgress && (
        <div data-attr="exam-analysis-loader" className="absolute inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="w-[min(420px,calc(100vw-48px))] rounded-2xl border border-border bg-panel p-5 shadow-2xl shadow-black/50">
            <p className="text-[13px] font-semibold text-ink">Analyse de l'examen</p>
            <p className="mt-1 text-[11.5px] text-ink-3">Préparation et prédiction par l'ensemble radiographique.</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-hover">
              <div className="relative flex h-full overflow-hidden rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(8, (analysisProgress.completed / Math.max(1, analysisProgress.total)) * 100)}%` }}>
                <span className="absolute inset-0 aim-progress-shimmer bg-[linear-gradient(100deg,transparent_25%,rgba(255,255,255,0.4)_50%,transparent_75%)]" />
              </div>
            </div>
            <p className="mt-2 text-right text-[11px] tabular-nums text-ink-3">{analysisProgress.completed} / {analysisProgress.total} image(s)</p>
          </div>
        </div>
      )}
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
        <AnimatePresence initial={false} mode="popLayout">
          {!w.aiMode && w.toolbarOpen && (
            <motion.div
              key="left-toolbar"
              className="flex shrink-0"
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -40, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <LeftToolbar />
            </motion.div>
          )}
          {w.aiMode && <AiSidebarLeft key="ai-sidebar-left" />}
        </AnimatePresence>
        <div className="relative flex min-w-0 flex-1">
          <CanvasViewport pane="A" onOpenImage={openImage} />
          {!w.aiMode && w.splitOn && (
            <>
              <div className="w-px shrink-0 bg-border" />
              <CanvasViewport pane="B" onOpenImage={openImage} />
            </>
          )}
          <AnimatePresence>{w.aiMode && <FloatingCommandBar key="ai-command-bar" />}</AnimatePresence>
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {w.aiMode && <AiSidebarRight key="ai-sidebar-right" />}
          {!w.aiMode && w.rightPanelOpen && (
            <motion.div
              key="right-panel"
              className="flex shrink-0"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <RightPanel />
            </motion.div>
          )}
          {!w.aiMode && !w.rightPanelOpen && (
            <motion.div
              key="right-panel-rail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex shrink-0"
            >
              <RightPanelRail />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {w.statusBarOpen && <StatusBar />}

      <AnimatePresence>
        {w.aiMode && !w.aiDisclaimerAck && !w.aiDisclaimerDismissed && (
          <AiDisclaimer
            key="ai-disclaimer"
            onContinue={(ack) => {
              if (ack) w.setAiDisclaimerAck(true);
              else w.setAiDisclaimerDismissed(true);
            }}
            onBack={() => {
              w.setAiMode(false);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{w.reportEditOpen && <ReportEditorModal key="report-editor" />}</AnimatePresence>

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
              <Slider
                label="Shape stroke width"
                value={w.shapeStyle.strokeWidth}
                min={1}
                max={12}
                step={0.5}
                onChange={(v) => w.setShapeStyle({ ...w.shapeStyle, strokeWidth: v })}
                display={`${w.shapeStyle.strokeWidth} px`}
              />
              <div className="mt-2 flex items-center gap-1.5">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => w.setShapeStyle({ ...w.shapeStyle, strokeColor: c })}
                    className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline:
                        w.shapeStyle.strokeColor.toLowerCase() === c.toLowerCase()
                          ? "1.5px solid var(--color-accent)"
                          : "none",
                      outlineOffset: 1,
                    }}
                  />
                ))}
                <span className="ml-1 text-[11px] text-ink-3">Shape color</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => w.setShapeStyle({ ...w.shapeStyle, fillColor: c })}
                    className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline:
                        w.shapeStyle.fillColor?.toLowerCase() === c.toLowerCase()
                          ? "1.5px solid var(--color-accent)"
                          : "none",
                      outlineOffset: 1,
                    }}
                  />
                ))}
                <button
                  type="button"
                  title="No fill"
                  onClick={() => w.setShapeStyle({ ...w.shapeStyle, fillColor: null })}
                  className="relative h-4 w-4 overflow-hidden rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                  style={{
                    outline: !w.shapeStyle.fillColor ? "1.5px solid var(--color-accent)" : "none",
                    outlineOffset: 1,
                  }}
                >
                  <span className="absolute left-1/2 top-1/2 h-[2px] w-[18px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded bg-red-400" />
                </button>
                <span className="ml-1 text-[11px] text-ink-3">Fill color</span>
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
  const isMobile = useIsMobile();

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

  const clearImageState = useCallback(
    (examId: string, index: number) => {
      mutateExams((list) =>
        list.map((e) =>
          e.id === examId
            ? {
                ...e,
                lastOpenedAt: new Date().toISOString(),
                images: e.images.map((img, i) =>
                  i === index ? { ...img, state: undefined } : img,
                ),
              }
            : e,
        ),
      );
    },
    [mutateExams],
  );

  const savePredictions = useCallback((examId: string, predictions: Record<string, RadiographyPrediction>) => {
    mutateExams((list) => list.map((exam) => exam.id !== examId ? exam : {
      ...exam,
      images: exam.images.map((image) => predictions[image.id] ? { ...image, prediction: predictions[image.id] } : image),
    }));
  }, [mutateExams]);

  const saveGradcams = useCallback((examId: string, gradcams: Record<string, GradCamResult>) => {
    mutateExams((list) => list.map((exam) => exam.id !== examId ? exam : {
      ...exam,
      images: exam.images.map((image) => gradcams[image.id] ? { ...image, gradcam: gradcams[image.id] } : image),
    }));
  }, [mutateExams]);

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
      {page === "editor" &&
        (isMobile ? (
          <MobileShell
            examCtx={examCtx}
            exams={exams}
            onBack={() => {
              setExamCtx(null);
              setPage("exams");
            }}
            onSaveImageState={saveImageState}
          />
        ) : (
          <Shell
            examCtx={examCtx}
            exams={exams}
            onBack={() => {
              setExamCtx(null);
              setPage("exams");
            }}
            onSaveImageState={saveImageState}
            onClearImageState={clearImageState}
            onSavePredictions={savePredictions}
            onSaveGradcams={saveGradcams}
          />
        ))}
    </WorkspaceProvider>
  );
}
