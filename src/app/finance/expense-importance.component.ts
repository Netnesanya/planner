import { Component, EventEmitter, Input, Output } from "@angular/core";
import { IMPORTANCE_LABELS, importanceAtStar } from "./finance-tags";
@Component({
  selector: "app-expense-importance",
  standalone: true,
  templateUrl: "./expense-importance.component.html",
  styleUrl: "./expense-importance.component.scss",
})
export class ExpenseImportanceComponent {
  @Input() value = 0;
  @Input() disabled = false;
  @Input() label = "для нового тега";
  @Input() countText = "";
  @Output() valueChange = new EventEmitter<number>();
  @Input() labels: readonly string[] = IMPORTANCE_LABELS;
  readonly stars = [1, 2, 3, 4, 5];
  preview: number | null = null;
  hoveredStar: number | null = null;
  get displayed() {
    return this.preview ?? this.value;
  }
  private pointedValue(event: MouseEvent, star: number) {
    const target = event.currentTarget as HTMLElement;
    const glyph = target.querySelector(".star-glyph")!.getBoundingClientRect();
    return importanceAtStar(star, (event.clientX - glyph.left) / glyph.width);
  }
  hover(event: PointerEvent, star: number) {
    if (this.disabled || event.pointerType === "touch") return;
    this.hoveredStar = star;
    this.preview = this.pointedValue(event, star);
  }
  leave() {
    this.preview = null;
    this.hoveredStar = null;
  }
  commit(event: MouseEvent, star: number) {
    if (this.disabled) return;
    const value = event.detail === 0 ? star : this.pointedValue(event, star);
    if (event.detail > 0 && (event as PointerEvent).pointerType !== "touch") {
      this.preview = value;
      this.hoveredStar = star;
    } else this.leave();
    this.value = value;
    this.valueChange.emit(value);
  }
  keyboard(event: KeyboardEvent) {
    if (this.disabled) return;
    const values: Record<string, number> = {
      ArrowLeft: Math.max(0, this.value - 1),
      ArrowDown: Math.max(0, this.value - 1),
      ArrowRight: Math.min(5, this.value + 1),
      ArrowUp: Math.min(5, this.value + 1),
      Home: 0,
      End: 5,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    event.stopPropagation();
    this.leave();
    this.value = values[event.key];
    this.valueChange.emit(this.value);
  }
}
