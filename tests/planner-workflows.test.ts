import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTask } from "../src/app/models";
import { bulkTask, dayLoad } from "../src/app/planner-workflows";
const base = makeTask("list", "local", "2026-11-15");
test("daily load separates unassigned time, overlaps and milestone deadlines", () => {
  const tasks = [
    { ...base, start_time: "09:00", duration: 90 },
    { ...base, id: "b", start_time: "10:00", duration: 60 },
    { ...base, id: "c", duration: 45 },
    { ...base, id: "d", is_milestone: true, duration: 1000 },
  ];
  assert.deepEqual(dayLoad(tasks, "2026-11-15"), {
    total: 195,
    unscheduled: 45,
    overlap: 30,
    count: 3,
  });
});
test("bulk patches remove time with date, preserve metadata and reject invalid input", () => {
  const task = {
    ...base,
    start_time: "10:00",
    recurrence: "daily" as const,
    tags: ["work"],
  };
  const undated = bulkTask(task, { due_date: null });
  assert.equal(undated.start_time, null);
  assert.equal(undated.recurrence, "none");
  assert.deepEqual(bulkTask(task, { tag: "#work" }).tags, ["work"]);
  assert.deepEqual(bulkTask(task, { tag: "focus" }).tags, ["work", "focus"]);
  assert.throws(() => bulkTask(task, { due_date: "2026-02-30" }), /дату/);
  assert.throws(() => bulkTask(task, { tag: "a,b" }), /тег/);
  assert.equal(bulkTask(task, { status: "done" }).status, "done");
  assert.ok(bulkTask(task, { status: "done" }).completed_at);
  assert.equal(
    bulkTask({ ...task, status: "done", completed_at: "x" }, { status: "todo" })
      .completed_at,
    null,
  );
});
