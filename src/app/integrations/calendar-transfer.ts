import { addDays, makeTask, Task } from "../models";
import { validateRange, wallInstant } from "./calendar-time";
export interface CalendarRange {
  from: string;
  to: string;
  zone: string;
}
export interface CalendarEntry {
  uid: string;
  recurrenceId: string;
  title: string;
  notes: string;
  date: string;
  time: string | null;
  duration: number;
}
export interface CalendarIssue {
  title: string;
  reason: string;
}
export interface CalendarPreview {
  entries: CalendarEntry[];
  issues: CalendarIssue[];
  outside: number;
}
export interface ImportRow {
  key: string;
  entry: CalendarEntry;
  kind: "new" | "update" | "same";
  selected: boolean;
  existingId?: string;
  before?: string;
}
export const MAX_CALENDAR_BYTES = 2 * 1024 * 1024;
export const MAX_CALENDAR_EVENTS = 2000;
export const entryKey = (e: CalendarEntry) =>
  JSON.stringify([e.uid, e.recurrenceId]);
export const flowUid = (task: Task) => `${task.id}@flow-planner`;
export function taskFingerprint(task: Task) {
  return JSON.stringify(task);
}
export function previewImport(
  entries: CalendarEntry[],
  tasks: Task[],
  listId: string,
): ImportRow[] {
  const inList = tasks.filter((t) => t.list_id === listId);
  return entries.map((entry) => {
    const task = inList.find(
      (t) =>
        (t.calendar_uid === entry.uid &&
          (t.calendar_recurrence_id || "") === entry.recurrenceId) ||
        (!entry.recurrenceId && flowUid(t) === entry.uid),
    );
    const same =
      task &&
      task.title === entry.title &&
      task.notes === entry.notes &&
      task.due_date === entry.date &&
      task.start_time === entry.time &&
      (entry.time === null || task.duration === entry.duration);
    return {
      key: entryKey(entry),
      entry,
      kind: !task ? "new" : same ? "same" : "update",
      selected: !task,
      existingId: task?.id,
      before: task ? taskFingerprint(task) : undefined,
    };
  });
}
export function applyImport(
  rows: ImportRow[],
  tasks: Task[],
  listId: string,
  owner: string,
): Task[] {
  const selected = rows.filter((row) => row.selected && row.kind !== "same");
  if (!selected.length || selected.length > MAX_CALENDAR_EVENTS)
    throw new Error("Выберите от 1 до 2000 событий.");
  if (new Set(selected.map((row) => row.key)).size !== selected.length)
    throw new Error("В файле есть дубликаты событий.");
  const next = [...tasks];
  for (const row of selected) {
    const fresh = previewImport([row.entry], next, listId)[0];
    if (fresh.existingId !== row.existingId || fresh.before !== row.before)
      throw new Error(
        "Задачи изменились после предпросмотра. Обновите предпросмотр перед импортом.",
      );
    const existing = next.find((t) => t.id === row.existingId);
    const entry = row.entry;
    const task: Task = {
      ...(existing || makeTask(listId, owner, entry.date)),
      title: entry.title,
      notes: entry.notes,
      due_date: entry.date,
      start_time: existing?.is_milestone ? null : entry.time,
      duration:
        entry.time === null && existing ? existing.duration : entry.duration,
      calendar_uid: existing?.calendar_uid || entry.uid,
      calendar_recurrence_id: existing?.calendar_uid
        ? existing.calendar_recurrence_id || ""
        : entry.recurrenceId,
      // Imported occurrences are finite. Existing Flow series keep their identity.
      ...(existing?.series_id ? { series_modified: true } : {}),
    };
    if (existing) next[next.indexOf(existing)] = task;
    else next.push(task);
  }
  return next;
}
function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "",
    length = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}
const utc = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
export function exportCalendar(
  tasks: Task[],
  options: CalendarRange & {
    listIds: string[];
    completed: boolean;
    milestones: boolean;
    eventIdentity?: (task: Task) => string;
    eventModified?: (task: Task) => string;
    eventSequence?: (task: Task) => number;
  },
  now = Date.now(),
) {
  validateRange(options.from, options.to, options.zone);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Flow Planner//Calendar Export//RU",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Flow Planner",
  ];
  const issues: CalendarIssue[] = [];
  let count = 0;
  for (const task of tasks) {
    if (
      !options.listIds.includes(task.list_id) ||
      (!options.completed && task.status === "done") ||
      (!options.milestones && task.is_milestone)
    )
      continue;
    if (!task.due_date) {
      issues.push({
        title: task.title,
        reason: "Нет даты — событие не экспортировано.",
      });
      continue;
    }
    if (task.due_date < options.from || task.due_date > options.to) continue;
    try {
      const times: string[] = [];
      if (!task.start_time || task.is_milestone) {
        times.push(
          `DTSTART;VALUE=DATE:${task.due_date.replace(/-/g, "")}`,
          `DTEND;VALUE=DATE:${addDays(task.due_date, 1).replace(/-/g, "")}`,
        );
      } else {
        const start = wallInstant(task.due_date, task.start_time, options.zone);
        times.push(
          `DTSTART:${utc(start)}`,
          `DTEND:${utc(start + task.duration * 60000)}`,
        );
      }
      lines.push(
        "BEGIN:VEVENT",
        `UID:${options.eventIdentity?.(task) || flowUid(task)}`,
        `DTSTAMP:${utc(options.eventModified ? Date.parse(options.eventModified(task)) : now)}`,
        ...(options.eventSequence
          ? [`SEQUENCE:${options.eventSequence(task)}`]
          : []),
        ...times,
        `SUMMARY:${escapeText(task.title)}`,
        `DESCRIPTION:${escapeText(task.notes)}`,
        "END:VEVENT",
      );
      count++;
    } catch (error) {
      issues.push({ title: task.title, reason: (error as Error).message });
    }
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", count, issues };
}
