import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTask, transitionTask, validateData } from "../src/app/models";
import {
  cycleEnd,
  cycleWeek,
  dayDistance,
  newCycle,
  planActions,
  validCycle,
  weekScore,
} from "../src/app/planning";
const goal = {
  ...makeTask("list"),
  title: "Пожать свой вес",
  is_milestone: true,
  due_date: "2027-01-01",
};
const cycle = { ...newCycle(), start_date: "2026-11-02", goal_ids: [goal.id] };
test("12-week horizon crosses year and DST boundaries as calendar days", () => {
  assert.equal(cycleEnd(cycle), "2027-01-24");
  assert.equal(cycleWeek(cycle, "2026-11-08"), 0);
  assert.equal(cycleWeek(cycle, "2026-11-09"), 1);
  assert.equal(cycleWeek(cycle, "2027-02-01"), 11);
  assert.equal(dayDistance("2026-10-19", "2026-10-26"), 7);
  assert.equal(validCycle(cycle), true);
  assert.equal(validCycle({ ...cycle, start_date: "2026-02-31" }), false);
});
test("all planned sessions exist before completion, including missed sessions", () => {
  const tasks = planActions(cycle, goal, "Тренировка", [0, 2, 4], 1, 12, 90);
  assert.equal(tasks.length, 36);
  assert.equal(tasks[0].due_date, "2026-11-02");
  assert.equal(tasks[35].due_date, "2027-01-22");
  assert.ok(
    tasks.every(
      (t) =>
        t.goal_id === goal.id && t.recurrence === "none" && t.duration === 90,
    ),
  );
  const after = transitionTask(tasks, tasks[0].id, "done");
  const stats = weekScore(
    [
      ...after,
      goal,
      { ...makeTask("list"), due_date: "2026-11-02", status: "done" },
    ],
    cycle,
    0,
  );
  assert.equal(stats.total, 3);
  assert.equal(stats.done, 1);
  assert.equal(stats.ratio, 33);
  assert.equal(after.length, 36);
  assert.equal(weekScore(after, cycle, 11).total, 3);
  assert.equal(weekScore([], cycle, 0).ratio, null);
});
test("arbitrary start date and partial week ranges produce exact day selections", () => {
  const tasks = planActions(
    { ...cycle, start_date: "2026-11-04" },
    goal,
    "Шаг",
    [0],
    2,
    3,
    45,
  );
  assert.deepEqual(
    tasks.map((t) => t.due_date),
    ["2026-11-16", "2026-11-23"],
  );
  assert.throws(() => planActions(cycle, goal, "Шаг", [], 1, 12, 45));
  assert.throws(() => planActions(cycle, goal, "Шаг", [0], 1.5, 12, 45));
});
test("goal references survive recurrence and invalid backup links are rejected", () => {
  const action = {
    ...makeTask("list", "local", "2026-11-02"),
    title: "Действие",
    goal_id: goal.id,
    recurrence: "weekly" as const,
  };
  const tasks = transitionTask([goal, action], action.id, "done");
  assert.equal(tasks[2].goal_id, goal.id);
  const data = {
    version: 1,
    lists: [
      { id: "list", name: "Здоровье", color: "#b9efc9", owner_id: "local" },
    ],
    tasks,
  };
  assert.doesNotThrow(() => validateData(data));
  assert.throws(() => validateData({ ...data, tasks: [action] }));
  assert.throws(() =>
    validateData({ ...data, tasks: [{ ...goal, recurrence: "daily" }] }),
  );
});
