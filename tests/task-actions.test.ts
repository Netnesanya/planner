import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTask } from "../src/app/models";
import { saveRecurringTask, expandRecurrences } from "../src/app/recurrence";
import { saveWithScope, skipOccurrence } from "../src/app/recurrence-actions";
import { taskChanges, reverseTaskChanges } from "../src/app/task-history";
const today = "2026-11-15";
function series() {
  return saveRecurringTask(
    [],
    {
      ...makeTask("list", "local", today),
      title: "Workout",
      recurrence: "daily",
    },
    today,
  );
}
test("one-off edit of first occurrence does not change future template", () => {
  const tasks = series();
  const next = saveWithScope(
    tasks,
    { ...tasks[0], title: "Only today", duration: 90 },
    "one",
    today,
  );
  assert.equal(next.length, 84);
  assert.equal(next.find((t) => t.id === tasks[0].id)?.title, "Only today");
  const expanded = expandRecurrences(next, "2026-11-16");
  assert.equal(expanded.length, 85);
  assert.equal(expanded.at(-1)?.title, "Workout");
  assert.notEqual(expanded.at(-1)?.duration, 90);
});
test("skip first day keeps series alive and undo restores all affected records", () => {
  const tasks = series(),
    skipped = skipOccurrence(tasks, tasks[0]);
  assert.equal(skipped.length, 83);
  assert.equal(expandRecurrences(skipped, "2026-11-16").length, 84);
  assert.deepEqual(
    reverseTaskChanges(skipped, taskChanges(tasks, skipped)).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    tasks.sort((a, b) => a.id.localeCompare(b.id)),
  );
});
test("future edits split template while retaining completed tasks, overrides and skips", () => {
  let tasks = series();
  tasks[10] = {
    ...tasks[10],
    status: "done",
    completed_at: new Date().toISOString(),
  };
  tasks[11] = { ...tasks[11], title: "Override", series_modified: true };
  const removedDate = tasks[12].series_date;
  tasks = skipOccurrence(tasks, tasks[12]);
  const next = saveWithScope(
    tasks,
    { ...tasks[7], title: "New workout", duration: 90 },
    "future",
    today,
  );
  assert.equal(next.length, 83);
  assert.equal(next.find((t) => t.id === tasks[0].id)?.title, "Workout");
  assert.equal(next.find((t) => t.id === tasks[10].id)?.status, "done");
  assert.equal(next.find((t) => t.id === tasks[11].id)?.title, "Override");
  assert.ok(!next.some((t) => t.series_date === removedDate));
  assert.equal(
    expandRecurrences(next, "2026-11-16").at(-1)?.title,
    "New workout",
  );
});
test("monthly first-day skip retains month-end anchor", () => {
  const tasks = saveRecurringTask(
    [],
    {
      ...makeTask("list", "local", "2026-01-31"),
      recurrence: "monthly",
      repeat_anchor: 31,
    },
    "2026-01-31",
  );
  const next = expandRecurrences(skipOccurrence(tasks, tasks[0]), "2026-02-28");
  assert.ok(next.some((t) => t.due_date === "2026-03-31"));
  assert.ok(next.some((t) => t.due_date === "2026-04-30"));
});
test("undo preserves unrelated changes and rejects edits to affected tasks", () => {
  const tasks = series(),
    next = tasks.map((t, i) => (i === 1 ? { ...t, duration: 90 } : t));
  const changes = taskChanges(tasks, next);
  const unrelated = next.map((t, i) =>
    i === 2 ? { ...t, title: "Other tab" } : t,
  );
  const restored = reverseTaskChanges(unrelated, changes);
  assert.equal(restored[1].duration, tasks[1].duration);
  assert.equal(restored[2].title, "Other tab");
  assert.throws(
    () =>
      reverseTaskChanges(
        next.map((t, i) => (i === 1 ? { ...t, title: "Conflict" } : t)),
        changes,
      ),
    /уже изменилась/,
  );
});

test("saving an unchanged first occurrence leaves the series identity intact", () => {
  const tasks = series();
  assert.deepEqual(saveWithScope(tasks, { ...tasks[0] }, "one", today), tasks);
});
