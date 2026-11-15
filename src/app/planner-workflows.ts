import { Task } from "./models";
export function dayLoad(tasks: Task[], date: string) {
  const rows = tasks.filter((t) => !t.is_milestone && t.due_date === date);
  const spans = rows
    .filter((t) => t.start_time)
    .map((t) => {
      const [h, m] = t.start_time!.split(":").map(Number);
      return [h * 60 + m, Math.min(1440, h * 60 + m + t.duration)];
    })
    .sort((a, b) => a[0] - b[0]);
  let end = 0,
    occupied = 0,
    scheduled = 0;
  for (const [start, stop] of spans) {
    scheduled += stop - start;
    occupied += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return {
    total: rows.reduce((n, t) => n + t.duration, 0),
    unscheduled: rows
      .filter((t) => !t.start_time)
      .reduce((n, t) => n + t.duration, 0),
    overlap: scheduled - occupied,
    count: rows.length,
  };
}
export interface BulkPatch {
  due_date?: string | null;
  list_id?: string;
  tag?: string;
  status?: "todo" | "doing" | "done";
}
export function bulkTask(task: Task, patch: BulkPatch): Task {
  const next = { ...task };
  if ("due_date" in patch) {
    if (
      patch.due_date !== null &&
      (!patch.due_date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_date) ||
        !Number.isFinite(Date.parse(patch.due_date + "T12:00:00Z")) ||
        new Date(patch.due_date + "T12:00:00Z").toISOString().slice(0, 10) !==
          patch.due_date)
    )
      throw new Error("Укажите корректную дату.");
    next.due_date = patch.due_date!;
    if (!next.due_date) {
      next.start_time = null;
      next.recurrence = "none";
    }
    next.repeat_anchor = next.due_date ? Number(next.due_date.slice(8)) : null;
  }
  if (patch.list_id) next.list_id = patch.list_id;
  if (patch.tag !== undefined) {
    const tag = patch.tag.trim().replace(/^#+/, "");
    if (!tag || tag.length > 50 || tag.includes(","))
      throw new Error("Укажите один тег длиной до 50 символов.");
    next.tags = [...new Set([...next.tags, tag])];
  }
  if (patch.status && patch.status !== task.status) {
    next.status = patch.status;
    next.completed_at =
      patch.status === "done" ? new Date().toISOString() : null;
  }
  return next;
}
