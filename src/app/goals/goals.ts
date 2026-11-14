export interface LongGoal {
  id: string;
  title: string;
  why: string;
  next: string;
  priority: number;
  status: "active" | "future" | "paused" | "done";
  progress: number;
  deadline: string;
  created: string;
}
export interface GoalsData {
  version: 1;
  goals: LongGoal[];
}
export const emptyGoals = (): GoalsData => ({ version: 1, goals: [] });
export function validateGoals(data: GoalsData): GoalsData {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.goals) ||
    data.goals.length > 5000 ||
    new Set(data.goals.map((g) => g?.id)).size !== data.goals.length ||
    data.goals.some(
      (g) =>
        !g ||
        typeof g.id !== "string" ||
        !g.id ||
        typeof g.title !== "string" ||
        !g.title.trim() ||
        g.title.length > 200 ||
        typeof g.why !== "string" ||
        g.why.length > 4000 ||
        typeof g.next !== "string" ||
        g.next.length > 1000 ||
        !Number.isInteger(g.priority) ||
        g.priority < 0 ||
        g.priority > 5 ||
        !["active", "future", "paused", "done"].includes(g.status) ||
        !Number.isFinite(g.progress) ||
        g.progress < 0 ||
        g.progress > 100 ||
        typeof g.deadline !== "string" ||
        (g.deadline &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ||
            new Date(g.deadline).toISOString().slice(0, 10) !== g.deadline)) ||
        !Number.isFinite(Date.parse(g.created)),
    )
  )
    throw new Error("Некорректные долгосрочные цели.");
  return data;
}
export function rankedGoals(goals: LongGoal[]) {
  return [...goals].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.created.localeCompare(b.created) ||
      a.id.localeCompare(b.id),
  );
}
export const focusedGoals = (goals: LongGoal[]) =>
  rankedGoals(goals.filter((g) => g.status === "active")).slice(0, 3);
