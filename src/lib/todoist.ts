// Thin client for the Todoist unified API v1 (https://developer.todoist.com/api/v1/).
// Pure HTTP — no Prisma. Push/reconcile logic that touches our DB lives in
// src/lib/todoist-sync.ts. Every caller treats failures as best-effort: a Todoist
// outage must never fail a note save.

const BASE = "https://api.todoist.com/api/v1";

export const TOUR_PLANNER_LABEL = "tour-planner";

export class TodoistError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "TodoistError";
  }
}

export type TodoistProject = { id: string; name: string };

export type TodoistTask = {
  id: string;
  content: string;
  // The v1 task model marks completion with `checked`; tolerate the REST-era
  // `is_completed` / `completed_at` spellings too.
  checked?: boolean;
  is_completed?: boolean;
  completed_at?: string | null;
};

export function isTaskCompleted(task: TodoistTask): boolean {
  return (
    task.checked === true ||
    task.is_completed === true ||
    (task.completed_at != null && task.completed_at !== "")
  );
}

async function api<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TodoistError(
      `Todoist ${init?.method ?? "GET"} ${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      res.status,
    );
  }
  // 204 (e.g. task close) has no body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// v1 list endpoints paginate with { results, next_cursor }.
async function listAll<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor
      ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
      : "";
    const page: { results: T[]; next_cursor: string | null } = await api(
      token,
      `${path}${qs}`,
    );
    out.push(...page.results);
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

export function listProjects(token: string): Promise<TodoistProject[]> {
  return listAll<TodoistProject>(token, "/projects");
}

export function createProject(
  token: string,
  name: string,
): Promise<TodoistProject> {
  return api<TodoistProject>(token, "/projects", {
    method: "POST",
    body: { name },
  });
}

export function createTask(
  token: string,
  input: {
    content: string;
    description?: string;
    projectId?: string | null;
    dueDate?: string | null; // "yyyy-mm-dd"
    labels?: string[];
  },
): Promise<TodoistTask> {
  return api<TodoistTask>(token, "/tasks", {
    method: "POST",
    body: {
      content: input.content,
      ...(input.description ? { description: input.description } : {}),
      // No project_id → the user's Inbox, a sensible default.
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
      ...(input.labels?.length ? { labels: input.labels } : {}),
    },
  });
}

export function updateTask(
  token: string,
  taskId: string,
  input: { content?: string; dueDate?: string | null },
): Promise<TodoistTask> {
  return api<TodoistTask>(token, `/tasks/${taskId}`, {
    method: "POST",
    body: {
      ...(input.content !== undefined ? { content: input.content } : {}),
      // null clears the due date.
      ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
    },
  });
}

export function closeTask(token: string, taskId: string): Promise<void> {
  return api<void>(token, `/tasks/${taskId}/close`, { method: "POST" });
}

/** The task, or null when it no longer exists (deleted in Todoist). */
export async function getTask(
  token: string,
  taskId: string,
): Promise<TodoistTask | null> {
  try {
    return await api<TodoistTask>(token, `/tasks/${taskId}`);
  } catch (e) {
    if (e instanceof TodoistError && e.status === 404) return null;
    throw e;
  }
}

/** Make sure our marker label exists so pushed tasks are filterable in Todoist. */
export async function ensureLabel(token: string, name: string): Promise<void> {
  const labels = await listAll<{ id: string; name: string }>(token, "/labels");
  if (labels.some((l) => l.name === name)) return;
  await api(token, "/labels", { method: "POST", body: { name } });
}
