import { Component, EventEmitter, Input, Output } from "@angular/core";
import { Priority } from "../models";
@Component({
  selector: "app-priority-stars",
  standalone: true,
  template: ` <span
    class="priority-stars"
    role="group"
    [attr.aria-label]="'Приоритет: ' + value + ' из 5'"
  >
    @for (star of stars; track star) {
      <button
        type="button"
        [disabled]="disabled"
        [class.filled]="star <= value"
        [attr.aria-label]="'Приоритет ' + star + ' из 5'"
        [attr.aria-pressed]="star <= value"
        (click)="choose(star)"
        [title]="
          star === value
            ? 'Нажмите ещё раз, чтобы сбросить приоритет'
            : star + ' из 5'
        "
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"
          />
        </svg>
      </button>
    }
  </span>`,
  styleUrl: "./priority-stars.component.scss",
})
export class PriorityStarsComponent {
  @Input() value: Priority = 0;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<Priority>();
  stars: Priority[] = [1, 2, 3, 4, 5];
  choose(star: Priority) {
    this.valueChange.emit(star === this.value ? 0 : star);
  }
}
