import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { TaskViewBase } from "../shared/task-view.base";
import { addDays, completionStats, dateKey } from "../models";
@Component({
  selector: "app-today-summary",
  standalone: true,
  imports: [IconComponent],
  templateUrl: "./today-summary.component.html",
  styleUrl: "./today-summary.component.scss",
})
export class TodaySummaryComponent extends TaskViewBase {
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
  get heatmap() {
    return Array.from({ length: 84 }, (_, i) => {
      const date = addDays(this.today, i - 83);
      return {
        date,
        count: this.store
          .tasks()
          .filter(
            (t) =>
              !t.is_milestone &&
              t.status === "done" &&
              t.completed_at &&
              dateKey(new Date(t.completed_at)) === date,
          ).length,
      };
    });
  }
  get streak() {
    const completed = new Set(
      this.store
        .tasks()
        .filter((t) => !t.is_milestone && t.status === "done" && t.completed_at)
        .map((t) => dateKey(new Date(t.completed_at!))),
    );
    let cursor = completed.has(this.today)
        ? this.today
        : addDays(this.today, -1),
      count = 0;
    while (completed.has(cursor)) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }
}
