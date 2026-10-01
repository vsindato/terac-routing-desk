import type { ContributorView, ExpertiseView, TaskDetail, TaskSummary } from "@/domain/queries";
import type { SubmitTaskRequest, TaskActionRequest } from "@/server/schemas";

/** The shape a server value takes after JSON serialisation (dates become strings). */
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type Task = Json<TaskSummary>;
export type TaskDetailData = Json<TaskDetail>;
export type Contributor = Json<ContributorView>;
export type Expertise = Json<ExpertiseView>;

/** How often live views poll. Pending routing can resolve at any moment. */
export const POLL_INTERVAL_MS = 1500;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export const api = {
  listTasks: () => request<Task[]>("/api/tasks"),
  getTask: (id: string) => request<TaskDetailData>(`/api/tasks/${id}`),
  listContributors: () => request<Contributor[]>("/api/contributors"),
  listExpertise: () => request<Expertise[]>("/api/expertise"),
  submitTask: (input: SubmitTaskRequest) =>
    request<{ taskId: string }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  act: (taskId: string, action: TaskActionRequest) =>
    request<{ ok: true }>(`/api/tasks/${taskId}/actions`, { method: "POST", body: JSON.stringify(action) }),
};

export const queryKeys = {
  tasks: ["tasks"] as const,
  task: (id: string) => ["tasks", id] as const,
  contributors: ["contributors"] as const,
  expertise: ["expertise"] as const,
};
