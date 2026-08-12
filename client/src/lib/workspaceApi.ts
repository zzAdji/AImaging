import type { ActionValidationResult, AiActionPlan, WorkspaceManifest, WorkspaceSession } from "./workspaceProtocol";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function createWorkspaceExam(manifest: WorkspaceManifest): Promise<WorkspaceSession> {
  return request<WorkspaceSession>("/workspace/exams", { method: "POST", body: JSON.stringify(manifest) });
}

export function syncWorkspaceExam(workspaceId: string, manifest: WorkspaceManifest): Promise<WorkspaceSession> {
  return request<WorkspaceSession>(`/workspace/exams/${workspaceId}`, {
    method: "PUT",
    body: JSON.stringify(manifest),
  });
}

export function validateActionPlan(workspaceId: string, plan: AiActionPlan): Promise<ActionValidationResult> {
  return request<ActionValidationResult>(`/workspace/exams/${workspaceId}/actions/validate`, {
    method: "POST",
    body: JSON.stringify(plan),
  });
}
