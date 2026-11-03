import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { PlannerService } from "../planner.service";
import { FocusService } from "../focus.service";
@Component({
  selector: "app-focus-view",
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: "./focus-view.component.html",
  styleUrl: "./focus-view.component.scss",
})
export class FocusViewComponent {
  readonly store = inject(PlannerService);
  readonly focus = inject(FocusService);
  get focusTask() {
    return this.focus.taskId;
  }
  set focusTask(value: string) {
    this.focus.taskId = value;
  }
  get focusMinutes() {
    return this.focus.minutes;
  }
  set focusMinutes(value: number) {
    this.focus.minutes = value;
  }
  get timerLabel() {
    return this.focus.label();
  }
  focusRunning = this.focus.running;
  toggleFocus() {
    this.focus.toggle();
  }
  resetFocus() {
    this.focus.reset();
  }
}
