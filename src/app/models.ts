export type Status = "todo" | "doing" | "done";
export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;
export type ProgressMode = "none" | "manual" | "target";
export interface TaskList {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  shared?: boolean;
}
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}
export interface Task {
  id: string;
  list_id: string;
  created_by: string;
  title: string;
  notes: string;
  due_date: string | null;
  start_time: string | null;
  duration: number;
  priority: Priority;
  status: Status;
  recurrence: Recurrence;
  repeat_anchor: number | null;
  tags: string[];
  subtasks: Subtask[];
  created_at: string;
  completed_at: string | null;
  source_task_id: string | null;
  sort_order?: number;
  progress_mode?: ProgressMode;
  progress_value?: number;
  progress_target?: number;
  progress_unit?: string;
  is_milestone?: boolean;
  milestone_color?: string;
  goal_id?: string | null;
  series_id?: string | null;
  series_date?: string | null;
  series_modified?: boolean;
  series_until?: string | null;
  series_skips?: string[];
}
export interface PlanningCycle {
  id: string;
  owner_id: string;
  name: string;
  vision: string;
  start_date: string;
  goal_ids: string[];
  reviews: Record<string, { wins: string; improve: string }>;
  archived: boolean;
}
export interface PlannerData {
  version: 1;
  lists: TaskList[];
  tasks: Task[];
  cycles?: PlanningCycle[];
}
export interface TaskPatch {
  id: string;
  patch: Partial<Pick<Task, "duration" | "priority" | "progress_value">>;
}
export interface Preferences {
  view: string;
  showCompleted: boolean;
  sort: string;
  mode?: "planner" | "cycles" | "finance";
}
export const LOCAL_USER = "local";
export const COLORS = [
  "#b9efc9",
  "#a7b9f5",
  "#e5b8ee",
  "#edc691",
  "#8bcdd3",
  "#ef9a9a",
];
export const REPEAT_LABELS: Record<Recurrence, string> = {
  none: "Не повторять",
  daily: "Каждый день",
  weekdays: "По будням",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
};
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}
export function addDays(value: string, days: number): string {
  const d = parseDate(value);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
export function weekStart(value: string): string {
  const d = parseDate(value);
  return addDays(value, -((d.getDay() + 6) % 7));
}
export function nextDate(
  value: string,
  recurrence: Recurrence,
  anchor?: number | null,
): string {
  const d = parseDate(value);
  if (recurrence === "monthly") {
    const day = anchor ?? d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, max));
  } else {
    d.setDate(d.getDate() + (recurrence === "weekly" ? 7 : 1));
    if (recurrence === "weekdays")
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  }
  return dateKey(d);
}
export function durationLabel(minutes: number): string {
  if (!minutes) return "0 мин";
  return [
    minutes >= 60 ? `${Math.floor(minutes / 60)} ч` : "",
    minutes % 60 ? `${minutes % 60} мин` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
/** Accepts minutes, H:MM, and common Russian/English hour-minute notation. */
export function parseDuration(raw: string): number | null {
  const value = raw.trim().toLowerCase().replace(/,/g, ".");
  let minutes: number;
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(":").map(Number);
    if (m >= 60) return null;
    minutes = h * 60 + m;
  } else if (/^\d+(\.\d+)?$/.test(value)) minutes = Number(value);
  else {
    const match = value.match(
      /^(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|час(?:а|ов)?|ч))?\s*(?:(\d+)\s*(?:minutes?|mins?|m|мин(?:ут(?:а|ы)?)?|м))?$/,
    );
    if (!match || (!match[1] && !match[2])) return null;
    minutes = Number(match[1] || 0) * 60 + Number(match[2] || 0);
  }
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440
    ? minutes
    : null;
}
/** Priority controls only the fill; text keeps its contrast at every level. */
export function priorityOpacity(priority: Priority): number {
  return [0.025, 0.12, 0.3, 0.5, 0.75, 1][priority];
}
export function taskProgress(task: Task): number {
  const target =
    task.progress_mode === "manual" ? 100 : task.progress_target || 100;
  return Math.min(
    100,
    Math.max(0, ((task.progress_value || 0) / target) * 100),
  );
}
export function validProgress(task: Task): boolean {
  if (!task.progress_mode || task.progress_mode === "none") return true;
  return (
    ["manual", "target"].includes(task.progress_mode) &&
    Number.isFinite(task.progress_value) &&
    (task.progress_value ?? -1) >= 0 &&
    Number.isFinite(task.progress_target) &&
    (task.progress_target ?? 0) > 0 &&
    (task.progress_target ?? 0) <= 1e12 &&
    (task.progress_value ?? 0) <= 1e12 &&
    (task.progress_mode !== "manual" || (task.progress_value ?? 0) <= 100) &&
    (task.progress_unit?.length ?? 0) <= 30
  );
}
export function makeTask(
  listId: string,
  owner = LOCAL_USER,
  due: string | null = null,
): Task {
  return {
    id: crypto.randomUUID(),
    list_id: listId,
    created_by: owner,
    title: "",
    notes: "",
    due_date: due,
    start_time: null,
    duration: 30,
    priority: 0,
    status: "todo",
    recurrence: "none",
    repeat_anchor: null,
    tags: [],
    subtasks: [],
    created_at: new Date().toISOString(),
    completed_at: null,
    source_task_id: null,
    sort_order: Date.now(),
    progress_mode: "none",
    progress_value: 0,
    progress_target: 100,
    progress_unit: "",
    is_milestone: false,
    goal_id: null,
  };
}
export function transitionTask(
  tasks: Task[],
  id: string,
  status: Status,
  now = new Date(),
): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.status === status) return tasks;
  const updated = tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          status,
          completed_at: status === "done" ? now.toISOString() : null,
        }
      : t,
  );
  if (
    status === "done" &&
    task.recurrence !== "none" &&
    !task.series_id &&
    !tasks.some((t) => t.source_task_id === id)
  ) {
    updated.push({
      ...task,
      id: crypto.randomUUID(),
      status: "todo",
      completed_at: null,
      due_date: nextDate(
        task.due_date || dateKey(now),
        task.recurrence,
        task.repeat_anchor,
      ),
      created_at: now.toISOString(),
      source_task_id: id,
      progress_value: 0,
      subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
    });
  }
  return updated;
}
export function completionStats(tasks: Task[], from: string, to: string) {
  const inRange = (d: string | null) => !!d && d >= from && d <= to;
  const completed = tasks.filter(
    (t) =>
      !t.is_milestone &&
      t.status === "done" &&
      t.completed_at &&
      inRange(dateKey(new Date(t.completed_at))),
  );
  const pending = tasks.filter(
    (t) => !t.is_milestone && t.status !== "done" && inRange(t.due_date),
  );
  const denominator = completed.length + pending.length;
  return {
    completed,
    pending,
    rate: denominator ? Math.round((completed.length / denominator) * 100) : 0,
    minutes: completed.reduce((sum, t) => sum + t.duration, 0),
  };
}
export function validateData(value: unknown): PlannerData {
  const data = value as PlannerData;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.lists) ||
    !Array.isArray(data.tasks) ||
    !data.lists.length ||
    data.lists.length > 500 ||
    data.tasks.length > 50000
  )
    throw new Error("Некорректный файл Flow.");
  const ids = new Set<string>();
  for (const list of data.lists) {
    if (
      !list ||
      typeof list.id !== "string" ||
      ids.has(list.id) ||
      typeof list.name !== "string" ||
      !list.name.trim() ||
      !/^#[0-9a-f]{6}$/i.test(list.color)
    )
      throw new Error("Некорректный список.");
    ids.add(list.id);
  }
  const taskIds = new Set<string>();
  for (const task of data.tasks) {
    if (
      task &&
      (!validProgress(task) ||
        (task.sort_order !== undefined && !Number.isFinite(task.sort_order)))
    )
      throw new Error("Некорректный прогресс или порядок задачи.");
    if (
      !task ||
      typeof task.id !== "string" ||
      taskIds.has(task.id) ||
      !ids.has(task.list_id) ||
      typeof task.title !== "string" ||
      !task.title.trim() ||
      typeof task.notes !== "string" ||
      !["todo", "doing", "done"].includes(task.status) ||
      (task.is_milestone !== undefined &&
        typeof task.is_milestone !== "boolean") ||
      (task.goal_id != null && typeof task.goal_id !== "string") ||
      (task.milestone_color !== undefined &&
        !/^#[0-9a-f]{6}$/i.test(task.milestone_color)) ||
      (task.is_milestone && (!!task.goal_id || task.recurrence !== "none")) ||
      !Object.hasOwn(REPEAT_LABELS, task.recurrence) ||
      !Number.isInteger(task.duration) ||
      task.duration < 5 ||
      task.duration > 1440 ||
      ![0, 1, 2, 3, 4, 5].includes(task.priority) ||
      !Array.isArray(task.tags) ||
      !task.tags.every((t) => typeof t === "string" && t.length < 100) ||
      !Array.isArray(task.subtasks) ||
      !task.subtasks.every(
        (s) =>
          typeof s.id === "string" &&
          typeof s.title === "string" &&
          typeof s.done === "boolean",
      )
    )
      throw new Error("Некорректные данные задачи.");
    if (
      task.due_date !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(task.due_date) ||
        dateKey(parseDate(task.due_date)) !== task.due_date)
    )
      throw new Error("Некорректная дата.");
    if (
      task.start_time !== null &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.start_time)
    )
      throw new Error("Некорректное время.");
    if (
      !Number.isFinite(Date.parse(task.created_at)) ||
      (task.completed_at !== null &&
        !Number.isFinite(Date.parse(task.completed_at)))
    )
      throw new Error("Некорректная дата выполнения.");
    taskIds.add(task.id);
  }
  for (const task of data.tasks) {
    if (
      task.goal_id &&
      !data.tasks.some((g) => g.id === task.goal_id && g.is_milestone)
    )
      throw new Error("Связанный майлстоун не найден.");
  }
  return structuredClone(data);
}
export interface PositionedTask {
  task: Task;
  top: number;
  height: number;
  left: number;
  width: number;
}
export function positionEvents(tasks: Task[]): PositionedTask[] {
  const minutes = (t: Task) => {
    const [h, m] = (t.start_time || "00:00").split(":").map(Number);
    return h * 60 + m;
  };
  const sorted = [...tasks].sort(
    (a, b) => minutes(a) - minutes(b) || b.duration - a.duration,
  );
  const output: PositionedTask[] = [];
  let group: { task: Task; col: number }[] = [],
    ends: number[] = [],
    groupEnd = -1;
  const flush = () => {
    for (const e of group)
      output.push({
        task: e.task,
        top: (minutes(e.task) / 60) * 64,
        height: (Math.min(e.task.duration, 1440 - minutes(e.task)) / 60) * 64,
        left: (e.col / ends.length) * 100,
        width: 100 / ends.length,
      });
    group = [];
    ends = [];
  };
  for (const task of sorted) {
    const start = minutes(task);
    if (start >= groupEnd) flush();
    let col = ends.findIndex((end) => end <= start);
    if (col < 0) col = ends.length;
    ends[col] = start + task.duration;
    groupEnd = Math.max(...ends);
    group.push({ task, col });
  }
  flush();
  return output;
}
