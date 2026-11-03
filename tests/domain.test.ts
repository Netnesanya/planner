import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  completionStats,
  dateKey,
  makeTask,
  nextDate,
  positionEvents,
  transitionTask,
  validateData,
  weekStart,
} from "../src/app/models";
import { createDemo } from "../src/app/demo";

test("monthly recurrence retains the original day across February and leap years", () => {
  assert.equal(nextDate("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextDate("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextDate("2028-01-31", "monthly", 31), "2028-02-29");
  assert.equal(nextDate("2026-12-31", "monthly", 31), "2027-01-31");
});
test("weekday and weekly rules handle weekends and calendar boundaries", () => {
  assert.equal(nextDate("2026-11-06", "weekdays"), "2026-11-09");
  assert.equal(nextDate("2026-11-07", "weekdays"), "2026-11-09");
  assert.equal(nextDate("2026-12-28", "weekly"), "2027-01-04");
  assert.equal(weekStart("2026-11-08"), "2026-11-02");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
});
test("completion preserves history and creates exactly one repeat even after undo", () => {
  const task = {
    ...makeTask("list"),
    title: "Daily",
    due_date: "2026-11-03",
    recurrence: "daily" as const,
    subtasks: [{ id: "a", title: "Part", done: true }],
  };
  const completed = transitionTask(
    [task],
    task.id,
    "done",
    new Date("2026-11-03T12:00:00Z"),
  );
  assert.equal(completed.length, 2);
  assert.equal(completed[0].status, "done");
  assert.equal(completed[0].due_date, "2026-11-03");
  assert.equal(completed[1].due_date, "2026-11-04");
  assert.equal(completed[1].subtasks[0].done, false);
  assert.equal(completed[1].source_task_id, task.id);
  assert.equal(transitionTask(completed, task.id, "done").length, 2);
  assert.equal(
    transitionTask(transitionTask(completed, task.id, "todo"), task.id, "done")
      .length,
    2,
  );
});
test("completion rate uses completion dates and planned pending tasks, excludes unscheduled and future tasks", () => {
  const base = makeTask("list");
  const tasks = [
    {
      ...base,
      id: "a",
      status: "done" as const,
      completed_at: "2026-11-03T12:00:00Z",
      due_date: "2026-10-01",
      duration: 90,
    },
    { ...base, id: "b", due_date: "2026-11-03" },
    { ...base, id: "c", due_date: null },
    { ...base, id: "d", due_date: "2026-11-04" },
  ];
  const stats = completionStats(tasks, "2026-11-03", "2026-11-03");
  assert.equal(stats.rate, 50);
  assert.equal(stats.completed.length, 1);
  assert.equal(stats.pending.length, 1);
  assert.equal(stats.minutes, 90);
  assert.equal(completionStats([], "2026-11-03", "2026-11-03").rate, 0);
});
test("overlapping calendar events have distinct columns; adjacent events reuse space", () => {
  const base = makeTask("list");
  const events = positionEvents([
    { ...base, id: "a", start_time: "10:00", duration: 90 },
    { ...base, id: "b", start_time: "10:30", duration: 30 },
    { ...base, id: "c", start_time: "11:30", duration: 30 },
  ]);
  assert.equal(events[0].width, 50);
  assert.equal(events[1].left, 50);
  assert.equal(events[2].width, 100);
  assert.equal(events[0].top, 640);
  assert.equal(events[0].height, 96);
  assert.equal(
    positionEvents([{ ...base, start_time: "23:30", duration: 120 }])[0].height,
    32,
  );
});
test("backup validation accepts generated data and rejects broken references, duplicate IDs and invalid dates", () => {
  const demo = createDemo();
  assert.equal(validateData(demo).tasks.length, demo.tasks.length);
  assert.throws(() =>
    validateData({
      ...demo,
      tasks: [{ ...demo.tasks[0], list_id: "missing" }],
    }),
  );
  assert.throws(() =>
    validateData({ ...demo, tasks: [demo.tasks[0], demo.tasks[0]] }),
  );
  assert.throws(() =>
    validateData({
      ...demo,
      tasks: [{ ...demo.tasks[0], due_date: "2026-02-31" }],
    }),
  );
  assert.throws(() =>
    validateData({ ...demo, tasks: [{ ...demo.tasks[0], duration: -5 }] }),
  );
  assert.throws(() =>
    validateData({ ...demo, tasks: [{ ...demo.tasks[0], tags: "bad" }] }),
  );
  assert.equal(dateKey(new Date(2026, 10, 3, 0, 30)), "2026-11-03");
});

test("duration text accepts hours, minutes and H:MM and rejects invalid values", async () => {
  const { parseDuration, priorityOpacity } = await import("../src/app/models");
  for (const text of ["90", "1:30", "1ч 30м", "1 ч 30 мин", "1.5h", "1,5 ч"])
    assert.equal(parseDuration(text), 90, text);
  assert.equal(parseDuration("24h"), 1440);
  for (const text of ["", "0", "4", "1:99", "25h", "abc", "-30"])
    assert.equal(parseDuration(text), null, text);
  assert.equal(priorityOpacity(0), 0.025);
  assert.equal(priorityOpacity(5), 1);
  for (let p = 1; p <= 5; p++)
    assert.ok(
      priorityOpacity(p as 1 | 2 | 3 | 4 | 5) >
        priorityOpacity((p - 1) as 0 | 1 | 2 | 3 | 4),
    );
});

test("task completion ratio preserves actual values and resets only the next recurrence", async () => {
  const { taskProgress, validProgress } = await import("../src/app/models");
  const goal = {
    ...makeTask("list"),
    title: "Save money",
    due_date: "2026-11-03",
    recurrence: "monthly" as const,
    progress_mode: "target" as const,
    progress_value: 3500,
    progress_target: 5000,
    progress_unit: "$",
  };
  assert.equal(taskProgress(goal), 70);
  assert.equal(validProgress(goal), true);
  const result = transitionTask([goal], goal.id, "done");
  assert.equal(result[0].progress_value, 3500);
  assert.equal(result[1].progress_value, 0);
  assert.equal(result[1].progress_target, 5000);
  assert.equal(taskProgress({ ...goal, progress_value: 6000 }), 100);
  assert.equal(validProgress({ ...goal, progress_target: 0 }), false);
  assert.equal(
    validProgress({ ...goal, progress_mode: "manual", progress_value: 101 }),
    false,
  );
});
