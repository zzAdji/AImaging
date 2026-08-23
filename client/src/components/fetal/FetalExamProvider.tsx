import type { ReactNode } from "react";
import { FetalExamContext, useFetalExamStore } from "../../state/fetalExam";

/**
 * Provider du store échographie fœtale (un seul export composant,
 * convention react-refresh du projet — logique : state/fetalExam.ts).
 */
export function FetalExamProvider({ children }: { children: ReactNode }) {
  const value = useFetalExamStore();
  return <FetalExamContext.Provider value={value}>{children}</FetalExamContext.Provider>;
}
