import {
  addDays,
  dateKey,
  makeTask,
  parseDate,
  PlanningCycle,
  Task,
  weekStart,
} from "./models";
export const cycleEnd = (cycle: PlanningCycle) => addDays(cycle.start_date, 83);
export function dayDistance(from: string, to: string) {
  const utc = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86400000);
}
export function cycleWeek(cycle: PlanningCycle, date = dateKey()) {
  return Math.max(
    0,
    Math.min(11, Math.floor(dayDistance(cycle.start_date, date) / 7)),
  );
}
export function newCycle(owner = "local"): PlanningCycle {
  return {
    id: crypto.randomUUID(),
    owner_id: owner,
    name: "Мои 12 недель",
    vision: "",
    start_date: weekStart(dateKey()),
    goal_ids: [],
    reviews: {},
    archived: false,
  };
}
export function weekScore(tasks: Task[], cycle: PlanningCycle, week: number) {
  const from = addDays(cycle.start_date, week * 7),
    to = addDays(from, 6);
  const planned = tasks.filter(
    (t) =>
      !t.is_milestone &&
      !!t.goal_id &&
      cycle.goal_ids.includes(t.goal_id) &&
      !!t.due_date &&
      t.due_date >= from &&
      t.due_date <= to,
  );
  planned.sort(
    (a, b) =>
      a.due_date!.localeCompare(b.due_date!) ||
      (a.start_time || "99").localeCompare(b.start_time || "99"),
  );
  const done = planned.filter((t) => t.status === "done").length;
  return {
    from,
    to,
    tasks: planned,
    done,
    total: planned.length,
    ratio: planned.length ? Math.round((done / planned.length) * 100) : null,
  };
}
/** Materialize every scheduled action up front, so missed sessions stay in the denominator. */
export function planActions(
  cycle: PlanningCycle,
  goal: Task,
  title: string,
  weekdays: number[],
  firstWeek: number,
  lastWeek: number,
  duration: number,
  owner = "local",
): Task[] {
  if (
    !goal.is_milestone ||
    !cycle.goal_ids.includes(goal.id) ||
    !title.trim() ||
    !weekdays.length ||
    weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !Number.isInteger(firstWeek) ||
    !Number.isInteger(lastWeek) ||
    firstWeek < 1 ||
    lastWeek > 12 ||
    firstWeek > lastWeek ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 1440
  )
    throw new Error("Проверьте цель, дни недели и период действий.");
  return Array.from({ length: 84 }, (_, i) => ({
    date: addDays(cycle.start_date, i),
    week: Math.floor(i / 7) + 1,
  }))
    .filter(
      ({ date, week }) =>
        week >= firstWeek &&
        week <= lastWeek &&
        weekdays.includes((parseDate(date).getDay() + 6) % 7),
    )
    .map(({ date }) => ({
      ...makeTask(goal.list_id, owner, date),
      title: title.trim(),
      goal_id: goal.id,
      duration,
    }));
}
export function validCycle(c: PlanningCycle): boolean {
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    c.name.length <= 120 &&
    typeof c.vision === "string" &&
    c.vision.length <= 5000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.start_date) &&
    dateKey(parseDate(c.start_date)) === c.start_date &&
    Array.isArray(c.goal_ids) &&
    c.goal_ids.length <= 100 &&
    c.goal_ids.every((id) => typeof id === "string") &&
    !!c.reviews &&
    typeof c.reviews === "object" &&
    !Array.isArray(c.reviews) &&
    Object.entries(c.reviews).every(
      ([week, review]) =>
        /^(?:[0-9]|1[01])$/.test(week) &&
        !!review &&
        typeof review.wins === "string" &&
        typeof review.improve === "string" &&
        review.wins.length <= 5000 &&
        review.improve.length <= 5000,
    ) &&
    typeof c.archived === "boolean"
  );
}
