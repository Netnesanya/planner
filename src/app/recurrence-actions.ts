import { taskChanges } from "./task-history";
import { addDays, dateKey, nextDate, Task } from "./models";
import {
  deleteRecurringTask,
  expandRecurrences,
  saveRecurringTask,
} from "./recurrence";
export type RecurrenceScope = "one" | "future";

/** Move the template to an untouched future day before detaching the first occurrence. */
function detachRoot(input: Task[], root: Task, owner: string): Task[] {
  if (
    root.series_id !== root.id ||
    root.recurrence === "none" ||
    !root.series_date
  )
    return input;
  const occupied = input.filter(
    (t) => t.series_id === root.id && t.id !== root.id,
  );
  let due = nextDate(
    root.series_date,
    root.recurrence,
    root.repeat_anchor || Number(root.series_date.slice(8)),
  );
  let candidate: Task | undefined;
  for (let step = 0; step < 100000; step++) {
    if (root.series_until && due > root.series_until) return input;
    candidate = occupied.find((t) => t.series_date === due);
    if (
      !root.series_skips?.includes(due) &&
      (!candidate ||
        (candidate.status === "todo" && !candidate.series_modified))
    )
      break;
    due = nextDate(
      due,
      root.recurrence,
      root.repeat_anchor || Number(root.series_date.slice(8)),
    );
  }
  const id = candidate?.id || crypto.randomUUID();
  const template: Task = {
    ...root,
    id,
    created_by: candidate?.created_by || owner,
    created_at: candidate?.created_at || new Date().toISOString(),
    repeat_anchor: root.repeat_anchor || Number(root.series_date.slice(8)),
    due_date: due,
    series_date: due,
    series_id: id,
    series_modified: false,
    source_task_id: null,
    calendar_uid: null,
    calendar_recurrence_id: null,
    status: "todo",
    completed_at: null,
    progress_value: 0,
    subtasks: root.subtasks.map((s) => ({ ...s, done: false })),
  };
  return [
    ...input
      .filter((t) => t.id !== id)
      .map((t) =>
        t.series_id === root.id && t.id !== root.id
          ? { ...t, series_id: id }
          : t,
      ),
    template,
  ];
}
export function saveWithScope(
  input: Task[],
  saved: Task,
  scope: RecurrenceScope,
  today = dateKey(),
  owner = "local",
): Task[] {
  const before = input.find((t) => t.id === saved.id);
  if (!before?.series_id) return saveRecurringTask(input, saved, today, owner);
  if (!taskChanges([before], [saved]).length) return input;
  const root = input.find((t) => t.id === before.series_id);
  if (scope === "one") {
    let tasks = input;
    let task = {
      ...saved,
      recurrence:
        saved.is_milestone || !saved.due_date ? "none" : before.recurrence,
    };
    if (root?.id === before.id) {
      tasks = detachRoot(tasks, root, owner);
      task = {
        ...task,
        recurrence: "none",
        series_id: null,
        series_date: null,
        series_until: null,
        series_skips: [],
      };
    }
    // An isolated undated occurrence still occupies its original place in the series.
    tasks = tasks.map((t) =>
      t.id === task.id ? { ...task, series_modified: true } : t,
    );
    return expandRecurrences(tasks, today, owner);
  }
  const cutoff = before.series_date || before.due_date || today;
  if (cutoff < today)
    throw new Error(
      "Будущую серию меняйте начиная с сегодняшней или будущей задачи.",
    );
  if (!saved.due_date && saved.recurrence !== "none")
    throw new Error("Для повторения укажите дату.");
  const retained = input.filter(
    (t) =>
      t.id !== saved.id &&
      (t.series_id !== before.series_id ||
        (t.series_date || "") < cutoff ||
        t.status !== "todo" ||
        t.series_modified),
  );
  const skips = [
    ...new Set([
      ...(root?.series_skips || []),
      ...retained
        .filter(
          (t) =>
            t.series_id === before.series_id && (t.series_date || "") >= cutoff,
        )
        .map((t) => t.series_date!),
    ]),
  ];
  const tasks = retained.map((t) =>
    t.id === root?.id ? { ...t, series_until: addDays(cutoff, -1) } : t,
  );
  tasks.push({
    ...saved,
    series_id: saved.recurrence === "none" ? null : saved.id,
    series_date: saved.due_date,
    series_until: root?.series_until || null,
    series_skips: skips,
    series_modified: false,
  });
  const ids = new Set(tasks.map((t) => t.id));
  return expandRecurrences(
    tasks.map((t) =>
      t.source_task_id && !ids.has(t.source_task_id)
        ? { ...t, source_task_id: null }
        : t,
    ),
    today,
    owner,
  );
}
export function skipOccurrence(
  input: Task[],
  task: Task,
  owner = "local",
): Task[] {
  return deleteRecurringTask(detachRoot(input, task, owner), task);
}
