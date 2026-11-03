import { addDays, dateKey, nextDate, Task } from "./models";

/** Calendar occurrences are real tasks: future plans and missed days stay visible. */
export function expandRecurrences(
  input: Task[],
  today = dateKey(),
  owner = "local",
): Task[] {
  const tasks = input.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Upgrade the former completion-created chains without duplicating existing days.
  for (const task of tasks) {
    if (
      task.recurrence === "none" ||
      task.is_milestone ||
      !task.due_date ||
      task.series_id
    )
      continue;
    let root = task;
    const visited = new Set<string>();
    while (root.source_task_id && !visited.has(root.id)) {
      visited.add(root.id);
      const parent = byId.get(root.source_task_id);
      if (!parent || parent.recurrence !== task.recurrence) break;
      root = parent;
    }
    task.series_id = root.series_id || root.id;
    task.series_date = task.due_date;
  }
  const horizon = addDays(today, 83);
  for (const root of [...tasks]) {
    if (
      root.series_id !== root.id ||
      root.recurrence === "none" ||
      !root.due_date ||
      root.is_milestone
    )
      continue;
    const end =
      root.series_until && root.series_until < horizon
        ? root.series_until
        : horizon;
    const present = new Set(
      tasks.filter((t) => t.series_id === root.id).map((t) => t.series_date),
    );
    const origin = root.series_date || root.due_date;
    const anchor = Number(origin.slice(8));
    let due = nextDate(origin, root.recurrence, anchor);
    // Bound traversal of imported historical plans, then generate at most 84 days.
    let steps = 0;
    while (due <= end && steps++ < 100000) {
      if (
        due >= today &&
        !present.has(due) &&
        !root.series_skips?.includes(due)
      ) {
        tasks.push({
          ...root,
          id: crypto.randomUUID(),
          created_by: owner,
          due_date: due,
          status: "todo",
          completed_at: null,
          created_at: new Date().toISOString(),
          source_task_id: null,
          series_id: root.id,
          series_date: due,
          series_modified: false,
          series_until: null,
          series_skips: [],
          progress_value: 0,
          subtasks: root.subtasks.map((s) => ({ ...s, done: false })),
        });
        present.add(due);
      }
      due = nextDate(due, root.recurrence, anchor);
    }
  }
  return tasks;
}
export function saveRecurringTask(
  input: Task[],
  saved: Task,
  today = dateKey(),
  owner = "local",
): Task[] {
  const before = input.find((t) => t.id === saved.id);
  let tasks = input.map((t) => ({ ...t }));
  let task = { ...saved };
  const isRoot = !before?.series_id || before.series_id === before.id;
  const ruleChanged = before && before.recurrence !== task.recurrence;
  if (ruleChanged && before.series_id) {
    const rootId = before.series_id;
    const origin = before.series_date || before.due_date || today;
    const cutoff = origin > today ? origin : today;
    tasks = tasks.filter(
      (t) =>
        t.id === task.id ||
        t.series_id !== rootId ||
        t.status === "done" ||
        t.series_modified ||
        (t.series_date || "") < cutoff,
    );
    if (!isRoot)
      tasks = tasks.map((t) =>
        t.id === rootId ? { ...t, series_until: addDays(cutoff, -1) } : t,
      );
    task = {
      ...task,
      series_id: task.id,
      series_date: task.due_date,
      series_until: null,
      series_skips: !isRoot
        ? tasks
            .filter(
              (t) =>
                t.series_id === rootId &&
                (t.series_date || "") >= cutoff &&
                t.id !== task.id,
            )
            .map((t) => t.series_date!)
            .filter(Boolean)
        : [],
      series_modified: true,
    };
  } else if (task.recurrence !== "none" && !task.series_id) {
    task = {
      ...task,
      series_id: task.id,
      series_date: task.due_date,
      series_skips: [],
    };
  } else if (task.series_id) task.series_modified = true;
  tasks = tasks.some((t) => t.id === task.id)
    ? tasks.map((t) => (t.id === task.id ? task : t))
    : [...tasks, task];
  // Deleted occurrences may have been the source of retained history/overrides.
  const ids = new Set(tasks.map((t) => t.id));
  tasks = tasks.map((t) =>
    t.source_task_id && !ids.has(t.source_task_id)
      ? { ...t, source_task_id: null }
      : t,
  );
  return expandRecurrences(tasks, today, owner);
}
export function deleteRecurringTask(input: Task[], task: Task): Task[] {
  return input
    .filter((t) => t.id !== task.id)
    .map((t) => ({
      ...t,
      goal_id: t.goal_id === task.id ? null : t.goal_id,
      source_task_id: t.source_task_id === task.id ? null : t.source_task_id,
      series_skips:
        t.id === task.series_id && task.series_date
          ? [...new Set([...(t.series_skips || []), task.series_date])]
          : t.series_skips,
    }));
}
export function recurrenceDelta(before: Task[], after: Task[]) {
  const previous = new Map(before.map((t) => [t.id, t]));
  const ids = new Set(after.map((t) => t.id));
  return {
    saved: after.filter(
      (t) => JSON.stringify(previous.get(t.id)) !== JSON.stringify(t),
    ),
    deleted: before.filter((t) => !ids.has(t.id)).map((t) => t.id),
  };
}
export function normalizeTask(task: Task): Task {
  return {
    ...task,
    sort_order: task.sort_order ?? Date.parse(task.created_at),
    progress_mode: task.progress_mode || "none",
    progress_value: task.progress_value || 0,
    progress_target: task.progress_target || 100,
    progress_unit: task.progress_unit || "",
    is_milestone: !!task.is_milestone,
    milestone_color: task.milestone_color || "#b9efc9",
    goal_id: task.goal_id || null,
    series_id: task.series_id || null,
    series_date: task.series_date || null,
    series_modified: !!task.series_modified,
    series_until: task.series_until || null,
    series_skips: task.series_skips || [],
  };
}
