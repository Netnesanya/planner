import { Directive, EventEmitter, inject, Input, Output } from "@angular/core";
import { PlannerService } from "../planner.service";
import {
  dateKey,
  durationLabel,
  parseDate,
  Priority,
  priorityOpacity,
  Status,
  Task,
} from "../models";
export interface TaskOpenRequest {
  task?: Task;
  due?: string;
  time?: string;
  status?: Status;
  listId?: string;
  milestone?: boolean;
  goalId?: string;
  cycleId?: string;
}

/** Shared view contract, not screen state. Each screen owns its layout and controls. */
@Directive()
export abstract class TaskViewBase {
  readonly store = inject(PlannerService);
  @Input() tasks: Task[] = [];
  @Input() scope = "all";
  @Input() search = "";
  @Output() open = new EventEmitter<TaskOpenRequest>();
  @Output() calendar = new EventEmitter<void>();
  get filteredTasks() {
    return this.tasks;
  }
  get pending() {
    return this.tasks.filter((t) => t.status !== "done");
  }
  get completed() {
    return this.tasks
      .filter((t) => t.status === "done")
      .sort((a, b) =>
        (b.completed_at || "").localeCompare(a.completed_at || ""),
      );
  }
  get today() {
    return dateKey();
  }
  duration = durationLabel;
  dateLabel(
    date: string,
    opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
  ) {
    return parseDate(date).toLocaleDateString("ru-RU", opts);
  }
  listById(id: string) {
    return this.store.lists().find((l) => l.id === id);
  }
  openTask(task?: Task, due?: string, time?: string, status?: Status) {
    this.open.emit({ task, due, time, status });
  }
  async toggle(task: Task) {
    await this.store.setStatus(task, task.status === "done" ? "todo" : "done");
  }
  changeShowCompleted() {
    void this.store.savePreferences({
      showCompleted: !this.store.preferences().showCompleted,
    });
  }
  drag(event: DragEvent, task: Task) {
    event.dataTransfer?.setData("text/plain", task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
  allowDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
  async dropStatus(event: DragEvent, status: Status) {
    event.preventDefault();
    const task = this.store
      .tasks()
      .find((t) => t.id === event.dataTransfer?.getData("text/plain"));
    if (task) await this.store.setStatus(task, status);
  }
  async dropDate(event: DragEvent, date: string, hour?: number, minute = 0) {
    event.preventDefault();
    const task = this.store
      .tasks()
      .find((t) => t.id === event.dataTransfer?.getData("text/plain"));
    if (task)
      await this.store.saveTask({
        ...task,
        due_date: date,
        repeat_anchor: Number(date.slice(8)),
        start_time: task.is_milestone
          ? null
          : hour === undefined
            ? task.start_time
            : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      });
  }
  taskColor(task: Task) {
    const goal = this.store.tasks().find((t) => t.id === task.goal_id);
    return (
      (task.is_milestone ? task.milestone_color : goal?.milestone_color) ||
      this.listById(task.list_id)?.color ||
      "#b9efc9"
    );
  }
  eventFill(task: Task) {
    return `color-mix(in srgb, ${this.taskColor(task)} ${priorityOpacity(task.priority) * 100}%, #1b1f25)`;
  }
  eventText(task: Task) {
    return task.priority >= 4 ? "#16201c" : this.taskColor(task);
  }
  async savePriority(task: Task, priority: Priority) {
    await this.store.saveTask({ ...task, priority });
  }
}
