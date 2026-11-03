import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";
import { Task, TaskPatch, taskProgress } from "../models";
@Component({
  selector: "app-task-progress",
  standalone: true,
  templateUrl: "./task-progress.component.html",
  styleUrl: "./task-progress.component.scss",
})
export class TaskProgressComponent {
  Math = Math;
  @Input({ required: true }) task!: Task;
  @Input() disabled = false;
  @Output() taskChange = new EventEmitter<TaskPatch>();
  @ViewChild("amountInput") amountInput?: ElementRef<HTMLInputElement>;
  editing = false;
  error = "";
  preview: number | null = null;
  get ratio() {
    return this.preview ?? taskProgress(this.task);
  }
  get stage() {
    return this.ratio === 0
      ? "Не начато"
      : this.ratio >= 100
        ? "Цель достигнута"
        : this.ratio >= 75
          ? "Почти готово"
          : "В процессе";
  }
  format(value: number) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
      value,
    );
  }
  startEdit() {
    this.editing = true;
    setTimeout(() => {
      this.amountInput?.nativeElement.focus();
      this.amountInput?.nativeElement.select();
    }, 0);
  }
  commitAmount(input: HTMLInputElement) {
    if (!this.editing) return;
    const value = Number(input.value.replace(/\s/g, "").replace(",", "."));
    if (
      !input.value.trim() ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e12
    ) {
      this.error = "Введите число от 0 до 1 000 000 000 000.";
      return;
    }
    this.error = "";
    this.editing = false;
    this.taskChange.emit({
      id: this.task.id,
      patch: { progress_value: value },
    });
  }
  amountKey(event: KeyboardEvent, input: HTMLInputElement) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.commitAmount(input);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.editing = false;
      this.error = "";
    }
  }
  saveRatio(event: Event) {
    event.stopPropagation();
    const percent = Number((event.target as HTMLInputElement).value);
    const target =
      this.task.progress_mode === "manual"
        ? 100
        : this.task.progress_target || 100;
    this.preview = null;
    this.taskChange.emit({
      id: this.task.id,
      patch: { progress_value: Math.round(target * percent) / 100 },
    });
  }
}
