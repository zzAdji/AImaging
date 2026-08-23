import { useMemo, type ReactNode } from "react";
import type { Examination } from "../lib/examinations";
import {
  EditorModalityContext,
  resolveEditorModality,
  useResetActiveToolOnModalityChange,
} from "./editorModality";

/**
 * Provider « modalité active » de l'éditeur.
 * Contexte, hook et logique : voir state/editorModality.ts (convention du
 * projet : un seul export composant par fichier provider).
 */
export function EditorModalityProvider({
  exam,
  children,
}: {
  exam: Examination | null;
  children: ReactNode;
}) {
  const module = useMemo(() => resolveEditorModality(exam), [exam]);
  const modality = module.id;
  const [activeToolId, setActiveToolId] = useResetActiveToolOnModalityChange(modality);

  return (
    <EditorModalityContext.Provider value={{ modality, module, activeToolId, setActiveToolId }}>
      {children}
    </EditorModalityContext.Provider>
  );
}

