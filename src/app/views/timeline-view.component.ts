import { Component, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { TaskViewBase } from "../shared/task-view.base";
import { addDays, dateKey, Task, weekStart } from "../models";
import { dayDistance } from "../planning";
@Component({
  selector: "app-timeline-view",
  standalone: true,
  imports: [IconComponent, FormsModule],
  templateUrl: "./timeline-view.component.html",
  styleUrl: "./timeline-view.component.scss",
})
export class TimelineViewComponent extends TaskViewBase {
  @Input() startDate = "";
  @Input() fixedRange = false;
  selectedDate = dateKey();
  get start() {
    return this.startDate || weekStart(this.selectedDate);
  }
  get end() {
    return addDays(this.start, 83);
  }
  get weeks() {
    return Array.from({ length: 12 }, (_, i) => addDays(this.start, i * 7));
  }
  get goals() {
    return this.tasks.filter(
      (t) =>
        t.is_milestone &&
        (this.store.preferences().showCompleted || t.status !== "done"),
    );
  }
  get undated() {
    return this.goals.filter((t) => !t.due_date);
  }
  goalsInWeek(listId: string, week: string) {
    return this.goals
      .filter(
        (t) =>
          t.list_id === listId &&
          t.due_date &&
          t.due_date >= week &&
          t.due_date <= addDays(week, 6),
      )
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  }
  countGoals(listId: string) {
    return this.goals.filter(
      (t) =>
        t.list_id === listId &&
        t.due_date &&
        t.due_date >= this.start &&
        t.due_date <= this.end,
    ).length;
  }
  shiftDate(direction: number) {
    this.selectedDate = addDays(this.selectedDate, direction * 28);
  }
  createGoal(listId: string, due = this.end) {
    this.open.emit({ listId, due, milestone: true });
  }
  result(task: Task) {
    return task.progress_mode === "target"
      ? `${(task.progress_value || 0).toLocaleString("ru-RU")} / ${(task.progress_target || 100).toLocaleString("ru-RU")} ${task.progress_unit || ""}`
      : task.status === "done"
        ? "Достигнута"
        : "Цель";
  }
  async dropGoal(event: DragEvent, listId: string, week: string) {
    event.preventDefault();
    const task = this.store
      .tasks()
      .find((t) => t.id === event.dataTransfer?.getData("text/plain"));
    if (!task?.is_milestone) return;
    const offset = task.due_date
      ? ((dayDistance(this.start, task.due_date) % 7) + 7) % 7
      : 0;
    await this.store.saveTask({
      ...task,
      list_id: listId,
      due_date: addDays(week, offset),
    });
  }
}
