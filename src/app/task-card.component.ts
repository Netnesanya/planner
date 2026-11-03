import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { IconComponent } from "./icon.component";
import {
  durationLabel,
  Priority,
  priorityOpacity,
  Task,
  TaskList,
  TaskPatch,
} from "./models";
import { PriorityStarsComponent } from "./shared/priority-stars.component";
import { PlannerService } from "./planner.service";
import { DurationPickerComponent } from "./shared/duration-picker.component";
import { TaskProgressComponent } from "./shared/task-progress.component";
@Component({
  selector: "app-task-card",
  standalone: true,
  imports: [
    IconComponent,
    PriorityStarsComponent,
    TaskProgressComponent,
    DurationPickerComponent,
  ],
  templateUrl: "./task-card.component.html",
  styleUrl: "./task-card.component.scss",
})
export class TaskCardComponent {
  readonly store = inject(PlannerService);
  get linkedGoal() {
    return this.store
      .tasks()
      .find((g) => g.id === this.task.goal_id && g.is_milestone);
  }
  get color() {
    return (
      (this.task.is_milestone
        ? this.task.milestone_color
        : this.linkedGoal?.milestone_color) ||
      this.list?.color ||
      "#b9efc9"
    );
  }
  @Input({ required: true }) task!: Task;
  @Input() list?: TaskList;
  @Input() board = false;
  @Input() selected = false;
  @Input() disabled = false;
  @Output() edit = new EventEmitter<Task>();
  @Output() toggle = new EventEmitter<Task>();
  @Output() taskChange = new EventEmitter<TaskPatch>();
  duration = durationLabel;
  get doneSubtasks() {
    return this.task.subtasks.filter((s) => s.done).length;
  }
  get fill() {
    return `color-mix(in srgb, ${this.color} ${priorityOpacity(this.task.priority) * 100}%, transparent)`;
  }
  drag(event: DragEvent) {
    if (this.disabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/plain", this.task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
  setPriority(priority: Priority) {
    this.taskChange.emit({ id: this.task.id, patch: { priority } });
  }
}
