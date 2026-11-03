import { Component } from "@angular/core";
import { IconComponent } from "../icon.component";
import { TaskCardComponent } from "../task-card.component";
import { TaskViewBase } from "../shared/task-view.base";
import { dateKey, Task } from "../models";
@Component({
  selector: "app-history-view",
  standalone: true,
  imports: [IconComponent, TaskCardComponent],
  templateUrl: "./history-view.component.html",
  styleUrl: "./history-view.component.scss",
})
export class HistoryViewComponent extends TaskViewBase {
  get historyGroups() {
    const map = new Map<string, Task[]>();
    for (const task of this.completed) {
      const key = task.completed_at
        ? dateKey(new Date(task.completed_at))
        : this.today;
      map.set(key, [...(map.get(key) || []), task]);
    }
    return [...map]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, tasks]) => ({ date, tasks }));
  }
}
