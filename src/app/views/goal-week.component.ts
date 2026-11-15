import { Component, Input, Output, EventEmitter } from "@angular/core";
import { Task, taskProgress } from "../models";
@Component({
  selector: "app-goal-week",
  standalone: true,
  templateUrl: "./goal-week.component.html",
  styleUrl: "./goal-week.component.scss",
})
export class GoalWeekComponent {
  @Input({ required: true }) goal!: Task;
  @Input() tasks: Task[] = [];
  @Input() from = "";
  @Input() to = "";
  @Output() edit = new EventEmitter<Task>();
  @Output() add = new EventEmitter<void>();
  expanded = false;
  get actions() {
    return this.tasks.filter(
      (t) =>
        !t.is_milestone &&
        t.goal_id === this.goal.id &&
        t.due_date &&
        t.due_date >= this.from &&
        t.due_date <= this.to,
    );
  }
  get undated() {
    return this.tasks.filter(
      (t) =>
        !t.is_milestone &&
        t.goal_id === this.goal.id &&
        !t.due_date &&
        t.status !== "done",
    ).length;
  }
  get done() {
    return this.actions.filter((t) => t.status === "done").length;
  }
  get progress() {
    return this.goal.progress_mode && this.goal.progress_mode !== "none"
      ? taskProgress(this.goal)
      : null;
  }
}
