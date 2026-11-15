import {
  Component,
  ElementRef,
  HostListener,
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
  addDays,
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
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private initial = "";
  private backgroundDown = false;
  confirmDiscard = false;
  saveError = "";
  get dirty() {
    return (
      this.snapshot() !== this.initial ||
      !!this.subtaskInput.trim() ||
      !this.durationValid
    );
  }
  private snapshot() {
    return JSON.stringify({ task: this.task, tags: this.tagInput });
  }
  saveFromConfirmation() {
    this.confirmDiscard = false;
    setTimeout(() => this.submit());
  }
  submit() {
    if (this.confirmDelete || this.store.busy()) return;
    if (this.confirmDiscard) {
      this.saveFromConfirmation();
      return;
    }
    this.host.nativeElement
      .querySelector<HTMLFormElement>("form")
      ?.requestSubmit();
  }
  setDate(value: "today" | "tomorrow" | "none") {
    this.task.due_date =
      value === "none"
        ? null
        : addDays(dateKey(), value === "tomorrow" ? 1 : 0);
    if (!this.task.due_date) {
      this.task.start_time = null;
      this.task.recurrence = "none";
    }
  }
  @HostListener("window:beforeunload", ["$event"]) beforeUnload(
    event: BeforeUnloadEvent,
  ) {
    if (this.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  backdropStart(event: PointerEvent) {
    this.backgroundDown = event.target === event.currentTarget;
  }
  backdropClick(event: MouseEvent) {
    if (this.backgroundDown && event.target === event.currentTarget)
      this.closeOverlays();
    this.backgroundDown = false;
  }
  private focus(selector: string) {
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
    );
  }
  escape() {
    if (this.store.busy()) return;
    if (this.confirmDelete) {
      this.confirmDelete = false;
      this.focus('[aria-label="Удалить задачу"]');
    } else if (this.confirmDiscard) this.keepEditing();
    else this.closeOverlays();
  }
  askDelete() {
    this.confirmDelete = true;
    this.focus(".delete-confirm .outline-button");
  }
  keepEditing() {
    this.confirmDiscard = false;
    this.focus(".task-title-input");
  }
  discard() {
    if (!this.store.busy()) this.closed.emit();
  }

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
    this.initial = this.snapshot();
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
    if (this.store.busy()) return;
    this.saveError = "";
    if (!this.task.title.trim()) {
      this.saveError = "Введите название задачи.";
      return;
    }
    if (!validProgress(this.task)) {
      this.saveError = "Укажите корректный прогресс: сделано ≥ 0, цель > 0.";
      return;
    }
    const duration = this.task.duration;
    if (!this.task.is_milestone && !this.durationValid) {
      this.saveError =
        "Длительность: от 5 минут до 24 часов. Например, 1ч 30м.";
      return;
    }
    this.addSubtask();
    const draft = {
      ...this.task,
      title: this.task.title.trim(),
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
    } else {
      this.saveError =
        this.store.error() ||
        "Не удалось сохранить. Ваши изменения остались в редакторе.";
      this.confirmDiscard = false;
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
    if (this.store.busy()) return;
    if (!this.dirty) {
      this.closed.emit();
      return;
    }
    this.confirmDiscard = true;
    this.focus(".discard-confirm .keep-editing");
  }
}
