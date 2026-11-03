import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { TaskViewBase } from "../shared/task-view.base";
import { addDays, completionStats, dateKey } from "../models";
@Component({
  selector: "app-statistics-view",
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: "./statistics-view.component.html",
  styleUrl: "./statistics-view.component.scss",
})
export class StatisticsViewComponent extends TaskViewBase {
  statsPeriod = 7;
  Math = Math;
  completedForList(id: string) {
    return this.stats.completed.filter((t) => t.list_id === id).length;
  }
  get stats() {
    return completionStats(
      this.store.tasks(),
      addDays(this.today, 1 - this.statsPeriod),
      this.today,
    );
  }
  get chartDays() {
    return Array.from({ length: this.statsPeriod }, (_, i) => {
      const date = addDays(this.today, i + 1 - this.statsPeriod);
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
  get chartMax() {
    return Math.max(4, ...this.chartDays.map((d) => d.count));
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
