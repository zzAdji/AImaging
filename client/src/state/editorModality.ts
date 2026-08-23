import { createContext, useContext, useState } from "react";
import type { Examination } from "../lib/examinations";
import type { ModalityId } from "../lib/modality";
import { getModalityModule, modalityModuleForExam, type ModalityModule } from "../lib/modalityRegistry";

/**
 * Contexte « modalité active » de l'éditeur.
 *
 * Dérivé de l'examen ouvert (exam.modality normalisé) SANS toucher au
 * WorkspaceProvider : le cœur de l'éditeur reste identique, seule la couche
 * outils/panneaux spécifiques change (INSTRUCTIONS.md §Modalité de l'examen).
 * Convention du projet : le contexte + le hook vivent ici, le composant
 * Provider est exporté par state/EditorModalityContext.tsx.
 */

export interface EditorModalityState {
  modality: ModalityId;
  module: ModalityModule;
  /** Outil fœtal actif sélectionné dans la sidebar gauche (pilote le panneau droit). */
  activeToolId: string | null;
  setActiveToolId: (id: string | null) => void;
}

/** État par défaut = radiographie : l'éditeur autonome garde son UI de référence. */
export const DEFAULT_EDITOR_MODALITY: EditorModalityState = (() => {
  const module = getModalityModule("radiography");
  return { modality: module.id, module, activeToolId: null, setActiveToolId: () => undefined };
})();

export const EditorModalityContext = createContext<EditorModalityState>(DEFAULT_EDITOR_MODALITY);

/**
 * État de modalité courant pour un examen ouvert (ou null hors examen).
 * Le module garde une identité stable tant que la modalité ne change pas,
 * ce qui évite tout re-render inutile des consommateurs.
 */
export function resolveEditorModality(exam: Examination | null): ModalityModule {
  return exam ? modalityModuleForExam(exam) : getModalityModule("radiography");
}

/**
 * État de modalité courant. Hors provider (ex. drawer mobile avant le branchement),
 * retourne le fallback radiographie — aucun consommateur ne peut crasher.
 */
export function useEditorModality(): EditorModalityState {
  return useContext(EditorModalityContext);
}

/** Hook interne du provider : réinitialise l'outil actif quand la modalité change. */
export function useResetActiveToolOnModalityChange(modality: ModalityId): [string | null, (id: string | null) => void] {
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [prevModality, setPrevModality] = useState<ModalityId>(modality);
  if (prevModality !== modality) {
    /* Ajustement pendant le rendu (motif React officiel « you might not need
       an effect ») : pas de setState dans un effet, pas de flash de rendu. */
    setPrevModality(modality);
    setActiveToolId(null);
  }
  return [activeToolId, setActiveToolId];
}
