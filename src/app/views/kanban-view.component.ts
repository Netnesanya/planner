import { Component } from "@angular/core";
import { IconComponent } from "../icon.component";
import { TaskCardComponent } from "../task-card.component";
import { TaskViewBase } from "../shared/task-view.base";
import { Status } from "../models";
@Component({
  selector: "app-kanban-view",
  standalone: true,
  imports: [IconComponent, TaskCardComponent],
  templateUrl: "./kanban-view.component.html",
  styleUrl: "./kanban-view.component.scss",
})
export class KanbanViewComponent extends TaskViewBase {
  columns: { id: Status; label: string; dot: string }[] = [
    { id: "todo", label: "Запланировано", dot: "#8b92a0" },
    { id: "doing", label: "В процессе", dot: "#b9c6f8" },
    { id: "done", label: "Готово", dot: "#b9efc9" },
  ];
  columnTasks(status: Status) {
    return this.tasks.filter((t) => t.status === status);
  }
}
