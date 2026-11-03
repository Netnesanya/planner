import { Component } from "@angular/core";
import { IconComponent } from "../icon.component";
import { TaskCardComponent } from "../task-card.component";
import { TaskViewBase } from "../shared/task-view.base";
import { addDays, completionStats, Task } from "../models";
@Component({
  selector: "app-list-view",
  standalone: true,
  imports: [IconComponent, TaskCardComponent],
  templateUrl: "./list-view.component.html",
  styleUrl: "./list-view.component.scss",
})
export class ListViewComponent extends TaskViewBase {
  dropTarget: string | null = null;
  async reorder(event: DragEvent, before: Task) {
    event.preventDefault();
    event.stopPropagation();
    this.dropTarget = null;
    const id = event.dataTransfer?.getData("text/plain");
    if (!id || id === before.id) return;
    const visible = this.pending.filter((t) => t.id !== id).map((t) => t.id);
    if (!this.pending.some((t) => t.id === id)) return;
    const moving = this.pending.find((t) => t.id === id)!;
    if (moving.due_date !== before.due_date) {
      const saved = await this.store.saveTask({
        ...moving,
        due_date: before.due_date,
        start_time: before.due_date ? moving.start_time : null,
        repeat_anchor: before.due_date
          ? Number(before.due_date.slice(8))
          : null,
      });
      if (!saved) return;
    }
    visible.splice(visible.indexOf(before.id), 0, id);
    await this.store.reorderTasks(visible);
  }
  sumDuration = (sum: number, task: Task) =>
    sum + (task.is_milestone ? 0 : task.duration);
  get groups() {
    const groups = new Map<string, Task[]>();
    for (const task of this.pending) {
      const key =
        task.due_date && task.due_date < this.today
          ? "Просрочено"
          : task.due_date === this.today
            ? "Сегодня"
            : task.due_date === addDays(this.today, 1)
              ? "Завтра"
              : task.due_date
                ? this.dateLabel(task.due_date)
                : "Без даты";
      groups.set(key, [...(groups.get(key) || []), task]);
    }
    return [...groups].map(([name, tasks]) => ({ name, tasks }));
  }
  get todayStats() {
    return completionStats(this.store.tasks(), this.today, this.today);
  }
  get todayTasks() {
    return this.store
      .tasks()
      .filter((t) => !t.is_milestone && t.due_date === this.today);
  }
  get todayScheduled() {
    return this.todayTasks
      .filter((t) => !!t.start_time)
      .sort((a, b) => a.start_time!.localeCompare(b.start_time!));
  }
  get plannedMinutes() {
    return this.todayTasks.reduce((sum, t) => sum + t.duration, 0);
  }
}
