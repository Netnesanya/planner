import { Task } from "./models";
import { normalizeTask } from "./recurrence";
export interface TaskChange {
  id: string;
  before: Task | null;
  after: Task | null;
}
export interface TaskUndo {
  label: string;
  changes: TaskChange[];
  account: string;
}
const equal = (a: Task | null, b: Task | null) => {
  if (!a || !b) return a === b;
  const x = normalizeTask(a),
    y = normalizeTask(b);
  return Object.keys(x).every(
    (key) =>
      JSON.stringify(x[key as keyof Task]) ===
      JSON.stringify(y[key as keyof Task]),
  );
};
export function taskChanges(before: Task[], after: Task[]): TaskChange[] {
  const a = new Map(before.map((t) => [t.id, t])),
    b = new Map(after.map((t) => [t.id, t]));
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((id) => {
    const previous = a.get(id) || null,
      next = b.get(id) || null;
    return equal(previous, next)
      ? []
      : [
          {
            id,
            before: structuredClone(previous),
            after: structuredClone(next),
          },
        ];
  });
}
export function reverseTaskChanges(
  current: Task[],
  changes: TaskChange[],
): Task[] {
  const rows = new Map(current.map((t) => [t.id, t]));
  for (const change of changes) {
    if (!equal(rows.get(change.id) || null, change.after))
      throw new Error(
        "Задача уже изменилась. Отмена не применена; обновите данные.",
      );
  }
  for (const change of changes) {
    if (change.before) rows.set(change.id, structuredClone(change.before));
    else rows.delete(change.id);
  }
  return [...rows.values()];
}
