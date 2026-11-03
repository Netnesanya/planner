import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { PriorityStarsComponent } from "../shared/priority-stars.component";
import { DurationPickerComponent } from "../shared/duration-picker.component";
import { PlannerService } from "../planner.service";
import {
  COLORS,
  dateKey,
  parseDate,
  REPEAT_LABELS,
  Recurrence,
  Task,
  validProgress,
} from "../models";
@Component({
  selector: "app-task-editor",
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PriorityStarsComponent,
    DurationPickerComponent,
  ],
  templateUrl: "./task-editor.component.html",
  styleUrl: "./task-editor.component.scss",
})
export class TaskEditorComponent implements OnInit {
  readonly store = inject(PlannerService);
  @Input({ required: true }) task!: Task;
  @Output() saved = new EventEmitter<Task>();
  @Output() closed = new EventEmitter<void>();
  colors = COLORS;
  get linkedTasks() {
    return this.store.tasks().filter((t) => t.goal_id === this.task.id);
  }
  get availableGoals() {
    return this.store
      .tasks()
      .filter((t) => t.is_milestone && t.id !== this.task.id);
  }
  changeKind() {
    if (this.task.is_milestone) {
      this.task.goal_id = null;
      this.task.recurrence = "none";
      this.task.start_time = null;
    }
  }
  changeList() {
    if (!this.availableGoals.some((g) => g.id === this.task.goal_id))
      this.task.goal_id = null;
  }
  originalDate: string | null = null;
  tagInput = "";
  subtaskInput = "";
  durationValid = true;
  confirmDelete = false;
  repeatOptions = Object.entries(REPEAT_LABELS) as [Recurrence, string][];
  isEditorTask = (task: Task) => task.id === this.task.id;
  ngOnInit() {
    this.task.is_milestone ??= false;
    this.task.milestone_color ??=
      this.store.lists().find((l) => l.id === this.task.list_id)?.color ||
      COLORS[0];
    this.task.goal_id ??= null;
    this.task.progress_mode ??= "none";
    this.task.progress_value ??= 0;
    this.task.progress_target ??= 100;
    this.task.progress_unit ??= "";
    this.originalDate = this.task.due_date;
    this.tagInput = this.task.tags.join(", ");
  }
  dateLabel(date: string) {
    return parseDate(date).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  }
  completedDate(timestamp: string) {
    return this.dateLabel(dateKey(new Date(timestamp)));
  }
  async saveEditor() {
    if (!validProgress(this.task)) {
      this.store.error.set(
        "Укажите корректный прогресс: сделано ≥ 0, цель > 0.",
      );
      return;
    }
    const duration = this.task.duration;
    if (!this.task.is_milestone && !this.durationValid) {
      this.store.error.set(
        "Длительность: от 5 минут до 24 часов. Например, 1ч 30м.",
      );
      return;
    }
    const draft = {
      ...this.task,
      duration,
      start_time: this.task.is_milestone ? null : this.task.start_time,
      tags: [
        ...new Set(
          this.tagInput
            .split(",")
            .map((t) => t.trim().replace(/^#/, "").slice(0, 99))
            .filter(Boolean),
        ),
      ],
    };
    if (!draft.is_milestone) {
      const namedGoals = this.availableGoals.filter((g) =>
        draft.tags.includes(g.title),
      );
      if (!draft.goal_id && namedGoals.length === 1)
        draft.goal_id = namedGoals[0].id;
      const linked = this.availableGoals.find((g) => g.id === draft.goal_id);
      if (linked) draft.tags = draft.tags.filter((tag) => tag !== linked.title);
    }
    if (draft.due_date !== this.originalDate)
      draft.repeat_anchor = draft.due_date
        ? Number(draft.due_date.slice(8))
        : null;
    if (!draft.due_date) {
      draft.due_date = null;
      draft.start_time = null;
    }
    if (!draft.start_time) draft.start_time = null;
    if (await this.store.saveTask(draft)) {
      this.saved.emit(draft);
      this.closed.emit();
    }
  }
  addSubtask() {
    if (this.subtaskInput.trim()) {
      this.task.subtasks.push({
        id: crypto.randomUUID(),
        title: this.subtaskInput.trim(),
        done: false,
      });
      this.subtaskInput = "";
    }
  }
  changeProgressMode() {
    this.task.progress_value = 0;
    this.task.progress_target = 100;
    this.task.progress_unit = "";
  }
  removeSubtask(id: string) {
    this.task.subtasks = this.task.subtasks.filter((s) => s.id !== id);
  }
  async removeTask() {
    if (await this.store.deleteTask(this.task)) this.closed.emit();
  }
  closeOverlays() {
    this.closed.emit();
  }
}
