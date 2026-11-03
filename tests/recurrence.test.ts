import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTask, transitionTask } from "../src/app/models";
import {
  expandRecurrences,
  saveRecurringTask,
  deleteRecurringTask,
  recurrenceDelta,
} from "../src/app/recurrence";
const today = "2026-11-03";
const root = {
  ...makeTask("list", "local", today),
  title: "Без времени каждый день",
  recurrence: "daily" as const,
};
test("daily all-day recurrence fills exactly twelve weeks immediately and is idempotent", () => {
  const tasks = saveRecurringTask([], root, today);
  assert.equal(tasks.length, 84);
  assert.equal(tasks[83].due_date, "2027-01-25");
  assert.ok(tasks.every((t) => t.start_time === null));
  assert.equal(
    recurrenceDelta(tasks, expandRecurrences(tasks, today)).saved.length,
    0,
  );
  const done = transitionTask(tasks, root.id, "done");
  assert.equal(done.length, 84);
  assert.equal(transitionTask(done, root.id, "todo").length, 84);
  assert.equal(expandRecurrences(done, "2026-11-04").length, 85);
});
test("a rescheduled occurrence and a deleted day do not regenerate at their original dates", () => {
  let tasks = saveRecurringTask([], root, today);
  const original = tasks[1];
  tasks = saveRecurringTask(
    tasks,
    { ...original, due_date: "2026-11-06" },
    today,
  );
  assert.equal(tasks.length, 84);
  assert.equal(
    tasks.find((t) => t.id === original.id)?.series_date,
    "2026-11-04",
  );
  tasks = deleteRecurringTask(tasks, tasks[2]);
  assert.equal(expandRecurrences(tasks, today).length, 83);
  const movedRoot = saveRecurringTask(
    tasks,
    { ...tasks[0], due_date: "2026-11-10" },
    today,
  );
  assert.equal(movedRoot.length, 83);
});
test("stopping recurrence removes only untouched future occurrences, preserving history and exceptions", () => {
  let tasks = saveRecurringTask([], root, today);
  tasks = transitionTask(tasks, tasks[2].id, "done");
  tasks = saveRecurringTask(
    tasks,
    { ...tasks[3], title: "Отдельно изменена" },
    today,
  );
  const stopped = saveRecurringTask(
    tasks,
    { ...tasks[0], recurrence: "none" },
    today,
  );
  assert.equal(stopped.length, 3);
  assert.ok(stopped.some((t) => t.status === "done"));
  assert.ok(stopped.some((t) => t.title === "Отдельно изменена"));
  assert.equal(expandRecurrences(stopped, today).length, 3);
});
test("editing a later rule splits the series, preserving previous planned days", () => {
  const tasks = saveRecurringTask([], root, today);
  const weekly = saveRecurringTask(
    tasks,
    { ...tasks[7], recurrence: "weekly" },
    today,
  );
  assert.equal(weekly.filter((t) => t.due_date! < "2026-11-10").length, 7);
  assert.equal(weekly.filter((t) => t.due_date! >= "2026-11-10").length, 11);
  assert.equal(expandRecurrences(weekly, today).length, weekly.length);
});
test("monthly dates keep their anchor and old completion-created chains are migrated", () => {
  const monthly = saveRecurringTask(
    [],
    {
      ...root,
      due_date: "2026-01-31",
      recurrence: "monthly",
      repeat_anchor: 31,
    },
    "2026-01-31",
  );
  assert.deepEqual(
    monthly.map((t) => t.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  const legacy = transitionTask(
    [root],
    root.id,
    "done",
    new Date(today + "T12:00:00"),
  );
  const migrated = expandRecurrences(legacy, today);
  assert.equal(migrated.length, 84);
  assert.equal(new Set(migrated.map((t) => t.series_date)).size, 84);
});
