import { Component, inject } from "@angular/core";
import { PlannerService } from "../planner.service";
@Component({
  selector: "app-task-undo",
  standalone: true,
  template: `@if (store.undoEntry(); as entry) {
    <aside role="status" aria-live="polite">
      <span>{{ entry.label }}</span>
      <button
        type="button"
        [disabled]="store.busy() || store.loading()"
        (click)="store.undoTaskAction()"
      >
        Вернуть
      </button>
      <button
        type="button"
        aria-label="Скрыть отмену действия"
        (click)="store.undoEntry.set(null)"
      >
        ×
      </button>
    </aside>
  }`,
  styleUrl: "./task-undo.component.scss",
})
export class TaskUndoComponent {
  readonly store = inject(PlannerService);
}
