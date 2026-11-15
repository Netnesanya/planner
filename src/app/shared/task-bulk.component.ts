import { Component, Input, Output, EventEmitter, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PlannerService } from "../planner.service";
import { Task, dateKey } from "../models";
import { BulkPatch } from "../planner-workflows";
@Component({
  selector: "app-task-bulk",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./task-bulk.component.html",
  styleUrl: "./task-bulk.component.scss",
})
export class TaskBulkComponent {
  readonly store = inject(PlannerService);
  @Input() tasks: Task[] = [];
  @Output() cleared = new EventEmitter<void>();
  action = "date";
  date = dateKey();
  list = "";
  tag = "";
  status: "todo" | "doing" | "done" = "done";
  async apply() {
    const patch: BulkPatch =
      this.action === "date"
        ? { due_date: this.date }
        : this.action === "undated"
          ? { due_date: null }
          : this.action === "list"
            ? { list_id: this.list }
            : this.action === "tag"
              ? { tag: this.tag }
              : { status: this.status };
    if (this.action === "list" && !this.list) return;
    if (await this.store.bulkUpdate(this.tasks, patch)) this.cleared.emit();
  }
}
