import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Task, durationLabel } from "../models";
@Component({
  selector: "app-calendar-backlog",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./calendar-backlog.component.html",
  styleUrl: "./calendar-backlog.component.scss",
})
export class CalendarBacklogComponent implements OnChanges {
  ngOnChanges() {
    if (this.selected && !this.tasks.some((t) => t.id === this.selected!.id))
      this.selected = null;
  }

  @Input() tasks: Task[] = [];
  @Input() date = "";
  @Input() busy = false;
  @Input() dropping = false;
  @Output() move = new EventEmitter<{ event: PointerEvent; task: Task }>();
  @Output() edit = new EventEmitter<Task>();
  @Output() schedule = new EventEmitter<{
    task: Task;
    date: string;
    time: string;
  }>();
  filter: "all" | "undated" = "all";
  selected: Task | null = null;
  targetDate = "";
  time = "09:00";
  duration = durationLabel;
  get visible() {
    return this.tasks.filter((t) => this.filter === "all" || !t.due_date);
  }
  choose(task: Task) {
    this.selected = task;
    this.targetDate = task.due_date || this.date;
  }
  submit() {
    if (this.selected && this.targetDate) {
      this.schedule.emit({
        task: this.selected,
        date: this.targetDate,
        time: this.time,
      });
    }
  }
}
